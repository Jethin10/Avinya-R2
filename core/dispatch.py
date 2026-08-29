"""Expected-harm ranking and deterministic typed asset assignment."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping

from .belief import FailureMode


ASSET_FOR_MODE = {
    FailureMode.INUNDATION: "boat",
    FailureMode.COLLAPSE: "excavator",
    FailureMode.CASUALTY: "medical",
    FailureMode.LANDSLIDE: "excavator",
    FailureMode.WIND: "medical",
}


@dataclass(frozen=True, slots=True)
class DispatchCandidate:
    settlement_id: str
    name: str
    population: int
    elderly_fraction: float
    probabilities: Mapping[FailureMode, float]
    confidence: float
    road_minutes: float


@dataclass(frozen=True, slots=True)
class Asset:
    asset_id: str
    kind: str
    capacity: int
    status: str = "available"


def expected_harm(candidate: DispatchCandidate, hours_elapsed: float) -> tuple[float, FailureMode]:
    mode = max(candidate.probabilities, key=candidate.probabilities.get)
    probability = candidate.probabilities[mode]
    survival_decay = min(2.5, 1.0 + hours_elapsed / 24.0)
    vulnerability = 1.0 + candidate.elderly_fraction
    return candidate.population * probability * vulnerability * survival_decay, mode


def solve(
    candidates: Iterable[DispatchCandidate],
    assets: Iterable[Asset],
    *,
    hours_elapsed: float,
    passability: Mapping[str, float] | None = None,
) -> list[dict[str, object]]:
    available = [a for a in assets if a.status == "available"]
    by_kind: dict[str, list[Asset]] = {}
    for asset in available:
        by_kind.setdefault(asset.kind, []).append(asset)
    ranked = sorted(candidates, key=lambda c: expected_harm(c, hours_elapsed)[0], reverse=True)
    tasks: list[dict[str, object]] = []
    for candidate in ranked:
        harm, mode = expected_harm(candidate, hours_elapsed)
        kind = ASSET_FOR_MODE[mode]
        pool = by_kind.get(kind, [])
        if not pool:
            continue
        asset = pool.pop(0)
        p_access = (passability or {}).get(candidate.settlement_id, 1.0)
        access_mode = "road" if p_access >= 0.5 else ("water" if kind == "boat" else "blocked")
        tasks.append({
            "id": f"task-{len(tasks) + 1}",
            "settlement_id": candidate.settlement_id,
            "settlement_name": candidate.name,
            "asset_id": asset.asset_id,
            "asset_kind": kind,
            "failure_mode": mode.value,
            "seq": len(tasks) + 1,
            "eta_minutes": round(candidate.road_minutes / max(p_access, 0.1), 1),
            "expected_lives_saved": round(harm * candidate.confidence * 0.08, 2),
            "expected_harm": round(harm, 2),
            "access_mode": access_mode,
            "state": "proposed" if access_mode != "blocked" else "needs_route_review",
        })
    return tasks

