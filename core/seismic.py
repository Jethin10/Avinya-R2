"""Seismic shaking for the district: epicentre and magnitude in, per-settlement damage out.

The engine has no EARTHQUAKE failure mode and does not need one. An earthquake is not a thing that
happens to a village; it is a thing that happens to a fault, and what happens to the village is that
buildings collapse, people are hurt, and saturated hillslopes let go. Those are ``COLLAPSE``,
``CASUALTY`` and ``LANDSLIDE``, which the belief model already reasons about and dispatch already
maps to excavators and medical teams. So this module stops at ground motion and fragility, and hands
the result to the existing modes rather than inventing a sixth.

Every relation here is a published one, named at its definition, and every one of them is a
screening-level estimate: regional attenuation with no fault geometry, a slope proxy standing in for
measured shear-wave velocity, and two fragility curves standing in for a building survey. That is
enough to rank villages, which is what the engine is for. It is not enough to tell anyone whether a
particular house will stand, and nothing downstream should present it as though it were.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any


EARTH_RADIUS_KM = 6371.0
# Joyner & Boore (1981) fit horizontal peak acceleration against a near-source distance floor, which
# keeps the relation finite directly under the epicentre where a point source would divide by zero.
NEAR_SOURCE_KM = 7.3
# Vs30 that Joyner & Boore's mixed rock-and-soil dataset behaves as, used as the reference the site
# amplification below is measured against.
REFERENCE_VS30 = 620.0


@dataclass(frozen=True, slots=True)
class Epicentre:
    lon: float
    lat: float
    magnitude: float
    depth_km: float = 10.0

    def payload(self) -> dict[str, Any]:
        return {
            "lon": round(self.lon, 5), "lat": round(self.lat, 5),
            "magnitude": round(self.magnitude, 2), "depth_km": round(self.depth_km, 1),
        }


def surface_distance_km(lon_a: float, lat_a: float, lon_b: float, lat_b: float) -> float:
    """Great-circle distance. At district scale a flat approximation would do, but the atlas hands
    this function epicentres from anywhere on the map, so it is worth the two trig calls."""
    phi_a, phi_b = math.radians(lat_a), math.radians(lat_b)
    delta_phi = phi_b - phi_a
    delta_lambda = math.radians(lon_b - lon_a)
    haversine = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi_a) * math.cos(phi_b) * math.sin(delta_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(haversine)))


def peak_ground_acceleration(magnitude: float, surface_km: float, depth_km: float) -> float:
    """Horizontal PGA in g, from Joyner & Boore (1981), Bull. Seism. Soc. Am. 71(6).

        log10 PGA(g) = -1.02 + 0.249 M - log10 R - 0.00255 R,   R = sqrt(d^2 + h^2)

    ``d`` is epicentral distance. The published relation fixes ``h`` at a fitted 7.3 km, which is
    what keeps PGA finite directly beneath the epicentre; here the caller's focal depth is used
    instead whenever it is deeper than that, so a deep event attenuates as a deep event should while
    a shallow one still cannot blow up at zero distance.
    """
    distance = math.sqrt(surface_km**2 + max(depth_km, NEAR_SOURCE_KM) ** 2)
    log_pga = -1.02 + 0.249 * magnitude - math.log10(distance) - 0.00255 * distance
    return 10.0**log_pga


def slope_vs30(slope_deg: float) -> float:
    """Shear-wave velocity inferred from topographic gradient: Wald & Allen (2007), active tectonic.

    A measured Vs30 profile per village is not something a district package will ever carry, and
    slope is: steep ground is thin soil over rock and shakes less, valley floors are deep sediment
    and shake more. It is the same reason the flood model trusts height above drainage.
    """
    gradient = math.tan(math.radians(max(0.0, slope_deg)))
    for ceiling, velocity in (
        (3.0e-4, 180.0), (3.5e-3, 240.0), (0.010, 300.0), (0.018, 350.0),
        (0.050, 425.0), (0.100, 550.0), (0.138, 620.0), (0.300, 760.0),
    ):
        if gradient < ceiling:
            return velocity
    return 900.0


def site_factor(slope_deg: float) -> float:
    """Amplification of PGA relative to the reference site condition, Borcherdt-style power law."""
    return (REFERENCE_VS30 / slope_vs30(slope_deg)) ** 0.35


def modified_mercalli(pga_g: float) -> float:
    """Felt intensity from PGA: Wald et al. (1999), Earthquake Spectra 15(3).

    The regression is anchored on intensities V to VIII; below that it is clamped to II, because
    "not felt" and "barely felt" are not distinguishable from an acceleration alone.
    """
    if pga_g <= 0:
        return 1.0
    intensity = 3.66 * math.log10(pga_g * 980.665) - 1.66
    return round(min(10.0, max(2.0, intensity)), 1)


def _lognormal(pga_g: float, median: float, beta: float) -> float:
    """Probability that a fragility curve with this median and dispersion is exceeded."""
    if pga_g <= 0:
        return 0.0
    return 0.5 * (1 + math.erf(math.log(pga_g / median) / (beta * math.sqrt(2))))


# Median PGA at which a building of each class reaches complete structural damage, with the
# lognormal dispersion of that curve. Kutcha here is unreinforced rubble or mud-mortar masonry and
# pucca is confined masonry or low-rise reinforced concrete, matching how the Census Primary Census
# Abstract splits Kerala's housing stock. Medians follow the HAZUS-MH URM-L and C3L complete-damage
# curves, which are the values most Indian screening studies adopt in the absence of local ones.
FRAGILITY: dict[str, tuple[float, float]] = {
    "kutcha": (0.21, 0.64),
    "pucca": (0.52, 0.60),
}


def collapse_probability(pga_g: float, kutcha_fraction: float) -> float:
    """Share of a settlement's building stock reaching complete damage at this shaking level."""
    share = min(1.0, max(0.0, kutcha_fraction))
    weak = _lognormal(pga_g, *FRAGILITY["kutcha"])
    strong = _lognormal(pga_g, *FRAGILITY["pucca"])
    return share * weak + (1 - share) * strong


