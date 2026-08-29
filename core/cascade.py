"""Time-lagged downstream risk propagation."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True, slots=True)
class CascadeEdge:
    source: str
    destination: str
    lag_minutes: int
    transfer_weight: float


def propagate(
    probabilities: Mapping[str, float],
    edges: list[CascadeEdge],
    horizon_minutes: int = 360,
) -> dict[str, dict[str, float]]:
    output: dict[str, dict[str, float]] = {}
    for edge in edges:
        if edge.lag_minutes > horizon_minutes:
            continue
        risk = probabilities.get(edge.source, 0.0) * min(1.0, max(0.0, edge.transfer_weight))
        current = output.get(edge.destination)
        if current is None or risk > current["probability"]:
            output[edge.destination] = {
                "probability": risk,
                "eta_minutes": float(edge.lag_minutes),
                "source": edge.source,
            }
    return output

