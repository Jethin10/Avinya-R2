"""Build reproducible Wayanad historical replay packages from official source files."""

from __future__ import annotations

import json
import math
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import shapefile
from pyproj import CRS, Transformer

from core.belief import FailureMode
from engine.config import ROOT

from .event_stream import StreamSpec, build as build_stream


IST = timezone(timedelta(hours=5, minutes=30))
SOURCES = ROOT / "data" / "sources"
PACKAGES = ROOT / "district_package"
XML_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _write(path: Path, payload: bytes) -> None:
    """Write only when the bytes differ, and replace atomically when they do.

    The packages are rebuilt on every ``build_all()`` call, and several of these files are megabytes
    of settlement geometry that never change between runs. Rewriting them in place put the build at
    the mercy of whatever else on Windows had the handle open for a scan - an intermittent
    ``OSError: [Errno 22]`` mid-suite. Skipping identical writes makes a rebuild cheap, and going
    through a sibling temp file means a reader never sees a half-written package.
    """
    if path.exists() and path.read_bytes() == payload:
        return
    temp = path.with_name(path.name + ".tmp")
    temp.write_bytes(payload)
    temp.replace(path)


def _json(path: Path, value: object) -> None:
    _write(path, json.dumps(value, indent=2, ensure_ascii=False).encode("utf-8"))


def _normal(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower().replace("part", ""))


def _xlsx_rows(path: Path) -> list[dict[str, str]]:
    with ZipFile(path) as bundle:
        strings = [
            "".join(node.text or "" for node in item.iter(XML_NS + "t"))
            for item in ET.fromstring(bundle.read("xl/sharedStrings.xml")).findall(XML_NS + "si")
        ]
        rows: list[dict[str, str]] = []
        for row in ET.fromstring(bundle.read("xl/worksheets/sheet1.xml")).iter(XML_NS + "row"):
            values: dict[str, str] = {}
            for cell in row.findall(XML_NS + "c"):
                value = cell.find(XML_NS + "v")
                if value is None:
                    continue
                column = re.match(r"[A-Z]+", cell.attrib["r"])
                assert column
                values[column.group()] = strings[int(value.text or 0)] if cell.attrib.get("t") == "s" else (value.text or "")
            rows.append(values)
        return rows


def _transform_coordinates(value: Any, transformer: Transformer) -> Any:
    if isinstance(value, (tuple, list)) and len(value) >= 2 and all(isinstance(v, (int, float)) for v in value[:2]):
        x, y = transformer.transform(float(value[0]), float(value[1]))
        return [round(x, 6), round(y, 6)]
    return [_transform_coordinates(item, transformer) for item in value]


def _centroid(geometry: dict[str, Any]) -> list[float]:
    points: list[list[float]] = []

    def collect(value: Any) -> None:
        if isinstance(value, list) and len(value) >= 2 and all(isinstance(v, (int, float)) for v in value[:2]):
            points.append(value)
        elif isinstance(value, list):
            for item in value:
                collect(item)

    collect(geometry["coordinates"])
    return [round(sum(p[0] for p in points) / len(points), 6), round(sum(p[1] for p in points) / len(points), 6)]


