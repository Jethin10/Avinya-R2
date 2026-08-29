from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


Provenance = Literal["archived", "synthetic", "live"]


class RawEvent(BaseModel):
    model_config = ConfigDict(extra="allow")

    obs_id: str | None = None
    t: datetime | None = None
    ts: datetime | None = None
    received_at: datetime | None = None
    kind: Literal["report", "telemetry", "sar", "power", "verification", "cascade"] = "report"
    channel: str = "api"
    source_id: str = "anonymous"
    provenance: Provenance
    settlement_id: str | None = None
    text: str | None = None
    text_orig: str | None = None
    lang: str = "en"
    hazard: str = "unknown"
    severity_hint: str = "unknown"
    is_firsthand: bool = False
    observed: float | None = None
    expected: float | None = None
    condition: str | None = None
    coherence_loss: float | None = None
    backscatter_drop_db: float | None = None
    usable: bool = True
    result: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def ensure_time(self) -> "RawEvent":
        if self.ts is None:
            self.ts = self.t or datetime.now().astimezone()
        return self


class ClockCommand(BaseModel):
    action: Literal["play", "pause", "seek", "speed", "reset"]
    t: datetime | None = None
    speed: float | None = Field(default=None, ge=0.1, le=600)


class InjectionRequest(BaseModel):
    attack: Literal["false_reports", "kill_sar", "cut_edge", "silence"]
    params: dict[str, Any] = Field(default_factory=dict)


class OverrideRequest(BaseModel):
    decision_id: int
    actor: str = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=3, max_length=1000)
    outcome: str = "acknowledged"


class VerificationResult(BaseModel):
    result: Literal["confirmed_severe", "confirmed_intact", "inconclusive"]
    actor: str = "verification-team"


class DisambiguationResolution(BaseModel):
    settlement_id: str
    actor: str = Field(min_length=1, max_length=100)


class ScenarioSelection(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,80}$")
