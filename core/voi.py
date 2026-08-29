"""Verification ranking by expected decision change and observability equity bonus."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True, slots=True)
class VerificationCandidate:
    settlement_id: str
    probability: float
    variance: float
    expected_harm: float
    observability: float
    current_rank: int
    action: str = "Call local PHC"
    minutes: int = 4


def score(candidate: VerificationCandidate) -> float:
    boundary = 1.0 - abs(candidate.probability - 0.5) * 2.0
    equity_bonus = 1.0 + 0.35 * (1.0 - min(1.0, max(0.0, candidate.observability)))
    rank_weight = 1.0 / (1.0 + 0.12 * max(0, candidate.current_rank - 1))
    return max(0.0, candidate.variance * candidate.expected_harm * boundary * equity_bonus * rank_weight / max(1, candidate.minutes))


def rank(candidates: Iterable[VerificationCandidate], capacity: int = 5) -> list[dict[str, object]]:
    ordered = sorted(candidates, key=score, reverse=True)[:capacity]
    return [
        {
            "id": f"verify-{c.settlement_id}",
            "settlement_id": c.settlement_id,
            "action": c.action,
            "minutes": c.minutes,
            "voi_score": round(score(c), 6),
            "resolves": "dispatch priority and asset type",
            "state": "open",
        }
        for c in ordered
    ]

