"""Stand-in severity for the districts the engine has no numbers for.

The atlas ships archived boundaries for eight states and roughly two hundred districts. Exactly one
of those districts - Wayanad - has a district package behind it, which means real terrain, real
settlements, real routes and a belief engine with evidence to reason about. Every other district on
the map is geography with nothing behind it.

The Twin still has to draw them, and drawing them blank reads as "nothing is happening here", which
is a claim this repository has no basis for. So each of them gets an authored severity instead,
written to its own file, served with its own ``synthetic`` provenance header, and never merged into
``atlas.json`` - because that file's boundaries are archived and the two must not share a frame.

What makes these numbers *plausible* rather than random is that they are conditioned on things that
are actually true: a district's latitude, its distance from the coastline of its own state, its area,
and the hazard its state is known for. Uttarakhand districts slide, Odisha's coast floods and blows,
inland Karnataka mostly does neither. The magnitude within that character is hashed from the district
id, so a rebuild reproduces the same map byte for byte and a demo is never a different demo twice.

None of this is a forecast. It is set dressing with an honest label, and every consumer is told so.
"""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any

from engine.config import ROOT


ATLAS = ROOT / "district_package" / "_atlas"
OUTPUT = ATLAS / "stand_ins.json"

DISCLOSURE = (
    "Authored severity for districts with no engine behind them. Conditioned on real geography "
    "(latitude, coastal proximity, area) and the hazard character of the state, seeded from the "
    "district id so it is reproducible. It is not a forecast, not an observation, and not an "
    "assessment of any real event."
)

# What each state's terrain and monsoon actually tend to produce, as a weighting over the failure
# modes the engine already models. There is no EARTHQUAKE mode and no need for one: shaking arrives
# as collapse, casualty and slope failure (see ``core.seismic``). Weights are read off the hazard
# each state is repeatedly in the news for, not off a hazard atlas, and are declared as such.
CHARACTER: dict[str, dict[str, float]] = {
    "kerala": {"INUNDATION": 0.46, "LANDSLIDE": 0.34, "COLLAPSE": 0.12, "WIND": 0.08},
    "tamil-nadu": {"INUNDATION": 0.40, "WIND": 0.34, "COLLAPSE": 0.16, "LANDSLIDE": 0.10},
    "karnataka": {"INUNDATION": 0.38, "LANDSLIDE": 0.24, "COLLAPSE": 0.24, "WIND": 0.14},
    "maharashtra": {"INUNDATION": 0.40, "LANDSLIDE": 0.26, "COLLAPSE": 0.22, "WIND": 0.12},
    "uttarakhand": {"LANDSLIDE": 0.56, "INUNDATION": 0.26, "COLLAPSE": 0.16, "WIND": 0.02},
    "himachal-pradesh": {"LANDSLIDE": 0.58, "INUNDATION": 0.24, "COLLAPSE": 0.16, "WIND": 0.02},
    "assam": {"INUNDATION": 0.58, "LANDSLIDE": 0.22, "COLLAPSE": 0.12, "WIND": 0.08},
    "odisha": {"INUNDATION": 0.42, "WIND": 0.38, "COLLAPSE": 0.14, "LANDSLIDE": 0.06},
}
DEFAULT_CHARACTER = {"INUNDATION": 0.40, "LANDSLIDE": 0.25, "COLLAPSE": 0.25, "WIND": 0.10}

# Which of these states have a sea border at all. Declared rather than derived because the outline
# proxy below cannot tell a coast from a frontier, and calling a Himalayan border district "coastal"
# would put cyclone weighting on ground that has never seen one.
COASTAL_STATES = frozenset({"kerala", "tamil-nadu", "karnataka", "maharashtra", "odisha"})

HAZARD = {"INUNDATION": "flood", "LANDSLIDE": "landslide", "COLLAPSE": "structural", "WIND": "cyclone"}
# The dispatch layer types assets by failure mode; the stand-in keeps that mapping so a district's
# authored requirement is expressed in the same vocabulary the real plan uses.
ASSET = {"INUNDATION": "boat", "LANDSLIDE": "excavator", "COLLAPSE": "excavator", "WIND": "medical"}


def _jitter(*parts: str) -> float:
    """A stable pseudo-random number in [0, 1) from the district's own identity."""
    digest = hashlib.blake2b("/".join(parts).encode("utf-8"), digest_size=8).digest()
    return int.from_bytes(digest, "big") / 2**64


def _area_km2(rings: list[list[list[float]]]) -> float:
    """Spherical-ish polygon area: shoelace in degrees, scaled by the latitude of each ring."""
    total = 0.0
    for ring in rings:
        if len(ring) < 4:
            continue
        shoelace = 0.0
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            shoelace += x1 * y2 - x2 * y1
        mean_latitude = sum(point[1] for point in ring) / len(ring)
        scale = (111.32**2) * math.cos(math.radians(mean_latitude))
        total += abs(shoelace) / 2 * scale
    return total


