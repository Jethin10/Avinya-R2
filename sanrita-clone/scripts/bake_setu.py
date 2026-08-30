"""Bake the Engine's answers into the site so the demo survives having no Engine.

The Twin layer inside this clone reads a running SETU Engine at ``/api`` when there is one. There
often is not - a laptop on a stage, a static host, a judge opening the link on their phone - and a
disaster-response demo that shows an error page in that situation has failed at the only moment that
counts. So every response the layer needs is written into ``public/setu/`` at build time, and the
frontend falls back to these files, saying on screen which of the two it is showing.

What is baked is exactly what the Engine would have said at that moment, copied rather than
recomputed: the atlas, the authored stand-in severity, and for each district package its metadata,
settlements, terrain heightmap, building footprints and a small number of belief/plan snapshots
along the replay. Nothing here is a second implementation of the model - if these numbers and the
Engine's ever disagree, this file is stale, and that is a rebuild away from being fixed.
"""

from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
import shutil
import sys
from datetime import timedelta
from pathlib import Path


CLONE = Path(__file__).resolve().parent.parent
ROOT = CLONE.parent
sys.path.insert(0, str(ROOT))

from engine.db import Database  # noqa: E402
from engine.package import DistrictPackage  # noqa: E402
from engine.runtime import Runtime  # noqa: E402

PACKAGES = ROOT / "district_package"
OUTPUT = CLONE / "public" / "setu"
# How many belief/plan snapshots to take across a scenario's replay window. The live Engine advances
# a second at a time; the fallback can only ever step, so it steps through the shape of the event.
SNAPSHOTS = 9

# Layers that are properties of the district rather than of the event: three Wayanad scenarios ship
# byte-identical building footprints and terrain, and shipping them three times would triple the
# download for nothing. They are written once under ``_layers`` and pointed at from each scenario.
SHARED_LAYERS = frozenset({"buildings", "heightmap"})
# Village boundaries already travel inside ``settlements.json``, so the GeoJSON copy of them is a
# second megabyte of the same polygons.
SKIP_LAYERS = frozenset({"settlements"})

DISCLOSURE = (
    "Baked Engine output. These files were written by the SETU Engine during a build and are served "
    "when no Engine is reachable. They are a recording, not a live model, and the interface says so "
    "while they are in use."
)


def _shared_digest(source: Path) -> str:
    """Identity of a district-wide layer, ignoring which scenario happened to write it.

    The three Wayanad packages produce byte-different building and heightmap files that differ in
    exactly one field - the scenario id stamped into the header - while the geometry is identical.
    Hashing the payload with that field removed is what lets one copy serve all three.
    """
    payload = json.loads(gzip.decompress(source.read_bytes()).decode("utf-8"))
    payload.pop("scenario_id", None)
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.blake2b(canonical, digest_size=8).hexdigest()


def _audit(decisions: list[dict], routes: dict[str, object]) -> list[dict]:
    """The decision log as the audit panel needs it: the hash chain, not the payload twice over.

    Every row carries the plan it committed to both as parsed JSON and as the exact string that was
    hashed, and each plan carries the full road geometry of every task. Ten rows of that is two
    megabytes. The string is dropped - it is reproducible from the payload - and the geometry is
    hoisted into the same shared route table the snapshots use.
    """
    rows = []
    for decision in decisions:
        row = {key: value for key, value in decision.items() if key != "payload_json"}
        payload = row.get("payload")
        if isinstance(payload, dict):
            row["payload"] = _thin(payload, routes)
        rows.append(row)
    return rows


def _write_json(path: Path, payload: object) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    path.write_bytes(data)
    return len(data)


def _scenarios() -> list[Path]:
    return [directory for directory in sorted(PACKAGES.iterdir())
            if (directory / "meta.json").exists()]


def _thin(state: dict, routes: dict[str, object]) -> dict:
    """Lift route geometry out of a plan snapshot into a shared table.

    A dispatch task carries the full road polyline it would drive, and the same road comes back in
    every snapshot the task survives into. Stored per snapshot that is megabytes of duplicated
    coordinates; stored once and referenced by id it is the same information.
    """
    thinned = dict(state)
    plan = []
    for task in state.get("plan", []):
        task = dict(task)
        route = task.pop("route", None)
        if isinstance(route, dict) and route.get("route_id"):
            routes.setdefault(route["route_id"], route)
            task["route_id"] = route["route_id"]
        plan.append(task)
    thinned["plan"] = plan
    return thinned


