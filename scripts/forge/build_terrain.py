"""Derive settlement terrain and flood-susceptibility statistics from 30 m COGs."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import tifffile

from engine.config import ROOT
from scripts.forge.historical import official_settlements


SOURCES = ROOT / "data" / "sources"
OUTPUT = ROOT / "data" / "derived" / "wayanad_terrain.json"
RESOLUTION = 1 / 3600


def _rings(geometry: dict[str, Any]) -> list[list[list[float]]]:
    coordinates = geometry["coordinates"]
    return [coordinates[0]] if geometry["type"] == "Polygon" else [polygon[0] for polygon in coordinates]


def _inside(point: tuple[float, float], ring: list[list[float]]) -> bool:
    x, y = point; inside = False; previous = ring[-1]
    for current in ring:
        x1, y1 = previous; x2, y2 = current
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            inside = not inside
        previous = current
    return inside


def _sample(array: np.ndarray, lon: float, lat: float, west: int) -> float | None:
    row = int((12.0 - lat) / RESOLUTION); column = int((lon - west) / RESOLUTION)
    if not (1 <= row < array.shape[0] - 1 and 1 <= column < array.shape[1] - 1): return None
    value = float(array[row, column])
    return value if math.isfinite(value) and -100 < value < 10000 else None


def _slope(array: np.ndarray, lon: float, lat: float, west: int) -> float | None:
    row = int((12.0 - lat) / RESOLUTION); column = int((lon - west) / RESOLUTION)
    if not (1 <= row < array.shape[0] - 1 and 1 <= column < array.shape[1] - 1): return None
    metres_x = 30.92 * math.cos(math.radians(lat)); metres_y = 30.72
    dx = (float(array[row, column + 1]) - float(array[row, column - 1])) / (2 * metres_x)
    dy = (float(array[row - 1, column]) - float(array[row + 1, column])) / (2 * metres_y)
    value = math.degrees(math.atan(math.sqrt(dx * dx + dy * dy)))
    return value if math.isfinite(value) else None


def _percentile(values: list[float], value: int) -> float:
    return round(float(np.percentile(np.asarray(values), value)), 2)


def build() -> Path:
    dem_paths = {75: SOURCES / "copernicus_dem_n11_e075.tif", 76: SOURCES / "copernicus_dem_n11_e076.tif"}
    hand_paths = {75: SOURCES / "glo30_hand_n11_e075.tif", 76: SOURCES / "glo30_hand_n11_e076.tif"}
    dem = {west: tifffile.imread(path) for west, path in dem_paths.items()}
    hand = {west: tifffile.imread(path) for west, path in hand_paths.items()}
    settlements, _ = official_settlements()
    statistics: dict[str, Any] = {}
    step = 0.002
    for settlement in settlements:
        rings = _rings(settlement["geometry"]); points = [point for ring in rings for point in ring]
        min_lon, max_lon = min(p[0] for p in points), max(p[0] for p in points)
        min_lat, max_lat = min(p[1] for p in points), max(p[1] for p in points)
        sample_points = []
        lat = min_lat + step / 2
        while lat <= max_lat:
            lon = min_lon + step / 2
            while lon <= max_lon:
                if any(_inside((lon, lat), ring) for ring in rings): sample_points.append((lon, lat))
                lon += step
            lat += step
        if not sample_points: sample_points = [tuple(settlement["location"]["coordinates"])]
        elevations: list[float] = []; slopes: list[float] = []; hand_values: list[float] = []
        for lon, lat in sample_points:
            west = 75 if lon < 76 else 76
            elevation = _sample(dem[west], lon, lat, west); hand_value = _sample(hand[west], lon, lat, west); slope = _slope(dem[west], lon, lat, west)
            if elevation is not None: elevations.append(elevation)
            if hand_value is not None: hand_values.append(hand_value)
            if slope is not None: slopes.append(slope)
        if not elevations or not hand_values or not slopes: raise ValueError(f"No valid terrain samples for {settlement['id']}")
        elevation_relief = _percentile(elevations, 90) - _percentile(elevations, 10)
        flood = math.exp(-max(0.0, _percentile(hand_values, 25)) / 8.0)
        landslide = min(1.0, _percentile(slopes, 90) / 35.0) * min(1.0, max(0.15, elevation_relief / 450.0))
        statistics[settlement["id"]] = {
            "sample_count": len(sample_points),
            "elevation_m": {"mean": round(float(np.mean(elevations)), 2), "p10": _percentile(elevations, 10), "p90": _percentile(elevations, 90)},
            "slope_deg": {"mean": round(float(np.mean(slopes)), 2), "p90": _percentile(slopes, 90)},
            "hand_m": {"mean": round(float(np.mean(hand_values)), 2), "p10": _percentile(hand_values, 10), "p25": _percentile(hand_values, 25)},
            "susceptibility": {"inundation": round(flood, 5), "landslide": round(landslide, 5)},
            "provenance": {"elevation_slope": "Copernicus DEM GLO-30 2021", "hand": "ASF GLO-30 HAND v1/2021 CC0", "method": "polygon grid sample at ~220 m; Horn-style central-difference slope"},
        }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    source_hashes = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in [*dem_paths.values(), *hand_paths.values()]}
    OUTPUT.write_text(json.dumps({"schema_version": 1, "sources": source_hashes, "statistics": statistics}, indent=2), encoding="utf-8")
    return OUTPUT


if __name__ == "__main__":
    output = build(); print(json.dumps({"ok": True, "terrain": str(output), "bytes": output.stat().st_size}))
