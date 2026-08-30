"""Crop the 30 m Copernicus DEM and GLO-30 HAND rasters into a browser-sized district terrain grid.

The district scene is real ground, not art: the mesh the camera pans over is this grid, and the
flood surface is drawn against the HAND grid beside it, so raising the water by a metre wets the
cells that are actually within a metre of their nearest drainage.

The source is 3600 × 3600 per one-degree tile — four and a half million posts across Wayanad, which
is more than a browser needs and far more than it can afford to download. Sampling every eighth post
gives roughly 250 m spacing: coarse enough to ship, fine enough that the Western Ghats escarpment
the 2024 landslide came off still reads as an escarpment.
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


SOURCES = ROOT / "data" / "sources"
PACKAGES = ROOT / "district_package"
RESOLUTION = 1 / 3600
ATTRIBUTION = (
    "Elevation: Copernicus DEM GLO-30, © European Union / ESA. Height above nearest drainage: "
    "GLO-30 HAND v1/2021, Alaska Satellite Facility, CC0 1.0."
)
# Posts per grid cell. Eight gives ~247 m spacing, which puts Wayanad's 0.64° × 0.55° extent at
# roughly 288 × 248 — about 71,000 samples, a few hundred kilobytes gzipped as int16 metres.
STRIDE = 8
NO_DATA = -32768


def _tiles(name: str) -> dict[int, np.ndarray]:
    return {
        75: tifffile.imread(SOURCES / f"{name}_n11_e075.tif"),
        76: tifffile.imread(SOURCES / f"{name}_n11_e076.tif"),
    }


def _grid(tiles: dict[int, np.ndarray], longitudes: np.ndarray, latitudes: np.ndarray,
          floor: float | None = None) -> np.ndarray:
    """Sample a mosaic of one-degree tiles onto a lon/lat grid, rows running north to south.

    Both tiles here span latitude 11–12, so a row is the same row in either; only the column and
    which tile it belongs to change with longitude. Posts that fall outside a tile, or carry the
    raster's own fill value, come back as ``NO_DATA`` and the frontend leaves them unshaded.
    """
    rows = np.rint((12.0 - latitudes) / RESOLUTION).astype(np.int64)
    output = np.full((latitudes.size, longitudes.size), NO_DATA, dtype=np.int16)
    for west, array in tiles.items():
        selection = (longitudes >= west) & (longitudes < west + 1)
        if not selection.any():
            continue
        columns = np.rint((longitudes[selection] - west) / RESOLUTION).astype(np.int64)
        columns = np.clip(columns, 0, array.shape[1] - 1)
        valid_rows = np.clip(rows, 0, array.shape[0] - 1)
        patch = array[np.ix_(valid_rows, columns)].astype(np.float64)
        patch[~np.isfinite(patch)] = NO_DATA
        patch[(patch < -100) | (patch > 10000)] = NO_DATA
        if floor is not None:
            usable = patch != NO_DATA
            patch[usable] = np.maximum(patch[usable], floor)
        output[:, selection] = np.rint(patch).astype(np.int16)
    return output


def _axes(bbox: list[float]) -> tuple[np.ndarray, np.ndarray, float]:
    """Grid axes snapped to DEM posts: longitudes west to east, latitudes north to south."""
    west, south, east, north = bbox
    step = STRIDE * RESOLUTION
    columns = int(math.floor((east - west) / step)) + 1
    rows = int(math.floor((north - south) / step)) + 1
    longitudes = west + step * np.arange(columns)
    latitudes = north - step * np.arange(rows)
    return longitudes, latitudes, step


def _archived(package: Path) -> bool:
    meta = json.loads((package / "meta.json").read_text(encoding="utf-8"))
    return meta.get("provenance", {}).get("scenario") != "synthetic"


def _register(package: Path, entry: dict[str, str]) -> None:
    path = package / "layers" / "index.json"
    index = json.loads(path.read_text(encoding="utf-8"))
    index["layers"] = [layer for layer in index["layers"] if layer["id"] != entry["id"]] + [entry]
    path.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")


def build(scenarios: list[str] | None = None) -> list[dict[str, Any]]:
    dem = _tiles("copernicus_dem")
    hand = _tiles("glo30_hand")
    targets = scenarios or [
        directory.name for directory in sorted(PACKAGES.iterdir())
        if (directory / "meta.json").exists() and _archived(directory)
    ]

    results: list[dict[str, Any]] = []
    for scenario in targets:
        package = PACKAGES / scenario
        meta = json.loads((package / "meta.json").read_text(encoding="utf-8"))
        bbox = meta["bbox"]
        longitudes, latitudes, step = _axes(bbox)
        elevation = _grid(dem, longitudes, latitudes)
        drainage = _grid(hand, longitudes, latitudes, floor=0.0)
        usable = elevation[elevation != NO_DATA]
        payload = {
            "schema_version": 1,
            "scenario_id": scenario,
            "provenance": "archived",
            "attribution": ATTRIBUTION,
            "bbox": [round(float(longitudes[0]), 6), round(float(latitudes[-1]), 6),
                     round(float(longitudes[-1]), 6), round(float(latitudes[0]), 6)],
            "width": int(longitudes.size),
            "height": int(latitudes.size),
            "step_degrees": round(step, 8),
            "metres_per_cell": round(step * 111_320 * math.cos(math.radians(float(latitudes.mean()))), 1),
            "row_order": "north_to_south",
            "units": "metres",
            "no_data": NO_DATA,
            "elevation_range": [int(usable.min()), int(usable.max())] if usable.size else None,
            "elevation": elevation.reshape(-1).tolist(),
            # Height above nearest drainage, the same field the settlement flood susceptibility is
            # built on. A cell is under water at flood stage s where hand <= s.
            "hand": drainage.reshape(-1).tolist(),
        }
        output = package / "layers" / "heightmap.json.gz"
        with gzip.open(output, "wt", encoding="utf-8", compresslevel=9) as handle:
            json.dump(payload, handle, separators=(",", ":"))
        _register(package, {
            "id": "heightmap",
            "format": "json.gz",
            "path": "layers/heightmap.json.gz",
            "provenance": "archived",
        })
        results.append({
            "scenario_id": scenario,
            "grid": [payload["width"], payload["height"]],
            "metres_per_cell": payload["metres_per_cell"],
            "elevation_range": payload["elevation_range"],
            "no_data_cells": int((elevation == NO_DATA).sum()),
            "bytes": output.stat().st_size,
        })
    return results


if __name__ == "__main__":
    print(json.dumps({"ok": True, "packages": build()}, indent=2))
