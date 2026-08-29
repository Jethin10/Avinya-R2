from __future__ import annotations

import json
from pathlib import Path

from engine.schemas import RawEvent


def read_odk(path: Path, *, mapping: dict[str, str] | None = None) -> list[RawEvent]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    rows = payload.get("value", payload) if isinstance(payload, dict) else payload
    fields = {"text": "report", "settlement_id": "settlement_id", "source_id": "_id", "ts": "submissionDate", **(mapping or {})}
    events = []
    for row in rows:
        values = {target: row.get(source) for target, source in fields.items() if row.get(source) is not None}
        events.append(RawEvent(kind="report", channel="odk", provenance="live", **values))
    return events
