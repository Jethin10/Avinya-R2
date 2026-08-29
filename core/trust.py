"""Beta reliability posteriors."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TrustState:
    alpha: float = 1.0
    beta: float = 1.0

    @property
    def reliability(self) -> float:
        return self.alpha / (self.alpha + self.beta)

    def update(self, confirmed: bool, weight: float = 1.0) -> "TrustState":
        return TrustState(
            self.alpha + (weight if confirmed else 0.0),
            self.beta + (0.0 if confirmed else weight),
        )