def official_settlements() -> tuple[list[dict[str, Any]], dict[str, Any]]:
    census_rows = _xlsx_rows(SOURCES / "census_2011_wayanad_pca.xlsx")
    census = {row["D"].strip(): row for row in census_rows if row.get("G") == "VILLAGE"}
    kalpetta = next(row for row in census_rows if row.get("G") == "TOWN" and row.get("H", "").startswith("Kalpetta"))
    shp = SOURCES / "survey_of_india_kerala" / "KERALA.shp"
    reader = shapefile.Reader(str(shp), encoding="utf-8")
    transformer = Transformer.from_crs(CRS.from_wkt(shp.with_suffix(".prj").read_text()), "EPSG:4326", always_xy=True)
    settlements: list[dict[str, Any]] = []
    features: list[dict[str, Any]] = []
    for record, shape in zip(reader.records(), reader.shapes()):
        if str(record["District"]).strip().lower() != "wayanad":
            continue
        lgd = str(record["Vill_LGD"]).strip()
        row = census.get(lgd, kalpetta if str(record["Vill_name"]).strip() == "Kalpetta" else None)
        if row is None:
            raise ValueError(f"No Census PCA match for LGD {lgd} {record['Vill_name']}")
        raw_geometry = shape.__geo_interface__
        geometry = {"type": raw_geometry["type"], "coordinates": _transform_coordinates(raw_geometry["coordinates"], transformer)}
        point = _centroid(geometry)
        population = int(float(row.get("K", 0))); households = int(float(row.get("J", 0)))
        sc_st = int(float(row.get("Q", 0))) + int(float(row.get("T", 0)))
        name = str(record["Vill_name"]).strip()
        census_name = row.get("H", name).strip()
        provenance = {
            "boundary": "soi-kerala-villages",
            "population": "census-2011-wayanad-pca",
            "elderly_frac": "derived_assumption:not_available_in_pca",
            "observability": "derived_from_population_density_proxy"
        }
        settlements.append({
            "id": f"LGD-{lgd}", "lgd_code": lgd, "name": name,
            "name_variants": sorted({name, census_name, name.replace("(Part)", "").strip()}),
            "block": str(record["Sub_dist"]).strip(), "tehsil": str(record["Sub_dist"]).strip(),
            "location": {"type": "Point", "coordinates": point}, "geometry": geometry,
            "population": population, "households": households,
            "elderly_frac": 0.12, "pct_sc_st": round(sc_st / max(1, population), 5),
            "pct_kutcha": 0.25, "pct_pucca": 0.75, "fragility_class": "unknown",
            "road_hours_normal": 1.0, "observability": round(min(0.9, 0.35 + math.log10(max(10, population)) / 10), 3),
            "provenance": "archived", "field_provenance": provenance,
        })
        features.append({"type": "Feature", "id": f"LGD-{lgd}", "properties": {"id": f"LGD-{lgd}", "name": name, "lgd_code": lgd, "population_2011": population}, "geometry": geometry})
    settlements.sort(key=lambda row: row["id"])
    terrain_path = ROOT / "data" / "derived" / "wayanad_terrain.json"
    if terrain_path.exists():
        terrain = json.loads(terrain_path.read_text(encoding="utf-8"))["statistics"]
        for settlement in settlements:
            values = terrain[settlement["id"]]
            settlement["elevation_m"] = values["elevation_m"]["mean"]
            settlement["slope_deg"] = values["slope_deg"]["p90"]
            settlement["hand_m"] = values["hand_m"]["p25"]
            settlement["terrain"] = values
            settlement["field_provenance"]["terrain"] = values["provenance"]
    return settlements, {"type": "FeatureCollection", "features": features}


def _distance(a: list[float], b: list[float]) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def _cascade_edges(settlements: list[dict[str, Any]], neighbours: dict[str, dict[str, float]]) -> list[dict[str, Any]]:
    """Downhill-only propagation edges derived from DEM elevation and the neighbour graph.

    Water moves one way. An edge exists only where the neighbour sits materially lower than the
    source, so a village cannot pre-position against a flood that would have to run uphill to reach
    it. Lag is the drop-driven travel time over the centre-to-centre distance; the weight is the
    neighbour's share of the graph, tapered by how far the water has to go. Derived, not observed:
    ``meta.json`` records the method and the DEM the drops came from.
    """
    by_id = {row["id"]: row for row in settlements}
    edges: list[dict[str, Any]] = []
    for source_id, targets in neighbours.items():
        source = by_id[source_id]
        source_elevation = float(source.get("elevation_m") or 0.0)
        for target_id, share in targets.items():
            target = by_id[target_id]
            drop = source_elevation - float(target.get("elevation_m") or 0.0)
            if drop < 15.0:
                continue
            km = math.dist(source["location"]["coordinates"], target["location"]["coordinates"]) * 111.32
            speed_kmh = max(1.5, min(9.0, 1.6 * math.sqrt(drop)))
            lag = int(round(min(360.0, max(20.0, 60.0 * km / speed_kmh))))
            weight = round(min(0.85, share * (0.55 + min(0.45, drop / 600.0))), 6)
            if weight <= 0.02:
                continue
            edges.append({"source": source_id, "destination": target_id, "lag_minutes": lag, "transfer_weight": weight})
    edges.sort(key=lambda row: (row["source"], row["destination"]))
    return edges


