from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path

from engine.schemas import RawEvent


LINE = re.compile(r"^(\d{1,2}/\d{1,2}/\d{2,4}),?\s+(\d{1,2}:\d{2})(?:\s*([AP]M))?\s+-\s+([^:]+):\s+(.*)$", re.I)


def read_whatsapp(path: Path, *, provenance: str = "live") -> list[RawEvent]:
    events = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        match = LINE.match(line)
        if not match: continue
        date, time, meridiem, sender, text = match.groups()
        stamp = datetime.strptime(f"{date} {time} {meridiem or ''}".strip(), "%d/%m/%Y %H:%M" if not meridiem else "%d/%m/%Y %I:%M %p")
        events.append(RawEvent(ts=stamp.astimezone(), kind="report", channel="whatsapp", source_id=sender.strip(), text=text, provenance=provenance, is_firsthand=not text.lower().startswith("forwarded")))
    return events
