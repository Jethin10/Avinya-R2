from __future__ import annotations

import math
from typing import Any

from core.belief import EvidenceTerm, FailureMode
from core.dedupe import ClaimLike, cluster_weight, collapse
from core.likelihoods import human_lr, power_lrs, sar_lrs, telecom_lrs, verification_lr
from engine.db import Database
from engine.package import DistrictPackage
from engine.schemas import RawEvent

from .envelope import Observation, wrap
from .extract import extract
from .gazetteer import Gazetteer
from .normalise import text as normalise_text


HAZARD_MODE = {
    "flood": FailureMode.INUNDATION,
    "landslide": FailureMode.LANDSLIDE,
    "quake": FailureMode.COLLAPSE,
    "cyclone": FailureMode.WIND,
    "fire": FailureMode.CASUALTY,
}


class Pipeline:
    def __init__(self, package: DistrictPackage, db: Database):
        self.package = package
        self.db = db
        self.gazetteer = Gazetteer(package.settlements)

    def process(self, raw: RawEvent) -> list[dict[str, Any]]:
        obs = wrap(raw)
        if not self.db.save_raw_event(obs.obs_id, raw.model_dump(mode="json"), obs.received_at.isoformat()):
            return []
        # District aggregates remain auditable inputs but must not be projected onto an
        # arbitrary village. They inform visualization metadata, not settlement evidence.
        if raw.params.get("scope") == "district":
            return []
        if obs.kind in {"telemetry", "sar", "power", "verification", "cascade"} or obs.channel in {"telecom", "sar", "power", "verification", "cascade"}:
            return self._machine(obs)
        return self._human(obs)

    def _human(self, obs: Observation) -> list[dict[str, Any]]:
        obs.text_orig = normalise_text(obs.text_orig)
        obs.text_en = normalise_text(obs.text_en or obs.text_orig)
        obs.chain.append("normalise:stdlib")
        values = extract(obs.text_en, obs.hazard, obs.severity_hint)
        obs.hazard = str(values["hazard"]); obs.severity_hint = str(values["severity_hint"])
        obs.subjects = list(values["subjects"])
        obs.is_firsthand = obs.is_firsthand or bool(values["is_firsthand"])
        obs.chain.append("extract:offline_rules")
        match = self.gazetteer.locate(obs.text_en, obs.settlement_id)
        obs.settlement_id = match.settlement_id; obs.geo_confidence = match.confidence
        obs.geo_surface = match.surface; obs.geo_method = match.method; obs.chain.append(f"geo:{match.method}")
        if match.confidence < 0.5 or not match.settlement_id:
            self.db.queue_disambiguation(obs.obs_id, self._observation_payload(obs))
            return []
        self.db.save_source(obs.source_id, obs.channel)
        rows_by_id = {c["id"]: c for c in self.db.claims() if c["settlement_id"] == obs.settlement_id}
        previous = [
            ClaimLike(c["id"], c["claim_text"] or "", c["source_id"] or "", c["channel"] or "unknown", bool(c["is_firsthand"]), c["severity_hint"] or "unknown", c["ts"] or "")
            for c in rows_by_id.values()
        ]
        current = ClaimLike(obs.obs_id, obs.text_en or "", obs.source_id, obs.channel, obs.is_firsthand, obs.severity_hint, obs.ts.isoformat())
        clusters = collapse([*previous, current])
        cluster = next(group for group in clusters if any(c.claim_id == obs.obs_id for c in group))
        root = cluster[0]
        hint, independent, firsthand = cluster_weight(cluster)
        self.db.save_claim(self._claim_payload(obs, root.claim_id, len(cluster), independent))
        # One cluster is one claim, and it contributes exactly one evidence row. A corroborating
        # message does not add a second term — it re-states the root's weight with a higher
        # independent-source count. This is what stops message volume from being mistaken for
        # evidence while still letting genuine corroboration move the belief.
        root_source = root.source_id if root.claim_id != obs.obs_id else obs.source_id
        source = self.db.source(root_source) or {"alpha": 1.0, "beta": 1.0}
        reliability = source["alpha"] / (source["alpha"] + source["beta"])
        lr = human_lr(hint, reliability, independent, firsthand)
        root_hazard = obs.hazard if root.claim_id == obs.obs_id else (rows_by_id[root.claim_id]["hazard"] or obs.hazard)
        mode = HAZARD_MODE.get(root_hazard, FailureMode.CASUALTY if any(s in obs.subjects for s in ("injured", "dead", "people_trapped")) else FailureMode.INUNDATION)
        row = self._evidence(obs, mode, lr, "human_report", raw_ref=root.claim_id, ts=root.ts or obs.ts.isoformat())
        if root.claim_id != obs.obs_id:
            self.db.replace_evidence_for_ref(root.claim_id, [row])
            return []
        return [row]

    def _machine(self, obs: Observation) -> list[dict[str, Any]]:
        if not obs.settlement_id or not self.package.settlement(obs.settlement_id):
            self.db.queue_disambiguation(obs.obs_id, self._observation_payload(obs))
            return []
        if obs.channel == "telecom" or obs.kind == "telemetry":
            observed, expected = float(obs.extra.get("observed", 0)), float(obs.extra.get("expected", 0))
            ratio = observed / expected if expected > 0 else 1.0
            lrs = telecom_lrs(ratio, minutes_to_drop=obs.extra.get("params", {}).get("minutes_to_drop", 10), sustained_hours=obs.extra.get("params", {}).get("sustained_hours", 3))
            return [self._evidence(obs, mode, lr, "telemetry") for mode, lr in lrs.items()]
        if obs.channel == "sar" or obs.kind == "sar":
            lrs = sar_lrs(coherence_loss=float(obs.extra.get("coherence_loss") or 0), backscatter_drop_db=float(obs.extra.get("backscatter_drop_db") or 0), usable=bool(obs.extra.get("usable", True)))
            return [self._evidence(obs, mode, lr, "remote_sensing") for mode, lr in lrs.items()]
        if obs.channel == "power" or obs.kind == "power":
            return [self._evidence(obs, mode, lr, "telemetry") for mode, lr in power_lrs(str(obs.extra.get("condition") or "unknown")).items()]
        if obs.channel == "verification" or obs.kind == "verification":
            result = str(obs.extra.get("result") or "inconclusive")
            mode = FailureMode(str(obs.extra.get("params", {}).get("failure_mode", FailureMode.COLLAPSE.value)))
            return [self._evidence(obs, mode, verification_lr(result), "verification")]
        if obs.channel == "cascade" or obs.kind == "cascade":
            mode = FailureMode(str(obs.extra.get("params", {}).get("failure_mode", FailureMode.INUNDATION.value)))
            return [self._evidence(obs, mode, float(obs.extra.get("params", {}).get("lr", 1.0)), "cascade")]
        return []

    @staticmethod
    def _evidence(obs: Observation, mode: FailureMode, lr: float, group: str, *, raw_ref: str | None = None, ts: str | None = None) -> dict[str, Any]:
        return {"settlement_id": obs.settlement_id, "channel": obs.channel, "failure_mode": mode.value, "log_lr": math.log(max(0.001, lr)), "correlation_group": group, "ts": ts or obs.ts.isoformat(), "raw_ref": raw_ref or obs.obs_id}

    @staticmethod
    def _observation_payload(obs: Observation) -> dict[str, Any]:
        return {field: getattr(obs, field) for field in obs.__dataclass_fields__}

    def _claim_payload(self, obs: Observation, root: str, size: int, independent: int) -> dict[str, Any]:
        return {"id": obs.obs_id, "source_id": obs.source_id, "settlement_id": obs.settlement_id, "geo_confidence": obs.geo_confidence, "hazard": obs.hazard, "claim_text": obs.text_en, "text_orig": obs.text_orig, "lang": obs.lang, "severity_hint": obs.severity_hint, "info_type": "infrastructure_damage" if any(s in obs.subjects for s in ("road", "bridge", "embankment", "power")) else "affected_individuals", "is_firsthand": obs.is_firsthand, "channel": obs.channel, "ts": obs.ts.isoformat(), "cascade_root_id": root, "cascade_size": size, "independent_sources": independent, "provenance": obs.provenance, "chain_json": obs.chain}
