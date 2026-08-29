from __future__ import annotations

import json
from pathlib import Path

from engine.schemas import RawEvent


def read_jsonl(path: Path) -> list[RawEvent]:
    return [RawEvent.model_validate(json.loads(line)) for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
