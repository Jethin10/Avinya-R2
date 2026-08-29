"""Heartbeat-baseline deviation with a dispatch corroboration guard."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class SilenceAssessment:
    corrected_ratio: float
    informative: bool
    dispatch_allowed: bool


def assess_silence(
    observed: float,
    expected: float,
    *,
    regional_outage_fraction: float = 0.0,
    known_backhaul_failure: bool = False,
    corroborating_channels: int = 0,
) -> SilenceAssessment:
    if expected <= 0:
        return SilenceAssessment(1.0, False, False)
    nuisance = min(0.95, max(0.0, regional_outage_fraction))
    adjusted_expected = expected * (1.0 - nuisance)
    ratio = min(2.0, max(0.0, observed / adjusted_expected)) if adjusted_expected else 1.0
    informative = not known_backhaul_failure and adjusted_expected >= 1.0
    return SilenceAssessment(ratio, informative, informative and corroborating_channels >= 1)