def _coastal_proximity(state: str, centroid: list[float], state_rings: list[list[list[float]]]) -> float:
    """How close this district sits to the sea, as 1 at the coast falling to 0 well inland.

    There is no coastline file here, so the sea is inferred the way a reader of a map infers it:
    the state's own outline is its coast wherever it is not a border with another state, and a
    district whose centre is close to the outline is either coastal or on a frontier. That
    conflation is acceptable for set dressing - a frontier district in the hills is one the
    landslide weighting already dominates - and it costs nothing to compute.
    """
    if state not in COASTAL_STATES:
        return 0.0
    longitude, latitude = centroid
    nearest = float("inf")
    for ring in state_rings:
        for point in ring:
            east = (point[0] - longitude) * 111.32 * math.cos(math.radians(latitude))
            north = (point[1] - latitude) * 110.57
            nearest = min(nearest, east * east + north * north)
    if not math.isfinite(nearest):
        return 0.0
    distance = math.sqrt(nearest)
    return round(max(0.0, 1.0 - distance / 60.0), 4)


def _mode(state: str, latitude: float, coastal: float, seed: float) -> str:
    """Draw a failure mode from the state's character, tilted by where the district actually is."""
    weights = dict(CHARACTER.get(state, DEFAULT_CHARACTER))
    # Above roughly 29 degrees north in these states you are in the Himalaya; slopes dominate.
    if latitude > 29.0:
        weights["LANDSLIDE"] = weights.get("LANDSLIDE", 0.0) * 1.6
    weights["WIND"] = weights.get("WIND", 0.0) * (0.25 + 1.75 * coastal)
    weights["INUNDATION"] = weights.get("INUNDATION", 0.0) * (0.7 + 0.6 * coastal)
    total = sum(weights.values()) or 1.0
    cursor = seed * total
    for mode, weight in sorted(weights.items(), key=lambda item: (-item[1], item[0])):
        cursor -= weight
        if cursor <= 0:
            return mode
    return "INUNDATION"


def _district(state: dict[str, Any], district: dict[str, Any]) -> dict[str, Any]:
    seed = _jitter(state["id"], district["id"])
    longitude, latitude = district["centroid"]
    coastal = _coastal_proximity(state["id"], district["centroid"], state["rings"])
    mode = _mode(state["id"], latitude, coastal, seed)
    area = _area_km2(district["rings"])
    # Severity is deliberately mid-band and wide: a map where every district is a crisis is as
    # uninformative as one where none is. Two thirds of them land below 0.5.
    severity = round(min(0.94, max(0.05, 0.18 + 0.62 * _jitter("severity", district["id"]) ** 1.5)), 3)
    # Settlement counts scale with area at roughly the density Wayanad's real package shows (49
    # settlements over about 2100 km2), which keeps a large district from looking emptier than a
    # small one for no reason.
    settlements = max(4, int(round(area / 43.0)))
    severe = int(round(settlements * severity * 0.28))
    return {
        "district_id": district["id"],
        "state_id": state["id"],
        "name": district["name"],
        "failure_mode": mode,
        "hazard": HAZARD[mode],
        "asset_kind": ASSET[mode],
        "severity": severity,
        "coastal_proximity": coastal,
        "area_km2": round(area, 1),
        "settlements_estimated": settlements,
        "settlements_severe": severe,
        "assets_requested": max(1, int(round(severe * 0.6))),
        "confidence": "none",
        "provenance": "synthetic",
    }


def build() -> Path:
    atlas_path = ATLAS / "atlas.json"
    if not atlas_path.exists():
        raise FileNotFoundError("Run `python -m scripts.forge.build_atlas` first")
    atlas = json.loads(atlas_path.read_text(encoding="utf-8"))

    districts: dict[str, dict[str, Any]] = {}
    states: dict[str, dict[str, Any]] = {}
    for state in atlas["states"]:
        rows = []
        for district in state["districts"]:
            # A district with a package behind it is the engine's to describe. Writing a stand-in
            # for it would put an authored number and a computed one in the same field, and the
            # frontend would have no way to tell which it was showing.
            if district["scenarios"]:
                continue
            row = _district(state, district)
            districts[f"{state['id']}/{district['id']}"] = row
            rows.append(row)
        tally: dict[str, int] = {}
        for row in rows:
            tally[row["failure_mode"]] = tally.get(row["failure_mode"], 0) + 1
        states[state["id"]] = {
            "state_id": state["id"],
            "name": state["name"],
            "stand_in_districts": len(rows),
            "live_districts": state["live_district_count"],
            "mean_severity": round(sum(row["severity"] for row in rows) / len(rows), 3) if rows else None,
            "dominant_failure_mode": max(tally, key=lambda mode: (tally[mode], mode)) if tally else None,
            "failure_mode_counts": dict(sorted(tally.items())),
            "worst": sorted(rows, key=lambda row: (-row["severity"], row["district_id"]))[0]["district_id"] if rows else None,
        }

    payload = {
        "schema_version": 1,
        "provenance": {"severity": "synthetic", "geometry": "archived", "disclosure": DISCLOSURE},
        "model": {
            "character": "per-state failure-mode weighting, tilted by latitude and coastal proximity",
            "seed": "blake2b of state/district id, so a rebuild reproduces this file exactly",
            "excluded": "districts carrying a scenario, which the engine describes instead",
        },
        "states": states,
        "districts": districts,
    }
    ATLAS.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return OUTPUT


def main() -> None:
    path = build()
    payload = json.loads(path.read_text(encoding="utf-8"))
    print(json.dumps({
        "ok": True, "path": str(path), "bytes": path.stat().st_size,
        "districts": len(payload["districts"]),
        "states": {key: [row["stand_in_districts"], row["dominant_failure_mode"], row["mean_severity"]]
                   for key, row in payload["states"].items()},
    }, indent=1))


if __name__ == "__main__":
    main()