def casualty_rate(collapse_fraction: float, elderly_fraction: float) -> float:
    """Fraction of residents needing medical attention, given that share of buildings collapsed.

    Coburn & Spence's post-event work on masonry collapse puts serious injury and death among the
    occupants of a completely collapsed masonry building in the tens of percent. Ten percent is the
    low end of that range, chosen because this is a triage ranking and an inflated casualty estimate
    reorders the dispatch queue in favour of whichever village happens to have the most buildings.
    Age raises it: an elderly occupant is likelier to be trapped and likelier to be hurt if trapped.
    """
    return round(collapse_fraction * 0.10 * (1 + 0.9 * min(0.5, max(0.0, elderly_fraction))), 4)


def landslide_trigger_probability(pga_g: float, susceptibility: float) -> float:
    """Chance the shaking dislodges a slope that the terrain model already considers marginal.

    A Newmark displacement analysis needs a failure surface, a cohesion and a saturation state per
    slope, none of which a district package holds. What it does hold is the rainfall-and-slope
    landslide susceptibility the Forge derived, and shaking is treated here as a multiplier on that:
    ground that was already close to failing is what an earthquake takes down. Below 0.05 g nothing
    is triggered, which is roughly where the literature places the threshold for seismic slope
    failure in soil.
    """
    if pga_g < 0.05:
        return 0.0
    marginal = min(1.0, max(0.0, susceptibility))
    return round(min(0.98, marginal * (1 - math.exp(-6.0 * (pga_g - 0.05)))), 4)


def shake(epicentre: Epicentre, settlements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per settlement: distance, shaking, and the three consequences the engine models.

    Rows come back ordered by shaking, strongest first, because that is the order every consumer
    wants and computing it here means no caller has to remember to.
    """
    rows: list[dict[str, Any]] = []
    for settlement in settlements:
        longitude, latitude = settlement["location"]["coordinates"][:2]
        distance = surface_distance_km(epicentre.lon, epicentre.lat, longitude, latitude)
        bedrock = peak_ground_acceleration(epicentre.magnitude, distance, epicentre.depth_km)
        terrain = settlement.get("terrain") if isinstance(settlement.get("terrain"), dict) else {}
        # Site response wants the settlement's average gradient, which is what Wald & Allen
        # regressed against; the top-level ``slope_deg`` is a 90th percentile, kept below for the
        # landslide screen where the steepest ground is the ground that fails.
        slope = float(terrain.get("slope_deg", {}).get("mean") or settlement.get("slope_deg") or 0.0)
        amplification = site_factor(slope)
        pga = bedrock * amplification
        kutcha = float(settlement.get("pct_kutcha") or 0.0)
        collapse = collapse_probability(pga, kutcha)
        casualties = casualty_rate(collapse, float(settlement.get("elderly_frac") or 0.0))
        susceptibility = terrain.get("susceptibility", {}).get("landslide")
        population = int(settlement.get("population") or 0)
        rows.append({
            "settlement_id": settlement["id"],
            "name": settlement.get("name"),
            "distance_km": round(distance, 2),
            "pga_bedrock_g": round(bedrock, 4),
            "site_amplification": round(amplification, 3),
            "vs30_proxy_ms": round(slope_vs30(slope), 0),
            "pga_g": round(pga, 4),
            "mmi": modified_mercalli(pga),
            "collapse_probability": round(collapse, 4),
            "casualty_rate": casualties,
            "expected_casualties": round(population * casualties, 1),
            "landslide_probability": landslide_trigger_probability(pga, float(susceptibility or 0.0)),
            "population": population,
        })
    rows.sort(key=lambda row: (-row["pga_g"], row["settlement_id"]))
    return rows


def caveats(epicentre: Epicentre) -> list[str]:
    """Where this run sits outside the ground the published relations were fitted on."""
    notes = [
        "Screening estimate: point source, no fault geometry or rupture directivity.",
        "Site response from a topographic-slope Vs30 proxy, not measured shear-wave velocity.",
        "Fragility from two generic construction classes weighted by Census kutcha/pucca shares.",
    ]
    if not 5.0 <= epicentre.magnitude <= 7.7:
        notes.append(
            f"M {epicentre.magnitude:g} is outside the M 5.0-7.7 band Joyner & Boore (1981) was "
            "fitted on; the attenuation is extrapolated."
        )
    if epicentre.depth_km > 35:
        notes.append(
            f"{epicentre.depth_km:g} km is below the crustal depths the relation was fitted on."
        )
    return notes
