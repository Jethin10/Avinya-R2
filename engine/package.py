"""District package loader using portable JSON Forge artifacts."""

from __future__ import annotations

import json
import gzip
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from core.belief import FailureMode, logit
from core.cascade import CascadeEdge
from core.dispatch import Asset


@dataclass(slots=True)
class DistrictPackage:
    root: Path
    meta: dict[str, Any]
    settlements: list[dict[str, Any]]
    priors: dict[tuple[str, FailureMode], tuple[float, float]]
    neighbours: dict[str, dict[str, float]]
    cascade_edges: list[CascadeEdge]
    assets: list[Asset]
    events: list[dict[str, Any]]
    ground_truth: list[dict[str, Any]]
    routes: dict[str, Any]

    @classmethod
    def load(cls, root: Path) -> "DistrictPackage":
        required = ["meta.json", "settlements.json", "priors.json", "events.jsonl"]
        missing = [name for name in required if not (root / name).exists()]
        if missing:
            raise FileNotFoundError(f"District package incomplete: {', '.join(missing)}. Run `python -m scripts.forge.run_all`.")
        meta = json.loads((root / "meta.json").read_text(encoding="utf-8"))
        settlements = json.loads((root / "settlements.json").read_text(encoding="utf-8"))
        raw_priors = json.loads((root / "priors.json").read_text(encoding="utf-8"))
        priors = {
            (row["settlement_id"], FailureMode(row["failure_mode"])): (logit(row["probability"]), row.get("variance", 0.25))
            for row in raw_priors
        }
        neighbours = json.loads((root / "neighbours.json").read_text(encoding="utf-8")) if (root / "neighbours.json").exists() else {}
        cascade_raw = json.loads((root / "cascade.json").read_text(encoding="utf-8")) if (root / "cascade.json").exists() else []
        assets_raw = json.loads((root / "assets.json").read_text(encoding="utf-8")) if (root / "assets.json").exists() else []
        events = [json.loads(line) for line in (root / "events.jsonl").read_text(encoding="utf-8").splitlines() if line.strip()]
        ground_truth = json.loads((root / "ground_truth.json").read_text(encoding="utf-8")) if (root / "ground_truth.json").exists() else []
        routes_path = root / "routes.json.gz"
        routes: dict[str, Any] = {}
        if routes_path.exists():
            with gzip.open(routes_path, "rt", encoding="utf-8") as handle:
                routes = json.load(handle)
        return cls(
            root=root,
            meta=meta,
            settlements=settlements,
            priors=priors,
            neighbours=neighbours,
            cascade_edges=[CascadeEdge(**row) for row in cascade_raw],
            assets=[Asset(**row) for row in assets_raw],
            events=events,
            ground_truth=ground_truth,
            routes=routes,
        )

    def settlement(self, settlement_id: str) -> dict[str, Any] | None:
        return next((s for s in self.settlements if s["id"] == settlement_id), None)

    def route(self, settlement_id: str, asset_kind: str) -> dict[str, Any] | None:
        return self.routes.get("routes", {}).get(asset_kind, {}).get(settlement_id)