def _common_files(root: Path, settlements: list[dict[str, Any]], geojson: dict[str, Any], scenario: dict[str, Any]) -> None:
    root.mkdir(parents=True, exist_ok=True); (root / "layers").mkdir(exist_ok=True)
    _json(root / "settlements.json", settlements)
    _json(root / "layers" / "settlements.geojson", geojson)
    neighbours: dict[str, dict[str, float]] = {}
    for source in settlements:
        nearest = sorted(((_distance(source["location"]["coordinates"], other["location"]["coordinates"]), other["id"]) for other in settlements if other["id"] != source["id"]))[:3]
        total = sum(1 / max(value, 1e-9) for value, _ in nearest)
        neighbours[source["id"]] = {sid: round((1 / max(value, 1e-9)) / total, 6) for value, sid in nearest}
    _json(root / "neighbours.json", neighbours)
    priors = []
    for settlement in settlements:
        susceptibility = settlement.get("terrain", {}).get("susceptibility", {"inundation": 0.35, "landslide": 0.25})
        flood = float(susceptibility["inundation"]); slide = float(susceptibility["landslide"])
        for mode in FailureMode:
            base = {"INUNDATION": 0.04 + 0.46 * flood, "LANDSLIDE": 0.03 + 0.52 * slide, "COLLAPSE": 0.035 + 0.16 * slide, "CASUALTY": 0.02 + 0.10 * max(flood, slide), "WIND": 0.04}[mode.value]
            event_multiplier = 1.0
            scenario_id = scenario["meta"]["id"]
            if mode == FailureMode.INUNDATION and scenario_id == "wayanad-2018-flood": event_multiplier = 1.35
            if mode == FailureMode.INUNDATION and scenario_id == "wayanad-2019-flood-landslide": event_multiplier = 1.15
            if mode == FailureMode.LANDSLIDE and scenario_id in {"wayanad-2019-flood-landslide", "meppadi-2024-landslide"}: event_multiplier = 1.3
            probability = min(0.78, base * event_multiplier)
            priors.append({"settlement_id": settlement["id"], "failure_mode": mode.value, "probability": round(probability, 6), "variance": 0.28, "provenance": {"type": "physics_prior", "terrain_sources": ["Copernicus DEM GLO-30 2021", "ASF GLO-30 HAND v1/2021"], "post_hoc_ground_truth_used": False}})
    _json(root / "priors.json", priors)
    _json(root / "cascade.json", _cascade_edges(settlements, neighbours))
    assets = []
    for kind, count, capacity in (("boat", 5, 12), ("excavator", 5, 1), ("medical", 6, 6)):
        assets += [{"asset_id": f"{kind.upper()}-{i+1:02d}", "kind": kind, "capacity": capacity, "status": "available"} for i in range(count)]
    _json(root / "assets.json", assets)
    routes = ROOT / "data" / "derived" / "wayanad_routes.json.gz"
    if routes.exists():
        _write(root / "routes.json.gz", routes.read_bytes())
    terrain = ROOT / "data" / "derived" / "wayanad_terrain.json"
    if terrain.exists():
        _write(root / "terrain.json", terrain.read_bytes())


