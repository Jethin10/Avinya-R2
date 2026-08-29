from __future__ import annotations

import argparse
import json
from pathlib import Path


def _ingest(path: Path, format_name: str) -> None:
    from ingest.connectors import read_cap, read_jsonl, read_machine_csv, read_odk, read_whatsapp
    readers = {"jsonl": read_jsonl, "csv": read_machine_csv, "odk": read_odk, "cap": read_cap, "whatsapp": read_whatsapp}
    events = readers[format_name](path)
    print(json.dumps([event.model_dump(mode="json", exclude_none=True) for event in events], ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(prog="setu")
    sub = parser.add_subparsers(dest="command")
    serve = sub.add_parser("serve"); serve.add_argument("--host", default="127.0.0.1"); serve.add_argument("--port", type=int, default=8000); serve.add_argument("--reload", action="store_true")
    ingest = sub.add_parser("ingest", help="normalize a source file into RawEvent JSON")
    ingest.add_argument("path", type=Path); ingest.add_argument("--format", choices=("jsonl", "csv", "odk", "cap", "whatsapp"), required=True)
    args = parser.parse_args()
    if args.command in {None, "serve"}:
        import uvicorn
        uvicorn.run("engine.app:get_app", factory=True, host=getattr(args, "host", "127.0.0.1"), port=getattr(args, "port", 8000), reload=getattr(args, "reload", False))
    elif args.command == "ingest":
        _ingest(args.path, args.format)


if __name__ == "__main__": main()
