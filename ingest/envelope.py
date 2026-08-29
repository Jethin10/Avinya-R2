from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from engine.schemas import RawEvent


@dataclass(slots=True)
class Observation:
    obs_id: str
    ts: datetime
    received_at: datetime
    kind: str
    channel: str
    source_id: str
    provenance: str
    settlement_id: str | None = None
    text_orig: str | None = None
    text_en: str | None = None
    lang: str = "en"
    hazard: str = "unknown"
    severity_hint: str = "unknown"
    subjects: list[str] = field(default_factory=list)
    is_firsthand: bool = False
    geo_confidence: float = 0.0
    geo_surface: str | None = None
    geo_method: str | None = None
    chain: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)


def wrap(raw: RawEvent) -> Observation:
    received = raw.received_at or datetime.now().astimezone()
    payload = raw.model_dump(mode="json", exclude_none=True)
    obs_id = raw.obs_id or "obs_" + hashlib.blake2b(
        repr(sorted(payload.items())).encode("utf-8"), digest_size=8
    ).hexdigest()
    known = set(RawEvent.model_fields)
    extra = {key: value for key, value in payload.items() if key not in known}
    for key in ("observed", "expected", "condition", "coherence_loss", "backscatter_drop_db", "usable", "result", "params"):
        value = getattr(raw, key, None)
        if value is not None:
            extra[key] = value
    return Observation(
        obs_id=obs_id,
        ts=raw.ts or received,
        received_at=received,
        kind=raw.kind,
        channel=raw.channel,
        source_id=raw.source_id,
        provenance=raw.provenance,
        settlement_id=raw.settlement_id,
        text_orig=raw.text_orig or raw.text,
        text_en=raw.text,
        lang=raw.lang,
        hazard=raw.hazard,
        severity_hint=raw.severity_hint,
        is_firsthand=raw.is_firsthand,
        extra=extra,
        chain=[f"connect:{raw.channel}"],
    )

