"""Bayesian log-odds fusion with correlation damping and one-pass smoothing."""

from __future__ import annotations

import math
from dataclasses import dataclass
from enum import StrEnum
from typing import Iterable, Mapping


class FailureMode(StrEnum):
    INUNDATION = "INUNDATION"
    COLLAPSE = "COLLAPSE"
    CASUALTY = "CASUALTY"
    LANDSLIDE = "LANDSLIDE"
    WIND = "WIND"


DAMPING: dict[str, float] = {
    "human_report": 0.40,
    "telemetry": 0.65,
    "remote_sensing": 0.70,
    "verification": 1.00,
    "cascade": 0.55,
}


@dataclass(frozen=True, slots=True)
class EvidenceTerm:
    settlement_id: str
    failure_mode: FailureMode
    log_lr: float
    correlation_group: str
    channel: str = "unknown"
    raw_ref: str | None = None


@dataclass(frozen=True, slots=True)
class BeliefState:
    settlement_id: str
    failure_mode: FailureMode
    log_odds: float
    variance: float

    @property
    def probability(self) -> float:
        return sigmoid(self.log_odds)


def clamp_probability(value: float, epsilon: float = 1e-6) -> float:
    return min(1.0 - epsilon, max(epsilon, value))


def logit(probability: float) -> float:
    p = clamp_probability(probability)
    return math.log(p / (1.0 - p))


def sigmoid(log_odds: float) -> float:
    if log_odds >= 0:
        z = math.exp(-log_odds)
        return 1.0 / (1.0 + z)
    z = math.exp(log_odds)
    return z / (1.0 + z)


def fuse(
    priors: Mapping[tuple[str, FailureMode], tuple[float, float]],
    evidence: Iterable[EvidenceTerm],
    damping: Mapping[str, float] = DAMPING,
) -> dict[tuple[str, FailureMode], BeliefState]:
    """Fuse all evidence from the prior, damping sums within correlation groups."""
    grouped: dict[tuple[str, FailureMode, str], list[float]] = {}
    for term in evidence:
        key = (term.settlement_id, term.failure_mode, term.correlation_group)
        grouped.setdefault(key, []).append(term.log_lr)

    result: dict[tuple[str, FailureMode], BeliefState] = {}
    for key, (prior_log_odds, prior_variance) in priors.items():
        settlement_id, mode = key
        update = 0.0
        disagreement = 0.0
        for (sid, evidence_mode, group), values in grouped.items():
            if sid != settlement_id or evidence_mode != mode:
                continue
            weight = damping.get(group, 1.0)
            update += weight * sum(values)
            if min(values) < 0 < max(values):
                disagreement += min(1.0, abs(max(values) - min(values)) / 4.0)
        log_odds = prior_log_odds + update
        information = sum(
            abs(v) for (sid, evidence_mode, _), values in grouped.items()
            if sid == settlement_id and evidence_mode == mode for v in values
        )
        variance = max(0.02, prior_variance / (1.0 + information)) + disagreement * 0.25
        result[key] = BeliefState(settlement_id, mode, log_odds, variance)
    return result


def smooth_once(
    states: Mapping[tuple[str, FailureMode], BeliefState],
    neighbours: Mapping[str, Mapping[str, float]],
    alpha: float = 0.15,
) -> dict[tuple[str, FailureMode], BeliefState]:
    """Apply exactly one row-normalised spatial smoothing pass."""
    output: dict[tuple[str, FailureMode], BeliefState] = {}
    for key, state in states.items():
        weights = neighbours.get(state.settlement_id, {})
        available = [
            (weight, states.get((neighbour_id, state.failure_mode)))
            for neighbour_id, weight in weights.items()
        ]
        available = [(w, s) for w, s in available if s is not None and w > 0]
        if not available:
            output[key] = state
            continue
        total_weight = sum(w for w, _ in available)
        neighbour_mean = sum(w * s.log_odds for w, s in available) / total_weight
        output[key] = BeliefState(
            state.settlement_id,
            state.failure_mode,
            (1.0 - alpha) * state.log_odds + alpha * neighbour_mean,
            state.variance,
        )
    return output