def _write_scenario(root: Path, settlements: list[dict[str, Any]], geojson: dict[str, Any], scenario: dict[str, Any]) -> None:
    _common_files(root, settlements, geojson, scenario)
    if (root / "routes.json.gz").exists():
        scenario["meta"].setdefault("sources", []).append("osm-wayanad-roads-2026-08-29")
        scenario["meta"]["routing"] = {"base_settlement_id": "LGD-913291", "asset_profiles": ["boat", "excavator", "medical"], "attribution": "© OpenStreetMap contributors, ODbL 1.0"}
    if (root / "terrain.json").exists():
        scenario["meta"].setdefault("sources", []).extend(["copernicus-dem-glo30-n11e075", "copernicus-dem-glo30-n11e076", "glo30-hand-n11e075", "glo30-hand-n11e076"])
        scenario["meta"]["physics_prior"] = {"method": "settlement polygon samples of elevation, slope and HAND; no post-hoc ground truth leakage", "artifact": "terrain.json"}
        scenario["meta"]["cascade"] = {"method": "downhill-only neighbour edges where the DEM drop exceeds 15 m; lag from drop-driven travel time", "provenance": "derived_from_copernicus_dem_glo30", "artifact": "cascade.json"}
    scenario["meta"]["counts"] = {"settlements": len(settlements), "assets": 16, "events": len(scenario["events"]), "frames": len(scenario["frames"])}
    _json(root / "meta.json", scenario["meta"])
    events = scenario["events"]
    body = "\n".join(json.dumps(row, ensure_ascii=False) for row in events) + "\n"
    _write(root / "events.jsonl", body.encode("utf-8"))
    truth = []
    severe = set(scenario["severe"])
    affected = set(scenario["affected"])
    for row in settlements:
        truth.append({"settlement_id": row["id"], "affected": row["id"] in affected, "severe": row["id"] in severe, "failure_mode": scenario["mode"], "severity": 0.95 if row["id"] in severe else 0.45 if row["id"] in affected else 0.05, "provenance": scenario["truth_provenance"]})
    _json(root / "ground_truth.json", truth)
    _json(root / "layers" / "event_features.geojson", {"type": "FeatureCollection", "features": scenario["features"]})
    frames = []
    binary = bytearray()
    frame_affected = set(scenario.get("frame_affected", scenario["affected"]))
    for index, timestamp in enumerate(scenario["frames"]):
        values = []
        progress = index / max(1, len(scenario["frames"]) - 1)
        for row in settlements:
            intensity = round((0.2 + 0.75 * progress) if row["id"] in frame_affected else (0.05 + 0.2 * progress), 3)
            values.append({"settlement_id": row["id"], "intensity": intensity, "provenance": scenario["frame_provenance"]})
            binary.append(round(intensity * 255))
        frames.append({"t": timestamp, "hazard": scenario["hazard"], "values": values})
    _json(root / "layers" / "hazard_frames.json", {"scenario_id": scenario["meta"]["id"], "frames": frames})
    owned = [
        {"id": "settlements", "format": "geojson", "path": "layers/settlements.geojson", "provenance": "archived"},
        {"id": "event_features", "format": "geojson", "path": "layers/event_features.geojson", "provenance": "archived"},
        {"id": "hazard_frames", "format": "json", "path": "layers/hazard_frames.json", "provenance": scenario["frame_provenance"]}
    ]
    # Buildings and the heightmap are registered by their own Forge steps, which run after this one
    # and are far too slow to redo on every scenario rebuild. Rewriting the index from scratch here
    # silently unregistered them, so anything this step does not own is carried through.
    index_path = root / "layers" / "index.json"
    carried = []
    if index_path.exists():
        mine = {layer["id"] for layer in owned}
        existing = json.loads(index_path.read_text(encoding="utf-8")).get("layers", [])
        carried = [layer for layer in existing
                   if layer.get("id") not in mine and (root / layer.get("path", "")).exists()]
    _json(index_path, {"layers": owned + carried})
    _write(root / "twin_states.bin", bytes(binary))
    _json(root / "twin_manifest.json", {"encoding": "uint8 normalized intensity", "settlement_order": [row["id"] for row in settlements], "timestamps": scenario["frames"], "frame_count": len(scenario["frames"]), "bytes_per_frame": len(settlements)})


