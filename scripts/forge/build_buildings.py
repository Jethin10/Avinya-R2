"""Turn the OpenStreetMap building snapshot into a per-settlement, per-package building layer.

The Twin needs three things from a building to be useful in a hazard scene: where its walls are,
how tall it stands, and how far its ground sits above the nearest drainage. The first comes from
OSM, the second from OSM where a mapper recorded it and from a disclosed per-use assumption where
nobody did, and the third from the same Copernicus DEM and GLO-30 HAND rasters the settlement
terrain statistics already use — so a flood plane drawn at a given depth wets exactly the buildings
the engine believes are inundated, rather than whichever ones happen to look low.

Buildings outside every settlement polygon are dropped. They are real, but nothing in the engine
reasons about them, and carrying 40,000 footprints into the browser to render context nobody can
click costs more than it shows.
"""

from __future__ import annotations

import gzip
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import tifffile

from engine.config import ROOT
from scripts.forge.build_terrain import _inside, _sample, _slope


SOURCES = ROOT / "data" / "sources"
BUILDINGS = SOURCES / "osm_wayanad_buildings.json"
PACKAGES = ROOT / "district_package"
ATTRIBUTION = (
    "Building footprints: © OpenStreetMap contributors, ODbL 1.0. Ground elevation: Copernicus DEM "
    "GLO-30. Height above nearest drainage: GLO-30 HAND v1/2021, Alaska Satellite Facility."
)

# Storey height in metres, and the storey count assumed for a use when OSM records neither a height
# nor a level count. Kerala's small-town building stock is overwhelmingly one and two storey
# load-bearing masonry; these are deliberately conservative, and every building says which of the
# three routes produced its height.
STOREY_METRES = 3.2
ASSUMED_LEVELS: dict[str, float] = {
    "house": 1.0, "detached": 1.0, "hut": 1.0, "shed": 1.0, "garage": 1.0, "garages": 1.0,
    "farm_auxiliary": 1.0, "barn": 1.0, "greenhouse": 1.0, "roof": 1.0, "carport": 1.0,
    "residential": 1.5, "yes": 1.5, "bungalow": 1.0, "semidetached_house": 1.5,
    "apartments": 3.0, "dormitory": 3.0, "hotel": 3.0, "commercial": 2.0, "retail": 2.0,
    "office": 3.0, "industrial": 2.0, "warehouse": 2.0, "civic": 2.0, "government": 2.0,
    "public": 2.0, "school": 2.0, "college": 3.0, "university": 3.0, "hospital": 3.0,
    "church": 2.0, "temple": 2.0, "mosque": 2.0, "chapel": 1.0, "place_of_worship": 2.0,
    "train_station": 1.0, "transportation": 1.0, "toilets": 1.0, "service": 1.0,
}

# The uses the engine's dispatch logic cares about, collapsed to the handful of roles a responder
# would name on a radio. Everything else is housing or outbuilding.
CRITICAL: dict[str, str] = {
    "hospital": "health", "clinic": "health", "school": "school", "college": "school",
    "university": "school", "kindergarten": "school", "church": "shelter", "temple": "shelter",
    "mosque": "shelter", "chapel": "shelter", "place_of_worship": "shelter", "civic": "civic",
    "government": "civic", "public": "civic", "fire_station": "civic", "police": "civic",
}


def _height(tags: dict[str, str]) -> tuple[float, float | None, str]:
    """Metres, storey count and which of the three routes produced the metres."""
    raw = tags.get("height") or tags.get("building:height")
    if raw:
        try:
            metres = float(str(raw).replace("m", "").strip())
            if 1.5 <= metres <= 300:
                return round(metres, 1), None, "tagged"
        except ValueError:
            pass
    levels = tags.get("building:levels")
    if levels:
        try:
            count = float(str(levels).strip())
            if 0.5 <= count <= 90:
                return round(count * STOREY_METRES, 1), count, "levels"
        except ValueError:
            pass
    use = tags.get("building", "yes")
    count = ASSUMED_LEVELS.get(use, 1.5)
    return round(count * STOREY_METRES, 1), count, "assumed"


def _role(tags: dict[str, str]) -> str | None:
    for key in ("amenity", "building", "healthcare", "office"):
        value = tags.get(key)
        if value and value in CRITICAL:
            return CRITICAL[value]
    return None


