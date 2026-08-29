"""Auditable seed likelihood-ratio tables from MASTER_PLAN.md."""

from __future__ import annotations

import math

from .belief import FailureMode

HUMAN_STRENGTH = {
    "catastrophic": 6.0,
    "severe": 3.0,
    "moderate": 1.5,
    "minor": 0.7,
    "none": 0.4,
    "unknown": 1.0,
}


def human_lr(hint: str, reliability: float, independent_sources: int, is_firsthand: bool) -> float:
    strength = HUMAN_STRENGTH.get(hint, 1.0)
    weight = min(1.0, max(0.0, reliability)) * (1.0 if is_firsthand else 0.6)
    weight *= min(1.0 + 0.35 * math.log(max(independent_sources, 1)), 2.0)
    return max(0.01, 1.0 + (strength - 1.0) * weight)


def telecom_lrs(ratio: float, *, minutes_to_drop: int | None = None, sustained_hours: float = 0) -> dict[FailureMode, float]:
    hard_zero = ratio < 0.05 and (minutes_to_drop is None or minutes_to_drop <= 15) and sustained_hours >= 2
    gradual = ratio < 0.3 and minutes_to_drop is not None and 240 <= minutes_to_drop <= 480
    if hard_zero:
        return {FailureMode.COLLAPSE: 5.30, FailureMode.INUNDATION: 1.80}
    if gradual:
        return {FailureMode.COLLAPSE: 1.20, FailureMode.INUNDATION: 3.10}
    if ratio <= 0.7:
        return {FailureMode.COLLAPSE: 1.40, FailureMode.INUNDATION: 1.60}
    return {FailureMode.COLLAPSE: 0.13, FailureMode.INUNDATION: 0.35}


def sar_lrs(*, coherence_loss: float, backscatter_drop_db: float, usable: bool = True) -> dict[FailureMode, float]:
    if not usable:
        return {FailureMode.COLLAPSE: 1.0, FailureMode.INUNDATION: 1.0}
    if coherence_loss > 0.5:
        return {FailureMode.COLLAPSE: 3.50, FailureMode.INUNDATION: 1.0}
    if backscatter_drop_db > 3:
        return {FailureMode.COLLAPSE: 0.40, FailureMode.INUNDATION: 4.20}
    return {FailureMode.COLLAPSE: 0.55, FailureMode.INUNDATION: 0.30}


def power_lrs(condition: str) -> dict[FailureMode, float]:
    table = {
        "dead": (2.80, 1.60),
        "tripped": (1.10, 1.90),
        "normal": (0.45, 0.60),
    }
    collapse, inundation = table.get(condition, (1.0, 1.0))
    return {FailureMode.COLLAPSE: collapse, FailureMode.INUNDATION: inundation}


def verification_lr(result: str) -> float:
    return {"confirmed_severe": 12.0, "confirmed_intact": 0.08, "inconclusive": 1.0}.get(result, 1.0)