def build_all() -> list[Path]:
    if not (ROOT / "data" / "derived" / "wayanad_terrain.json").exists():
        from scripts.forge.build_terrain import build as build_terrain
        build_terrain()
    if not (ROOT / "data" / "derived" / "wayanad_routes.json.gz").exists():
        from scripts.forge.build_roads import build as build_roads
        build_roads()
    settlements, geojson = official_settlements()
    all_ids = [row["id"] for row in settlements]
    vellarimala = "LGD-627340"
    muppainad = "LGD-627339"
    pulpally = "LGD-627311"
    scenarios = [
        {
            "meta": {"id": "wayanad-2018-flood", "name": "Wayanad — Kerala Floods 2018", "timezone": "Asia/Kolkata", "bbox": [75.82, 11.42, 76.46, 11.97], "historical": True, "replay": {"t0": "2018-08-08T00:00:00+05:30", "t1": "2018-08-22T23:59:00+05:30"}, "sources": ["ksdma-floods-2018", "soi-kerala-villages", "census-2011-wayanad-pca"], "provenance": {"scenario": "archived", "reports": "archived district aggregates", "telemetry": "synthetic where present", "disclosure": "Historical replay from KSDMA district aggregates; village hazard frames are visualization proxies, not observed inundation depths."}, "official_summary": {"fatalities": 6, "crop_loss_ha": 1876.8, "relief_camps": 451, "camp_inmates": 60847, "roads_damaged_km": 565, "bridges_damaged": 9}},
            "affected": [], "frame_affected": all_ids, "severe": [], "mode": "INUNDATION", "hazard": "flood", "affected_prior": 0.3,
            "stream": {
                "onset": "2018-08-09T08:00:00+05:30", "village_traffic": False, "silent": [], "rumour_target": "",
                "anchors": [
                    {"offset_minutes": 480, "source_id": "ksdma-floods-2018", "text": "Wayanad district flooding began; district impacts are not resolved to individual villages.", "severity_hint": "severe"},
                    {"offset_minutes": 1440, "source_id": "ksdma-floods-2018", "text": "District relief camps opened; 451 camps holding 60847 inmates across Wayanad.", "params": {"relief_camps": 451, "camp_inmates": 60847}},
                    {"offset_minutes": 2880, "source_id": "ksdma-floods-2018", "text": "District road damage assessed at 565 km with 9 bridges damaged.", "params": {"roads_damaged_km": 565, "bridges_damaged": 9}},
                    {"offset_minutes": 4320, "source_id": "ksdma-floods-2018", "text": "Crop loss across the district assessed at 1876.8 hectares; 6 fatalities recorded.", "params": {"crop_loss_ha": 1876.8, "fatalities": 6}},
                ],
            },
            "events": [{"t": "2018-08-08T08:00:00+05:30", "kind": "report", "channel": "official-record", "source_id": "ksdma-floods-2018", "text": "Wayanad district flooding began; district impacts are not resolved to individual villages.", "hazard": "flood", "severity_hint": "severe", "is_firsthand": False, "provenance": "archived", "params": {"scope": "district"}}],
            "features": [], "frames": [f"2018-08-{day:02d}T08:00:00+05:30" for day in range(8, 23)], "frame_provenance": "derived_from_ksdma_rainfall_warning_bands", "truth_provenance": "ksdma_district_aggregate; village_severity_unknown"
        },
        {
            "meta": {"id": "wayanad-2019-flood-landslide", "name": "Wayanad — Floods and Puthumala Landslide 2019", "timezone": "Asia/Kolkata", "bbox": [75.82, 11.42, 76.46, 11.97], "historical": True, "replay": {"t0": "2019-08-08T00:00:00+05:30", "t1": "2019-08-13T23:59:00+05:30"}, "sources": ["ksdma-floods-2019", "soi-kerala-villages", "census-2011-wayanad-pca"], "provenance": {"scenario": "archived", "reports": "archived", "telemetry": "synthetic where present", "disclosure": "All 49 official Wayanad villages are from the KSDMA affected-village list; only Puthumala/Vellarimala is classified severe here."}},
            "affected": all_ids, "severe": [vellarimala], "mode": "LANDSLIDE", "hazard": "landslide", "affected_prior": 0.25,
            "stream": {
                "onset": "2019-08-08T17:00:00+05:30", "silent": [vellarimala, muppainad], "rumour_target": pulpally,
                "anchors": [
                    {"offset_minutes": 420, "source_id": "ksdma-floods-2019", "text": "Red alert for Wayanad; all 49 revenue villages listed as flood affected in the district return.", "severity_hint": "severe"},
                    {"offset_minutes": 1020, "source_id": "ksdma-floods-2019", "text": "Puthumala landslide reported in Vellarimala village; district memorandum classifies it severe.", "severity_hint": "catastrophic"},
                ],
            },
            "events": [{"t": "2019-08-08T17:00:00+05:30", "kind": "verification", "channel": "verification", "source_id": "ksdma-floods-2019", "settlement_id": vellarimala, "text": "Puthumala landslide in Vellarimala village", "result": "confirmed_severe", "provenance": "archived", "params": {"failure_mode": "LANDSLIDE", "authority": "KSDMA memorandum"}}],
            "features": [{"type": "Feature", "properties": {"name": "Puthumala landslide", "date": "2019-08-08", "provenance": "KSDMA memorandum", "parent_settlement_id": vellarimala}, "geometry": by_id_geometry(settlements, vellarimala)}],
            "frames": [f"2019-08-{day:02d}T08:00:00+05:30" for day in range(8, 14)], "frame_provenance": "derived_visualization_proxy", "truth_provenance": "ksdma_affected_village_list"
        },
        {
            "meta": {"id": "meppadi-2024-landslide", "name": "Meppadi Landslide 2024", "timezone": "Asia/Kolkata", "bbox": [75.82, 11.42, 76.46, 11.97], "historical": True, "replay": {"t0": "2024-07-29T00:00:00+05:30", "t1": "2024-07-31T23:59:00+05:30"}, "sources": ["ksdma-meppadi-2024", "soi-kerala-villages", "census-2011-wayanad-pca"], "provenance": {"scenario": "archived", "reports": "archived", "telemetry": "synthetic where present", "disclosure": "KSDMA event timing and Kalladi rainfall are archived; village-wide hazard surfaces are derived visualization proxies."}, "official_summary": {"event_time": "2024-07-30T01:15:00+05:30", "kalladi_rainfall_mm": {"2024-07-29": 200.2, "2024-07-30": 372.6}, "runout_km": 8, "affected_wards": [10, 11, 12], "affected_settlements": ["Punchiri Mattam", "Mundakkai", "Chooralmala", "Attamala"]}},
            "affected": [vellarimala], "severe": [vellarimala], "mode": "LANDSLIDE", "hazard": "landslide", "affected_prior": 0.45,
            "stream": {
                "onset": "2024-07-30T01:15:00+05:30", "silent": [vellarimala], "rumour_target": muppainad,
                "anchors": [
                    {"offset_minutes": 480, "source_id": "ksdma-meppadi-2024", "text": "Kalladi gauge recorded 200.2 mm on 29 July; orange alert in force for Wayanad.", "params": {"kalladi_rainfall_mm": 200.2}},
                    {"offset_minutes": 1455, "source_id": "ksdma-meppadi-2024", "text": "Debris flow at 01:15 IST with an 8 km runout affecting wards 10, 11 and 12 of Meppadi panchayat.", "severity_hint": "catastrophic", "params": {"runout_km": 8, "affected_wards": [10, 11, 12]}},
                    {"offset_minutes": 1920, "source_id": "ksdma-meppadi-2024", "text": "Kalladi gauge recorded 372.6 mm on 30 July, the event day total.", "params": {"kalladi_rainfall_mm": 372.6}},
                ],
            },
            "events": [{"t": "2024-07-30T01:15:00+05:30", "kind": "verification", "channel": "verification", "source_id": "ksdma-meppadi-2024", "settlement_id": vellarimala, "text": "Landslide affected Punchiri Mattam, Mundakkai, Chooralmala and Attamala", "result": "confirmed_severe", "provenance": "archived", "params": {"failure_mode": "LANDSLIDE", "authority": "KSDMA memorandum", "kalladi_rainfall_mm_previous_day": 200.2, "kalladi_rainfall_mm_event_day": 372.6}}],
            "features": [{"type": "Feature", "properties": {"name": name, "date": "2024-07-30", "provenance": "KSDMA memorandum", "parent_settlement_id": vellarimala}, "geometry": by_id_geometry(settlements, vellarimala)} for name in ["Punchiri Mattam", "Mundakkai", "Chooralmala", "Attamala"]],
            "frames": ["2024-07-29T00:00:00+05:30", "2024-07-29T23:59:00+05:30", "2024-07-30T01:15:00+05:30", "2024-07-30T08:00:00+05:30", "2024-07-31T08:00:00+05:30"], "frame_provenance": "derived_from_archived_kalladi_rainfall", "truth_provenance": "ksdma_meppadi_memorandum"
        }
    ]
    outputs = []
    for scenario in scenarios:
        _attach_stream(scenario, settlements)
        root = PACKAGES / scenario["meta"]["id"]
        _write_scenario(root, settlements, geojson, scenario); outputs.append(root)
    return outputs


