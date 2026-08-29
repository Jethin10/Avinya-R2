from __future__ import annotations

from pathlib import Path
from xml.etree import ElementTree as ET

from engine.schemas import RawEvent


def read_cap(path: Path, *, provenance: str = "live") -> list[RawEvent]:
    root = ET.fromstring(path.read_bytes())
    namespace = root.tag.split("}")[0].removeprefix("{") if "}" in root.tag else ""
    q = lambda name: f"{{{namespace}}}{name}" if namespace else name
    sender = root.findtext(q("sender"), "cap-feed")
    sent = root.findtext(q("sent"))
    events = []
    for info in root.findall(q("info")):
        area = info.find(q("area")); description = info.findtext(q("description"), info.findtext(q("headline"), ""))
        area_name = area.findtext(q("areaDesc"), "") if area is not None else ""
        events.append(RawEvent(ts=sent, kind="report", channel="cap", source_id=sender, text=f"{area_name}: {description}", hazard=info.findtext(q("event"), "unknown").lower(), severity_hint=info.findtext(q("severity"), "unknown").lower(), provenance=provenance))
    return events