def _footprint(geometry: list[dict[str, float]], precision: int = 6) -> list[list[float]] | None:
    """Closed, deduplicated ring in lon/lat, or ``None`` if the way is not a usable polygon.

    OSM building ways are already tight — a dozen vertices for a house — so nothing is simplified
    here; rounding to six decimals is about a tenth of a metre and only trims the JSON.
    """
    ring = [[round(point["lon"], precision), round(point["lat"], precision)] for point in geometry]
    deduplicated = [ring[0]]
    for point in ring[1:]:
        if point != deduplicated[-1]:
            deduplicated.append(point)
    if len(deduplicated) < 3:
        return None
    if deduplicated[0] != deduplicated[-1]:
        deduplicated.append(deduplicated[0])
    return deduplicated


def _area(ring: list[list[float]], latitude: float) -> float:
    """Planar footprint area in square metres, good enough at a building's scale."""
    metres_x = 111_320 * math.cos(math.radians(latitude))
    total = 0.0
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        total += (x1 * metres_x) * (y2 * 110_540) - (x2 * metres_x) * (y1 * 110_540)
    return abs(total) / 2


def _settlement_index(path: Path) -> list[dict[str, Any]]:
    """Settlement polygons with a bounding box each, so a point test is a box test first.

    Forty-nine polygons against forty thousand centroids is two million ray casts done naively;
    rejecting on the box first turns almost all of them into four float comparisons.
    """
    collection = json.loads(path.read_text(encoding="utf-8"))
    index: list[dict[str, Any]] = []
    for feature in collection["features"]:
        geometry = feature["geometry"]
        coordinates = geometry["coordinates"]
        rings = [coordinates[0]] if geometry["type"] == "Polygon" else [part[0] for part in coordinates]
        points = [point for ring in rings for point in ring]
        index.append({
            "id": feature["properties"]["id"],
            "name": feature["properties"].get("name"),
            "rings": rings,
            "box": (
                min(p[0] for p in points), min(p[1] for p in points),
                max(p[0] for p in points), max(p[1] for p in points),
            ),
        })
    return index


def _locate(index: list[dict[str, Any]], lon: float, lat: float) -> str | None:
    for entry in index:
        west, south, east, north = entry["box"]
        if not (west <= lon <= east and south <= lat <= north):
            continue
        if any(_inside((lon, lat), ring) for ring in entry["rings"]):
            return entry["id"]
    return None


def _rasters() -> tuple[dict[int, np.ndarray], dict[int, np.ndarray]]:
    dem = {
        75: tifffile.imread(SOURCES / "copernicus_dem_n11_e075.tif"),
        76: tifffile.imread(SOURCES / "copernicus_dem_n11_e076.tif"),
    }
    hand = {
        75: tifffile.imread(SOURCES / "glo30_hand_n11_e075.tif"),
        76: tifffile.imread(SOURCES / "glo30_hand_n11_e076.tif"),
    }
    return dem, hand


def _candidates() -> list[dict[str, Any]]:
    """Every OSM way that is a usable building, with its footprint, centroid and height resolved."""
    snapshot = json.loads(BUILDINGS.read_text(encoding="utf-8"))
    output: list[dict[str, Any]] = []
    for element in snapshot["elements"]:
        geometry = element.get("geometry")
        tags = element.get("tags") or {}
        if not geometry or tags.get("building") in {"no", "roof:no"}:
            continue
        ring = _footprint(geometry)
        if ring is None:
            continue
        longitudes = [point[0] for point in ring[:-1]]
        latitudes = [point[1] for point in ring[:-1]]
        centroid = (
            round(sum(longitudes) / len(longitudes), 6),
            round(sum(latitudes) / len(latitudes), 6),
        )
        metres, levels, source = _height(tags)
        output.append({
            "id": element["id"],
            "ring": ring,
            "centroid": centroid,
            "height_m": metres,
            "levels": levels,
            "height_source": source,
            "use": tags.get("building", "yes"),
            "role": _role(tags),
            "name": tags.get("name"),
            "area_m2": round(_area(ring, centroid[1]), 1),
        })
    return output