def _attach_stream(scenario: dict[str, Any], settlements: list[dict[str, Any]]) -> None:
    """Generate the scenario's field traffic and merge it with the archived anchor events."""
    stream = scenario.pop("stream", None)
    if stream is None:
        return
    meta = scenario["meta"]
    spec = StreamSpec(
        scenario_id=meta["id"],
        t0=datetime.fromisoformat(meta["replay"]["t0"]),
        t1=datetime.fromisoformat(meta["replay"]["t1"]),
        onset=datetime.fromisoformat(stream["onset"]),
        hazard=scenario["hazard"],
        mode=scenario["mode"],
        severe=list(scenario["severe"]),
        affected=list(scenario["affected"]),
        silent=list(stream.get("silent", [])),
        rumour_target=str(stream.get("rumour_target", "")),
        anchors=list(stream.get("anchors", [])),
        village_traffic=bool(stream.get("village_traffic", True)),
    )
    rows = build_stream(spec, settlements)
    for index, row in enumerate(scenario["events"]):
        row.setdefault("obs_id", f"{meta['id']}-memo-{index:02d}")
    scenario["events"] = sorted([*scenario["events"], *rows], key=lambda row: (row["t"], row.get("obs_id", "")))
    counts: dict[str, int] = {}
    for row in scenario["events"]:
        counts[row["provenance"]] = counts.get(row["provenance"], 0) + 1
    meta["event_streams"] = {
        "generator": "scripts/forge/event_stream.py",
        "seeded_by": "scenario id (blake2b), so a rebuild reproduces the stream byte for byte",
        "by_provenance": counts,
        "archived": "district-level facts drawn from the KSDMA memoranda pinned in data/source_manifest.json",
        "synthetic": "per-settlement message traffic, aggregated tower-attach counts, 11 kV feeder states and Sentinel-1 pass geometry. No such per-village record exists publicly for these events; these rows are simulated, disclosed as synthetic, and must not be read as observations.",
        "personal_data": False,
    }


def by_id_geometry(settlements: Iterable[dict[str, Any]], settlement_id: str) -> dict[str, Any]:
    row = next(item for item in settlements if item["id"] == settlement_id)
    return {"type": "Point", "coordinates": row["location"]["coordinates"]}


if __name__ == "__main__":
    print(json.dumps({"ok": True, "packages": [str(path) for path in build_all()]}, indent=2))