async def _snapshots(package: DistrictPackage, database: Path) -> dict[str, object]:
    """Belief, plan and verification state at evenly spaced points along the replay."""
    runtime = Runtime(package, Database(database), 15)
    await runtime.initialise()
    try:
        start, end = runtime.clock.start, runtime.clock.end
        span = (end - start).total_seconds()
        frames = []
        routes: dict[str, object] = {}
        for index in range(SNAPSHOTS):
            moment = start + timedelta(seconds=span * index / (SNAPSHOTS - 1))
            state = await runtime.seek(moment)
            frames.append({"t": moment.isoformat(), "state": _thin(state, routes)})
        return {
            "frames": frames,
            "routes": routes,
            "metrics": runtime.metrics(),
            "coverage": runtime.db.coverage(),
            "decisions": _audit(runtime.db.decisions(), routes),
            "verify": frames[-1]["state"].get("verify", []),
        }
    finally:
        runtime.db.close()


def bake() -> dict[str, object]:
    if OUTPUT.exists():
        shutil.rmtree(OUTPUT)
    OUTPUT.mkdir(parents=True)
    report: dict[str, object] = {"scenarios": {}, "bytes": {}}

    atlas = PACKAGES / "_atlas" / "atlas.json"
    if not atlas.exists():
        raise FileNotFoundError("Run `python -m scripts.forge.build_atlas` from the repository root")
    report["bytes"]["atlas.json"] = _write_json(
        OUTPUT / "atlas.json", json.loads(atlas.read_text(encoding="utf-8")))
    stand_ins = PACKAGES / "_atlas" / "stand_ins.json"
    if stand_ins.exists():
        report["bytes"]["stand_ins.json"] = _write_json(
            OUTPUT / "stand_ins.json", json.loads(stand_ins.read_text(encoding="utf-8")))

    index = []
    scratch = ROOT / "data" / "derived" / "bake.db"
    for directory in _scenarios():
        meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
        package = DistrictPackage.load(directory)
        target = OUTPUT / meta["id"]
        scratch.unlink(missing_ok=True)
        baked = asyncio.run(_snapshots(package, scratch))
        scratch.unlink(missing_ok=True)

        written = {
            "district.json": _write_json(target / "district.json", meta),
            "settlements.json": _write_json(target / "settlements.json", package.settlements),
            "replay.json": _write_json(target / "replay.json", baked),
        }
        for name in ("twin_manifest.json", "assets.json", "neighbours.json", "cascade.json"):
            source = directory / name
            if source.exists():
                written[name] = _write_json(
                    target / name, json.loads(source.read_text(encoding="utf-8")))
        layers = directory / "layers" / "index.json"
        entries: list[dict[str, str]] = []
        if layers.exists():
            for layer in json.loads(layers.read_text(encoding="utf-8"))["layers"]:
                source = directory / layer["path"]
                if layer["id"] in SKIP_LAYERS or not source.exists():
                    continue
                entry = dict(layer)
                if layer["id"] in SHARED_LAYERS:
                    digest = _shared_digest(source)
                    name = f"{layer['id']}-{digest}{''.join(source.suffixes)}"
                    destination = OUTPUT / "_layers" / name
                    entry["path"] = f"../_layers/{name}"
                else:
                    destination = target / layer["path"]
                destination.parent.mkdir(parents=True, exist_ok=True)
                if not destination.exists():
                    # Gzipped layers are copied compressed and inflated in the browser: a static
                    # host will not set Content-Encoding for us, and the decompressed heightmap and
                    # building sets are large enough that shipping them raw would dominate the page.
                    shutil.copyfile(source, destination)
                    written[entry["path"]] = destination.stat().st_size
                entries.append(entry)
            written["layers/index.json"] = _write_json(
                target / "layers" / "index.json", {"layers": entries})

        index.append({
            "id": meta["id"], "name": meta.get("name", meta["id"]),
            "historical": bool(meta.get("historical", False)),
            "replay": meta.get("replay"), "provenance": meta.get("provenance"),
            "layers": {layer["id"]: layer["path"] for layer in entries},
        })
        report["scenarios"][meta["id"]] = written

    report["bytes"]["scenarios.json"] = _write_json(OUTPUT / "scenarios.json", index)
    report["bytes"]["manifest.json"] = _write_json(OUTPUT / "manifest.json", {
        "schema_version": 1,
        "provenance": {"source": "setu-engine", "mode": "baked", "disclosure": DISCLOSURE},
        "snapshots_per_scenario": SNAPSHOTS,
        "scenarios": [row["id"] for row in index],
    })
    report["total_bytes"] = sum(
        path.stat().st_size for path in OUTPUT.rglob("*") if path.is_file())
    return report


def main() -> None:
    report = bake()
    print(json.dumps({
        "ok": True, "output": str(OUTPUT), "total_bytes": report["total_bytes"],
        "scenarios": {key: len(value) for key, value in report["scenarios"].items()},
        "top_level": report["bytes"],
    }, indent=1))


if __name__ == "__main__":
    main()
