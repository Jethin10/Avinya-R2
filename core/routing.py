"""Pure route degradation model for offline OSM route artifacts."""

from __future__ import annotations

from typing import Any, Mapping


SENSITIVITY = {
    "medical": {"INUNDATION": 0.95, "LANDSLIDE": 0.90, "COLLAPSE": 0.55},
    "excavator": {"INUNDATION": 0.60, "LANDSLIDE": 0.65, "COLLAPSE": 0.35},
    "boat": {"INUNDATION": 0.15, "LANDSLIDE": 0.85, "COLLAPSE": 0.45},
}


def assess_route(
    route: Mapping[str, Any],
    beliefs: Mapping[str, Mapping[str, float]],
    *,
    cut_edges: set[str] | None = None,
) -> dict[str, Any]:
    """Return route passability and ETA from per-segment hazard beliefs.

    This deliberately returns a conservative blend of the bottleneck and length-weighted
    mean. Multiplying hundreds of edge probabilities would make every long route impossible.
    """
    asset = str(route["asset_kind"]); sensitivity = SENSITIVITY[asset]
    weighted = 0.0; total_length = 0.0; bottleneck = 1.0; critical = None
    cuts = cut_edges or set()
    for segment in route.get("segments", []):
        sid = str(segment["settlement_id"]); modes = beliefs.get(sid, {})
        hazard = max((float(modes.get(mode, 0.0)) * factor for mode, factor in sensitivity.items()), default=0.0)
        probability = float(segment.get("base_passability", 0.95)) * max(0.02, 1.0 - hazard)
        if str(segment["way_id"]) in cuts or f"osm-way-{segment['way_id']}" in cuts:
            probability = 0.0
        length = float(segment.get("length_m", 1.0)); weighted += probability * length; total_length += length
        if probability < bottleneck:
            bottleneck = probability; critical = segment
    mean = weighted / total_length if total_length else 1.0
    passability = max(0.0, min(1.0, 0.6 * bottleneck + 0.4 * mean))
    normal_eta = float(route.get("eta_minutes_normal", 0.0))
    eta = normal_eta / max(0.1, passability)
    status = "open" if passability >= 0.7 else "degraded" if passability >= 0.35 else "blocked"
    return {
        "route_id": route["id"], "passability": round(passability, 4), "status": status,
        "eta_minutes": round(eta, 1), "distance_km": route.get("distance_km"),
        "critical_way_id": critical.get("way_id") if critical else None,
        "critical_settlement_id": critical.get("settlement_id") if critical else None,
    }
