from __future__ import annotations

from datetime import datetime
from xml.etree.ElementTree import Element, SubElement, tostring


def render_alerts(plan: list[dict], sim_t: str) -> bytes:
    alert = Element("alert", {"xmlns": "urn:oasis:names:tc:emergency:cap:1.2"})
    SubElement(alert, "identifier").text = f"setu-dispatch-{sim_t}"
    SubElement(alert, "sender").text = "setu@ddma.local"
    SubElement(alert, "sent").text = sim_t
    SubElement(alert, "status").text = "Exercise"
    SubElement(alert, "msgType").text = "Alert"
    SubElement(alert, "scope").text = "Restricted"
    for task in plan:
        info = SubElement(alert, "info")
        SubElement(info, "language").text = "en-IN"
        SubElement(info, "category").text = "Rescue"
        SubElement(info, "event").text = f"Proposed {task['asset_kind']} dispatch"
        SubElement(info, "urgency").text = "Immediate"
        SubElement(info, "severity").text = "Severe"
        SubElement(info, "certainty").text = "Likely"
        SubElement(info, "headline").text = f"SETU dispatch to {task['settlement_name']}"
        SubElement(info, "description").text = f"Exercise data. {task['failure_mode']} response; ETA {task['eta_minutes']} minutes."
    return tostring(alert, encoding="utf-8", xml_declaration=True)
