"""Create a deterministic, disclosed synthetic Wayanad district package.

This is the offline fallback Forge. Production adapters may replace its JSON artifacts
with GeoPackage/Parquet outputs while keeping the Engine contract unchanged.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from core.belief import FailureMode
from engine.config import ROOT

from .event_stream import StreamSpec, build as build_stream


IST = timezone(timedelta(hours=5, minutes=30))

# Villages the demo takes off the air entirely; see the StreamSpec note in ``build``.
SILENT = ("BH-042", "CH-011")


def _write(path: Path, payload: bytes) -> None:
    """Skip identical writes, and replace atomically otherwise (see ``historical._write``)."""
    if path.exists() and path.read_bytes() == payload:
        return
    temp = path.with_name(path.name + ".tmp")
    temp.write_bytes(payload)
    temp.replace(path)


def _write_json(path: Path, payload: object) -> None:
    _write(path, json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"))


def _cell(lon: float, lat: float, size: float = 0.006) -> dict[str, object]:
    """A square footprint around a synthetic settlement centre.

    The synthetic package has no surveyed boundaries, so the map needs *something* to extrude. These
    cells are declared derived in ``layers/index.json`` and must never be mistaken for the Survey of
    India village polygons the historical packages carry.
    """
    ring = [[lon - size, lat - size], [lon + size, lat - size], [lon + size, lat + size], [lon - size, lat + size], [lon - size, lat - size]]
    return {"type": "Polygon", "coordinates": [[[round(x, 6), round(y, 6)] for x, y in ring]]}


def build(root: Path) -> Path:
    root.mkdir(parents=True, exist_ok=True)
    (root / "tiles").mkdir(exist_ok=True)
    t0 = datetime(2024, 7, 30, 2, 0, tzinfo=IST)
    t1 = t0 + timedelta(hours=24)
    names = [
        ("BH-042", "Bhimsar", ["Bheemsar", "भीमसर"]),
        ("KH-017", "Kharsa", ["Kharsaa", "खरसा"]),
        ("DH-031", "Dhanauri", ["Dhanouri", "धनौरी"]),
        ("ME-008", "Meppadi", ["Meppady", "മേപ്പാടി"]),
        ("CH-011", "Chooralmala", ["Churalmala", "ചൂരൽമല"]),
        ("MU-019", "Mundakkai", ["Mundakai", "മുണ്ടക്കൈ"]),
    ]
    for index in range(6, 214):
        names.append((f"WY-{index + 1:03d}", f"Settlement {index + 1}", [f"Village {index + 1}"]))
    settlements = []
    for index, (sid, name, variants) in enumerate(names):
        angle = index * 2.399963
        radius = 0.015 + 0.0022 * math.sqrt(index)
        lat = 11.61 + radius * math.sin(angle)
        lon = 76.08 + radius * math.cos(angle)
        settlements.append({
            "id": sid, "lgd_code": f"LGD-{673000 + index}", "name": name, "name_variants": variants,
            "block": ["Kalpetta", "Mananthavady", "Sulthan Bathery"][index % 3], "tehsil": "Wayanad",
            "location": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "population": 420 + (index * 137) % 4600, "elderly_frac": round(0.06 + (index % 8) * 0.012, 3),
            "pct_sc_st": round(0.08 + (index % 10) * 0.065, 3), "pct_kutcha": round(0.18 + (index % 7) * 0.08, 3),
            "pct_pucca": round(0.72 - (index % 7) * 0.07, 3), "fragility_class": ["kutcha", "semi-pucca", "pucca"][index % 3],
            "elevation_m": 680 + (index * 29) % 540, "slope_deg": 3 + (index * 7) % 38, "hand_m": round(0.6 + (index * 1.7) % 18, 2),
            "road_hours_normal": round(0.18 + (index % 15) * 0.08, 2), "nearest_phc_id": f"PHC-{index % 8 + 1:02d}",
            "heartbeat_baseline": {"hourly": 8 + index % 30}, "observability": round(0.25 + (index % 12) * 0.06, 2),
            "geometry": _cell(round(lon, 6), round(lat, 6)),
            "provenance": "synthetic",
        })
    priors = []
    for index, settlement in enumerate(settlements):
        flood = min(0.78, max(0.08, 0.54 - settlement["hand_m"] * 0.02 + (index % 5) * 0.03))
        collapse = min(0.72, max(0.05, 0.10 + settlement["slope_deg"] * 0.009 + settlement["pct_kutcha"] * 0.25))
        if settlement["id"] == "BH-042":
            collapse = 0.45
        values = {FailureMode.INUNDATION: flood, FailureMode.COLLAPSE: collapse, FailureMode.CASUALTY: max(0.04, (flood + collapse) * 0.28), FailureMode.LANDSLIDE: min(0.68, 0.05 + settlement["slope_deg"] * 0.012), FailureMode.WIND: 0.06 + (index % 4) * 0.01}
        for mode, probability in values.items(): priors.append({"settlement_id": settlement["id"], "failure_mode": mode.value, "probability": round(probability, 6), "variance": 0.28})
    neighbours = {}
    for index, settlement in enumerate(settlements):
        neighbour_ids = [settlements[(index - 1) % len(settlements)]["id"], settlements[(index + 1) % len(settlements)]["id"]]
        neighbours[settlement["id"]] = {sid: 0.5 for sid in neighbour_ids}
    cascade = [{"source": settlements[i]["id"], "destination": settlements[(i + 3) % len(settlements)]["id"], "lag_minutes": 180 + (i % 4) * 45, "transfer_weight": round(0.35 + (i % 3) * 0.1, 2)} for i in range(0, 24, 3)]
    assets = []
    for kind, count in (("boat", 5), ("excavator", 5), ("medical", 6)):
        assets.extend({"asset_id": f"{kind.upper()}-{i + 1:02d}", "kind": kind, "capacity": 12 if kind == "boat" else 1 if kind == "excavator" else 6, "status": "available"} for i in range(count))
    # Synthetic scenario truth is intentionally explicit and stable: it describes the event
    # authored above and is never presented as a real post-disaster assessment.
    truth_order = ["BH-042", "ME-008", "CH-011", "WY-160", "WY-055", "WY-065", "WY-140", "WY-054", "WY-028", "WY-214"]
    # The two silent villages are the collapse cases: a sustained hard zero on the towers is
    # what evidences a village going down, and the authored truth has to agree with that.
    truth_modes = {sid: ("COLLAPSE" if sid in SILENT else "INUNDATION") for sid in truth_order}
    affected = truth_order + [row["id"] for row in settlements[6:26]]
    # The silent pair is deliberately absent from ``severe``: severe villages get five first-hand
    # witnesses, and a village whose towers are a hard zero has nobody left to send one. Their only
    # evidence is telemetry, a dead feeder and an overhead pass - which is the whole point of the
    # silent-zone metric, and it only means anything if the demo really does withhold their reports.
    spec = StreamSpec(
        scenario_id="wayanad-demo", t0=t0, t1=t1, onset=t0 + timedelta(minutes=30), hazard="flood",
        mode="INUNDATION", severe=[sid for sid in truth_order if sid not in SILENT],
        affected=affected, silent=list(SILENT),
        rumour_target="KH-017",
        anchors=[{"offset_minutes": 0, "source_id": "setu-synthetic-scenario", "text": "Synthetic district scenario begins; no part of this stream is an observation of a real event.", "severity_hint": "unknown"}],
    )
    events = build_stream(spec, settlements)
    ground_truth = []
    for index, settlement in enumerate(settlements):
        severe = settlement["id"] in truth_modes
        mode = truth_modes.get(settlement["id"], ["INUNDATION", "COLLAPSE", "LANDSLIDE"][index % 3])
        severity = round(0.98 - truth_order.index(settlement["id"]) * 0.035, 3) if severe else round(0.08 + (index % 9) * 0.035, 2)
        ground_truth.append({"settlement_id": settlement["id"], "severe": severe, "failure_mode": mode, "severity": severity, "provenance": "synthetic"})
    meta = {"id": "wayanad-demo", "name": "Wayanad District", "bbox": [75.82, 11.42, 76.46, 11.97], "timezone": "Asia/Kolkata", "historical": False, "replay": {"t0": t0.isoformat(), "t1": t1.isoformat()}, "provenance": {"scenario": "synthetic", "reports": "synthetic", "telemetry": "synthetic", "disclosure": "Demonstration package. Every settlement, boundary, report and telemetry row in it is authored, not observed; it is not operational ground truth and no part of it describes a real event."}, "counts": {"settlements": len(settlements), "assets": len(assets), "events": len(events)}, "event_streams": {"generator": "scripts/forge/event_stream.py", "seeded_by": "scenario id (blake2b), so a rebuild reproduces the stream byte for byte", "personal_data": False}}
    _write_json(root / "meta.json", meta); _write_json(root / "settlements.json", settlements); _write_json(root / "priors.json", priors)
    _write_json(root / "neighbours.json", neighbours); _write_json(root / "cascade.json", cascade); _write_json(root / "assets.json", assets)
    _write_json(root / "ground_truth.json", ground_truth)
    body = "\n".join(json.dumps(event, ensure_ascii=False) for event in events) + "\n"
    _write(root / "events.jsonl", body.encode("utf-8"))
    _twin_and_layers(root, settlements, t0)
    return root


def _twin_and_layers(root: Path, settlements: list[dict[str, object]], t0: datetime) -> None:
    """Write the map and timeline artifacts the Twin needs, with the frame index it declares.

    ``twin_states.bin`` is a flat uint8 grid: one byte per settlement per frame, in the order
    ``twin_manifest.json`` records. The frontend reads it as a typed array, so the manifest and the
    byte count have to agree exactly - the Engine slices by ``frame * bytes_per_frame``.
    """
    (root / "layers").mkdir(exist_ok=True)
    frames = [(t0 + timedelta(hours=hour)).isoformat() for hour in range(25)]
    _write_json(root / "layers" / "settlements.geojson", {"type": "FeatureCollection", "features": [
        {"type": "Feature", "id": row["id"], "properties": {"id": row["id"], "name": row["name"], "population_2011": row["population"], "provenance": "synthetic"}, "geometry": row["geometry"]}
        for row in settlements
    ]})
    _write_json(root / "layers" / "event_features.geojson", {"type": "FeatureCollection", "features": []})
    binary = bytearray()
    hazard_frames = []
    for index, stamp in enumerate(frames):
        progress = index / max(1, len(frames) - 1)
        values = []
        for position, row in enumerate(settlements):
            intensity = round(min(0.98, (0.06 + 0.9 * progress) if position % 7 == 0 else (0.04 + 0.35 * progress)), 3)
            values.append({"settlement_id": row["id"], "intensity": intensity, "provenance": "synthetic"})
            binary.append(round(intensity * 255))
        hazard_frames.append({"t": stamp, "hazard": "flood", "values": values})
    _write_json(root / "layers" / "hazard_frames.json", {"scenario_id": "wayanad-demo", "frames": hazard_frames})
    _write_json(root / "layers" / "index.json", {"layers": [
        {"id": "settlements", "format": "geojson", "path": "layers/settlements.geojson", "provenance": "synthetic_cells_not_surveyed_boundaries"},
        {"id": "event_features", "format": "geojson", "path": "layers/event_features.geojson", "provenance": "synthetic"},
        {"id": "hazard_frames", "format": "json", "path": "layers/hazard_frames.json", "provenance": "synthetic"},
    ]})
    _write(root / "twin_states.bin", bytes(binary))
    _write_json(root / "twin_manifest.json", {"encoding": "uint8 normalized intensity", "settlement_order": [row["id"] for row in settlements], "timestamps": frames, "frame_count": len(frames), "bytes_per_frame": len(settlements)})


def main() -> None:
    target = ROOT / "district_package" / "wayanad"
    from scripts.forge.build_roads import build as build_roads
    from scripts.forge.build_terrain import build as build_terrain
    from scripts.forge.historical import build_all
    routes = build_roads()
    terrain = build_terrain()
    packages = build_all()
    # Buildings and the heightmap ride on downloaded rasters and an Overpass snapshot, so they run
    # only where those sources are already in the tree; a checkout without them still gets a
    # complete package, just without the two large visual layers. Both steps register themselves in
    # each package's layer index, and both refuse to touch the synthetic package. The atlas is an
    # acquisition step that reaches the network, so it stays out of the offline pipeline and is run
    # on its own with `python -m scripts.forge.build_atlas`.
    extra: dict[str, Any] = {}
    from scripts.forge.build_buildings import BUILDINGS, build as build_buildings
    from scripts.forge.build_heightmap import build as build_heightmap
    if BUILDINGS.exists():
        extra["buildings"] = build_buildings()
    if (ROOT / "data" / "sources" / "copernicus_dem_n11_e076.tif").exists():
        extra["heightmap"] = build_heightmap()
    print(json.dumps({"ok": True, "demo_package": str(build(target)), "routes": str(routes), "terrain": str(terrain), "historical_packages": [str(path) for path in packages], **extra}))


if __name__ == "__main__": main()
