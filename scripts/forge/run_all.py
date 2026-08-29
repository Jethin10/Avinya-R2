"""Create a deterministic, disclosed synthetic Wayanad district package.

This is the offline fallback Forge. Production adapters may replace its JSON artifacts
with GeoPackage/Parquet outputs while keeping the Engine contract unchanged.
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

from core.belief import FailureMode
from engine.config import ROOT


IST = timezone(timedelta(hours=5, minutes=30))


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


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
    events = [
        {"t": (t0 + timedelta(minutes=20)).isoformat(), "kind": "report", "channel": "ham", "source_id": "HAM-VU2XYZ", "text": "I saw the embankment breached near Bhimsar, water in houses", "hazard": "flood", "severity_hint": "severe", "is_firsthand": True, "provenance": "archived"},
        {"t": (t0 + timedelta(minutes=31)).isoformat(), "kind": "telemetry", "channel": "telecom", "source_id": "telco-aggregate", "settlement_id": "BH-042", "observed": 0, "expected": 380, "params": {"minutes_to_drop": 10, "sustained_hours": 3}, "provenance": "synthetic"},
        {"t": (t0 + timedelta(minutes=44)).isoformat(), "kind": "sar", "channel": "sar", "source_id": "sentinel-1", "settlement_id": "BH-042", "coherence_loss": 0.71, "backscatter_drop_db": 0.4, "provenance": "archived"},
        {"t": (t0 + timedelta(minutes=65)).isoformat(), "kind": "telemetry", "channel": "telecom", "source_id": "telco-aggregate", "settlement_id": "KH-017", "observed": 142, "expected": 160, "params": {"minutes_to_drop": 0, "sustained_hours": 0}, "provenance": "synthetic"},
        {"t": (t0 + timedelta(minutes=80)).isoformat(), "kind": "sar", "channel": "sar", "source_id": "sentinel-1", "settlement_id": "ME-008", "coherence_loss": 0.1, "backscatter_drop_db": 4.8, "provenance": "archived"},
        {"t": (t0 + timedelta(minutes=95)).isoformat(), "kind": "power", "channel": "power", "source_id": "feeder-scada", "settlement_id": "CH-011", "condition": "dead", "provenance": "synthetic"},
        {"t": (t0 + timedelta(minutes=115)).isoformat(), "kind": "report", "channel": "whatsapp", "source_id": "forward-1", "text": "Forwarded: Bhimsar completely collapsed", "hazard": "quake", "severity_hint": "catastrophic", "is_firsthand": False, "provenance": "synthetic"},
        {"t": (t0 + timedelta(minutes=116)).isoformat(), "kind": "report", "channel": "whatsapp", "source_id": "forward-2", "text": "Forwarded Bhimsar completely collapsed", "hazard": "quake", "severity_hint": "catastrophic", "is_firsthand": False, "provenance": "synthetic"},
    ]
    # Synthetic scenario truth is intentionally explicit and stable: it describes the event
    # authored above and is never presented as a real post-disaster assessment.
    truth_order = ["BH-042", "ME-008", "CH-011", "WY-160", "WY-055", "WY-065", "WY-140", "WY-054", "WY-028", "WY-214"]
    truth_modes = {sid: ("COLLAPSE" if sid in {"BH-042", "CH-011", "WY-028"} else "INUNDATION") for sid in truth_order}
    ground_truth = []
    for index, settlement in enumerate(settlements):
        severe = settlement["id"] in truth_modes
        mode = truth_modes.get(settlement["id"], ["INUNDATION", "COLLAPSE", "LANDSLIDE"][index % 3])
        severity = round(0.98 - truth_order.index(settlement["id"]) * 0.035, 3) if severe else round(0.08 + (index % 9) * 0.035, 2)
        ground_truth.append({"settlement_id": settlement["id"], "severe": severe, "failure_mode": mode, "severity": severity, "provenance": "synthetic"})
    meta = {"id": "wayanad-demo", "name": "Wayanad District", "bbox": [75.82, 11.42, 76.46, 11.97], "timezone": "Asia/Kolkata", "replay": {"t0": t0.isoformat(), "t1": t1.isoformat()}, "provenance": {"scenario": "synthetic", "reports": "mixed archived/synthetic", "telemetry": "synthetic", "disclosure": "Demonstration package; not operational ground truth."}, "counts": {"settlements": len(settlements), "assets": len(assets)}}
    _write_json(root / "meta.json", meta); _write_json(root / "settlements.json", settlements); _write_json(root / "priors.json", priors)
    _write_json(root / "neighbours.json", neighbours); _write_json(root / "cascade.json", cascade); _write_json(root / "assets.json", assets)
    _write_json(root / "ground_truth.json", ground_truth)
    (root / "events.jsonl").write_text("\n".join(json.dumps(event, ensure_ascii=False) for event in events) + "\n", encoding="utf-8")
    (root / "twin_states.bin").write_bytes(bytes((index * 17) % 256 for index in range(len(settlements) * 25)))
    return root


def main() -> None:
    target = ROOT / "district_package" / "wayanad"
    from scripts.forge.build_roads import build as build_roads
    from scripts.forge.build_terrain import build as build_terrain
    from scripts.forge.historical import build_all
    routes = build_roads()
    terrain = build_terrain()
    print(json.dumps({"ok": True, "demo_package": str(build(target)), "routes": str(routes), "terrain": str(terrain), "historical_packages": [str(path) for path in build_all()]}))


if __name__ == "__main__": main()
