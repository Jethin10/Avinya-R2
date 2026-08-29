from __future__ import annotations

import csv
from pathlib import Path

from engine.schemas import RawEvent


def read_machine_csv(path: Path, *, provenance: str = "live") -> list[RawEvent]:
    events = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            params = {key[7:]: _number(value) for key, value in row.items() if key.startswith("param_") and value not in (None, "")}
            payload = {key: _number(value) for key, value in row.items() if value not in (None, "") and not key.startswith("param_")}
            payload["params"] = params; payload.setdefault("provenance", provenance)
            events.append(RawEvent.model_validate(payload))
    return events


def _number(value: str):
    try: return float(value)
    except (TypeError, ValueError): return value