def _archived(package: Path) -> bool:
    """Whether this package's settlements are real places rather than an authored grid.

    The synthetic demonstration package draws its settlements as square cells on a lattice. Real
    OSM footprints landing in those cells would read as observation, and the whole point of the
    provenance rule is that archived and synthetic never share a frame.
    """
    meta = json.loads((package / "meta.json").read_text(encoding="utf-8"))
    return meta.get("provenance", {}).get("scenario") != "synthetic"


def _register(package: Path, entry: dict[str, str]) -> None:
    """Add the layer to the package's layer index, replacing any earlier run's entry."""
    path = package / "layers" / "index.json"
    index = json.loads(path.read_text(encoding="utf-8"))
    index["layers"] = [layer for layer in index["layers"] if layer["id"] != entry["id"]] + [entry]
    path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")


def build(scenarios: list[str] | None = None) -> list[dict[str, Any]]:
    dem, hand = _rasters()
    candidates = _candidates()
    targets = scenarios or [
        directory.name for directory in sorted(PACKAGES.iterdir())
        if (directory / "layers" / "settlements.geojson").exists() and _archived(directory)
    ]

    results: list[dict[str, Any]] = []
    for scenario in targets:
        package = PACKAGES / scenario
        index = _settlement_index(package / "layers" / "settlements.geojson")
        buildings: list[dict[str, Any]] = []
        for candidate in candidates:
            longitude, latitude = candidate["centroid"]
            settlement = _locate(index, longitude, latitude)
            if settlement is None:
                continue
            west = 75 if longitude < 76.0 else 76
            ground = _sample(dem[west], longitude, latitude, west)
            drainage = _sample(hand[west], longitude, latitude, west)
            slope = _slope(dem[west], longitude, latitude, west)
            building = {
                "id": candidate["id"],
                "settlement_id": settlement,
                "footprint": candidate["ring"],
                "centroid": [longitude, latitude],
                "height_m": candidate["height_m"],
                "height_source": candidate["height_source"],
                "area_m2": candidate["area_m2"],
                "use": candidate["use"],
            }
            if candidate["levels"] is not None:
                building["levels"] = candidate["levels"]
            if candidate["role"]:
                building["role"] = candidate["role"]
            if candidate["name"]:
                building["name"] = candidate["name"]
            if ground is not None:
                building["ground_m"] = round(ground, 1)
            if drainage is not None:
                # Depth of water at this footprint for a given flood stage: a building whose ground
                # sits 4 m above the nearest drainage is dry until the stage passes 4 m.
                building["hand_m"] = round(max(0.0, drainage), 1)
            if slope is not None:
                building["slope_deg"] = round(slope, 1)
            buildings.append(building)

        buildings.sort(key=lambda entry: (entry["settlement_id"], entry["id"]))
        points = [point for entry in buildings for point in entry["footprint"]]
        payload = {
            "schema_version": 1,
            "scenario_id": scenario,
            "provenance": "archived",
            "attribution": ATTRIBUTION,
            "snapshot_at": "2026-08-29T19:46:06Z",
            "storey_metres": STOREY_METRES,
            "height_sources": {
                "tagged": "OSM height tag",
                "levels": "OSM building:levels × storey_metres",
                "assumed": "per-use storey assumption; disclosed, not surveyed",
            },
            "count": len(buildings),
            "bbox": [
                round(min(p[0] for p in points), 6), round(min(p[1] for p in points), 6),
                round(max(p[0] for p in points), 6), round(max(p[1] for p in points), 6),
            ] if points else None,
            "buildings": buildings,
        }
        output = package / "layers" / "buildings.json.gz"
        with gzip.open(output, "wt", encoding="utf-8", compresslevel=9) as handle:
            json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        _register(package, {
            "id": "buildings",
            "format": "json.gz",
            "path": "layers/buildings.json.gz",
            "provenance": "archived",
        })
        tally: dict[str, int] = {}
        for building in buildings:
            tally[building["height_source"]] = tally.get(building["height_source"], 0) + 1
        results.append({
            "scenario_id": scenario,
            "buildings": len(buildings),
            "settlements_with_buildings": len({entry["settlement_id"] for entry in buildings}),
            "height_sources": tally,
            "bytes": output.stat().st_size,
        })
    return results


if __name__ == "__main__":
    print(json.dumps({"ok": True, "candidates_source": str(BUILDINGS), "packages": build()}, indent=2))
