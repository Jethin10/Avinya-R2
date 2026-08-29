"""Dependency-free, single-page PDF dispatch sheet."""

from __future__ import annotations


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def render_dispatch(plan: list[dict], sim_t: str, disclosure: str) -> bytes:
    lines = ["SETU DISPATCH SHEET - EXERCISE", f"Simulation time: {sim_t}", disclosure, ""]
    for task in plan[:18]:
        lines.append(f"{task['seq']:02d}  {task['asset_id']} -> {task['settlement_name']}  {task['failure_mode']}  ETA {task['eta_minutes']} min")
    stream_lines = ["BT", "/F1 11 Tf", "50 790 Td"]
    for index, line in enumerate(lines):
        if index: stream_lines.append("0 -18 Td")
        stream_lines.append(f"({_escape(str(line))}) Tj")
    stream_lines.append("ET")
    stream = "\n".join(stream_lines).encode("latin-1", errors="replace")
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream", b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"]
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1): offsets.append(len(output)); output.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(output); output.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]: output.extend(f"{offset:010d} 00000 n \n".encode())
    output.extend(f"trailer << /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(output)

