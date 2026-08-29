"""Fetch and checksum the immutable public inputs used by the historical Forge."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import urllib.request
import urllib.parse
import zipfile
from pathlib import Path

from engine.config import ROOT


MANIFEST = ROOT / "data" / "source_manifest.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_extract(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    target = destination.resolve()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            resolved = (destination / member.filename).resolve()
            if resolved != target and target not in resolved.parents:
                raise ValueError(f"Unsafe archive member: {member.filename}")
        bundle.extractall(destination)


def fetch(manifest_path: Path = MANIFEST, *, download: bool = True) -> list[dict[str, str]]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    results: list[dict[str, str]] = []
    for source in manifest["sources"]:
        destination = ROOT / source["path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            if not download:
                raise FileNotFoundError(f"Missing {destination}; rerun without --verify-only")
            temporary = destination.with_suffix(destination.suffix + ".part")
            body = None
            if source.get("method") == "POST_FORM_FILE":
                query = (ROOT / source["query_path"]).read_text(encoding="utf-8")
                body = urllib.parse.urlencode({"data": query}).encode("utf-8")
            request = urllib.request.Request(source["url"], data=body, headers={"User-Agent": "SETU-Forge/1.0"})
            with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
                shutil.copyfileobj(response, output)
            temporary.replace(destination)
        actual = sha256(destination)
        expected = source["sha256"].replace(" ", "").lower()
        if actual != expected:
            raise ValueError(f"Checksum mismatch for {source['id']}: expected {expected}, got {actual}")
        if source.get("extract_to"):
            _safe_extract(destination, ROOT / source["extract_to"])
        results.append({"id": source["id"], "path": str(destination), "sha256": actual})
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    print(json.dumps({"ok": True, "sources": fetch(download=not args.verify_only)}, indent=2))


if __name__ == "__main__":
    main()
