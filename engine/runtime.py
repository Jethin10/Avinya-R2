from __future__ import annotations

import asyncio
import hashlib
import json
import math
from datetime import datetime, timedelta
from typing import Any

from core.belief import STATE_CHANNELS, EvidenceTerm, FailureMode, fuse, sigmoid, smooth_once, supersede_state_channels
from core.cascade import propagate
from core.dispatch import ASSET_FOR_MODE, DispatchCandidate, solve
from core.voi import VerificationCandidate, rank as rank_voi
from core.routing import assess_route
from core.seismic import Epicentre, caveats as seismic_caveats, shake as shake_district
from engine.clock import SimulationClock
from engine.db import Database
from engine.package import DistrictPackage
from engine.schemas import RawEvent
from engine.sse import EventBroker
from ingest.pipeline import Pipeline


class Runtime:
    def __init__(self, package: DistrictPackage, db: Database, checkpoint_interval: int = 15):
        self.package = package
        self.db = db
        self.pipeline = Pipeline(package, db)
        self.broker = EventBroker()
        self.checkpoint_interval = checkpoint_interval
        self._lock = asyncio.Lock()
        start = datetime.fromisoformat(package.meta["replay"]["t0"])
        end = datetime.fromisoformat(package.meta["replay"]["t1"])
        self.clock = SimulationClock(start, end, start)
        self.state: dict[str, Any] = {}
        self.disabled_channels: set[str] = set()
        self.cut_edges: set[str] = set()
        self.injected_events: list[RawEvent] = []
        self.live_events: list[RawEvent] = []
        self._last_checkpoint_minute: int | None = None
        self.last_robustness: dict[str, Any] = {"top10_rank_displacement": 0, "affected_top10": 0}

    async def initialise(self) -> dict[str, Any]:
        async with self._lock:
            self.db.reset_runtime(preserve_audit=False)
            self.state = self._compute(self.clock.start, replay=True)
            return self.state

    async def seek(self, target: datetime) -> dict[str, Any]:
        async with self._lock:
            self.clock.current = min(self.clock.end, max(self.clock.start, target))
            self.db.reset_runtime(preserve_audit=True)
            self.state = self._compute(self.clock.current, replay=True)
            await self.broker.publish(self.state)
            return self.state

    async def tick(self, target: datetime | None = None) -> dict[str, Any]:
        async with self._lock:
            if target is not None:
                self.clock.current = min(self.clock.end, max(self.clock.start, target))
            self.state = self._compute(self.clock.current, replay=True)
            await self.broker.publish(self.state)
            return self.state

    async def reset(self) -> dict[str, Any]:
        async with self._lock:
            self.clock.command("reset")
            self.injected_events.clear(); self.live_events.clear(); self.disabled_channels.clear(); self.cut_edges.clear()
            self.last_robustness = {"top10_rank_displacement": 0, "affected_top10": 0}
            self.db.reset_runtime(preserve_audit=False)
            self.state = self._compute(self.clock.start, replay=True)
            await self.broker.publish(self.state)
            return self.state

    def ingest_live(self, event: RawEvent) -> list[dict[str, Any]]:
        # During a replay, an untimestamped live report belongs to the shared simulation clock,
        # not the operator laptop's wall clock.
        if event.t is None and event.ts is not None and event.ts > self.clock.end and event.provenance == "live":
            event = event.model_copy(update={"ts": self.clock.current})
        self.live_events.append(event)
        rows = self.pipeline.process(event)
        if rows: self.db.add_evidence(rows)
        self.state = self._compute(self.clock.current, replay=False)
        return rows

    def _replay_due_events(self, target: datetime) -> None:
        events = [*self.package.events]
        events.extend(event.model_dump(mode="json", exclude_none=True) for event in self.injected_events)
        events.extend(event.model_dump(mode="json", exclude_none=True) for event in self.live_events)
        events.sort(key=lambda event: event.get("t") or event.get("ts"))
        for raw in events:
            event_time = datetime.fromisoformat(str(raw.get("t") or raw.get("ts")))
            if event_time > target or raw.get("channel") in self.disabled_channels:
                continue
            event = RawEvent.model_validate(raw)
            rows = self.pipeline.process(event)
            if rows: self.db.add_evidence(rows)

    def _compute(self, sim_t: datetime, *, replay: bool) -> dict[str, Any]:
        if replay:
            self._replay_due_events(sim_t)
        evidence_rows = self.db.evidence(until=sim_t.isoformat())
        terms = supersede_state_channels(
            EvidenceTerm(row["settlement_id"], FailureMode(row["failure_mode"]), row["log_lr"], row["correlation_group"], row["channel"], row["raw_ref"])
            for row in evidence_rows
        )
        states = smooth_once(fuse(self.package.priors, terms), self.package.neighbours)
        updated_at = sim_t.isoformat()
        belief_rows = [{"settlement_id": state.settlement_id, "failure_mode": state.failure_mode.value, "log_odds": state.log_odds, "variance": state.variance, "updated_at": updated_at} for state in states.values()]
        self.db.upsert_beliefs(belief_rows)
        settlements = {row["id"]: row for row in self.package.settlements}
        grouped: dict[str, dict[FailureMode, Any]] = {}
        for state in states.values(): grouped.setdefault(state.settlement_id, {})[state.failure_mode] = state
        inundation = {sid: modes[FailureMode.INUNDATION].probability for sid, modes in grouped.items()}
        pre_positions = propagate(inundation, self.package.cascade_edges)
        elapsed_hours = max(0.0, (sim_t - self.clock.start).total_seconds() / 3600)
        candidates: list[DispatchCandidate] = []
        route_assessments: dict[str, dict[str, Any]] = {}
        probability_by_settlement = {sid: {mode.value: state.probability for mode, state in modes.items()} for sid, modes in grouped.items()}
        for sid, modes in grouped.items():
            settlement = settlements[sid]
            probabilities = {mode: modes[mode].probability for mode in FailureMode}
            confidence = 1.0 - min(0.95, sum(s.variance for s in modes.values()) / len(modes))
            top_mode = max(probabilities, key=probabilities.get); asset_kind = ASSET_FOR_MODE[top_mode]
            route = self.package.route(sid, asset_kind)
            if route:
                route_assessments[sid] = assess_route(route, probability_by_settlement, cut_edges=self.cut_edges)
            minutes = float(route.get("eta_minutes_normal", settlement["road_hours_normal"] * 60)) if route else settlement["road_hours_normal"] * 60
            candidates.append(DispatchCandidate(sid, settlement["name"], settlement["population"], settlement["elderly_frac"], probabilities, confidence, minutes))
        passability = {sid: route_assessments.get(sid, {}).get("passability", max(0.1, 1.0 - 0.75 * modes[FailureMode.INUNDATION].probability)) for sid, modes in grouped.items()}
        dispatch_candidates: list[DispatchCandidate] = []
        evidence_by_settlement: dict[str, list[dict[str, Any]]] = {}
        for row in evidence_rows: evidence_by_settlement.setdefault(row["settlement_id"], []).append(row)
        for candidate in candidates:
            top_mode = max(candidate.probabilities, key=candidate.probabilities.get)
            top_probability = candidate.probabilities[top_mode]
            if top_probability < 0.45:
                continue
            prior_probability = sigmoid(self.package.priors[(candidate.settlement_id, top_mode)][0])
            relevant = [row for row in evidence_by_settlement.get(candidate.settlement_id, []) if row["failure_mode"] == top_mode.value]
            silence_present = any(row["channel"] == "telecom" for row in relevant)
            corroborated = any(row["channel"] != "telecom" for row in relevant)
            if silence_present and not corroborated and prior_probability < 0.60 <= top_probability:
                continue
            dispatch_candidates.append(candidate)
        plan = solve(dispatch_candidates, self.package.assets, hours_elapsed=elapsed_hours, passability=passability)
        for task in plan:
            route = self.package.route(str(task["settlement_id"]), str(task["asset_kind"]))
            assessment = route_assessments.get(str(task["settlement_id"]))
            if route and assessment:
                task["eta_minutes"] = assessment["eta_minutes"]
                task["route"] = {**assessment, "geometry": route["geometry"], "attribution": route["attribution"]}
                task["access_mode"] = "road" if assessment["status"] != "blocked" else ("water" if task["asset_kind"] == "boat" else "blocked")
                task["state"] = "proposed" if assessment["status"] != "blocked" else "needs_route_review"
        harm_by_sid = {task["settlement_id"]: float(task["expected_harm"]) for task in plan}
        ranked_sids = [c.settlement_id for c in sorted(candidates, key=lambda c: max(c.probabilities.values()) * c.population, reverse=True)]
        verify_candidates = []
        for sid, modes in grouped.items():
            top = max(modes.values(), key=lambda state: state.probability)
            verify_candidates.append(VerificationCandidate(sid, top.probability, top.variance, harm_by_sid.get(sid, settlements[sid]["population"] * top.probability), settlements[sid].get("observability", 0.5), ranked_sids.index(sid) + 1))
        verify = rank_voi(verify_candidates)
        beliefs_payload = [{"settlement_id": sid, "failure_mode": mode.value, "probability": round(state.probability, 6), "log_odds": round(state.log_odds, 6), "variance": round(state.variance, 6), "confidence": round(1.0 - min(0.95, state.variance), 6)} for (sid, mode), state in states.items()]
        belief_hash = hashlib.sha256(json.dumps(beliefs_payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        decision_payload = {"plan": plan, "verify": verify, "pre_positions": pre_positions}
        self.db.replace_decisions(updated_at, plan, verify)
        log = self.db.append_decision(updated_at, decision_payload, belief_hash)
        elapsed_minutes = int((sim_t - self.clock.start).total_seconds() // 60)
        if elapsed_minutes % self.checkpoint_interval == 0 and self._last_checkpoint_minute != elapsed_minutes:
            self.db.checkpoint(updated_at, {"beliefs": beliefs_payload, "belief_hash": belief_hash})
            self._last_checkpoint_minute = elapsed_minutes
        return {"t": updated_at, "clock": self.clock.payload(), "beliefs": beliefs_payload, "plan": plan, "verify": verify, "pre_positions": pre_positions, "log": log, "provenance": self.package.meta["provenance"]}

    def receipt(self, settlement_id: str, sim_t: datetime | None = None) -> dict[str, Any]:
        if not self.package.settlement(settlement_id): raise KeyError(settlement_id)
        until = (sim_t or self.clock.current).isoformat()
        evidence = self.db.evidence(until=until, settlement_id=settlement_id)
        prior = [{"failure_mode": mode.value, "probability": sigmoid(values[0]), "variance": values[1]} for (sid, mode), values in self.package.priors.items() if sid == settlement_id]
        posterior = [row for row in self.state.get("beliefs", []) if row["settlement_id"] == settlement_id]
        # Superseded state readings stay in the receipt and are flagged, not deleted: an operator
        # asking "why does the map say this" is owed the morning's normal heartbeats *and* the fact
        # that they stopped counting the moment the towers went to zero.
        counted: dict[tuple[str, str], int] = {}
        for row in evidence:
            if row["channel"] in STATE_CHANNELS:
                counted[(row["failure_mode"], row["channel"])] = row["id"]
        rows = [
            {**row, "lr": round(math.exp(row["log_lr"]), 6),
             "superseded": row["channel"] in STATE_CHANNELS and counted[(row["failure_mode"], row["channel"])] != row["id"]}
            for row in evidence
        ]
        return {"settlement": self.package.settlement(settlement_id), "t": until, "prior": prior, "evidence": rows, "posterior": posterior}

    def route(self, settlement_id: str, asset_kind: str) -> dict[str, Any]:
        route = self.package.route(settlement_id, asset_kind)
        if route is None: raise KeyError((settlement_id, asset_kind))
        beliefs: dict[str, dict[str, float]] = {}
        for row in self.state.get("beliefs", []): beliefs.setdefault(row["settlement_id"], {})[row["failure_mode"]] = row["probability"]
        return {**route, "assessment": assess_route(route, beliefs, cut_edges=self.cut_edges)}

    def metrics(self) -> dict[str, Any]:
        beliefs = self.state.get("beliefs", [])
        by_sid: dict[str, float] = {}; mode_by_sid: dict[str, str] = {}
        for row in beliefs:
            if row["probability"] >= by_sid.get(row["settlement_id"], -1):
                by_sid[row["settlement_id"]] = row["probability"]; mode_by_sid[row["settlement_id"]] = row["failure_mode"]
        disadvantaged = [s for s in self.package.settlements if s.get("pct_sc_st", 0) >= 0.5 or s.get("observability", 1) < 0.5]
        overall = sum(by_sid.values()) / max(1, len(by_sid)); equity = sum(by_sid.get(s["id"], 0) for s in disadvantaged) / max(1, len(disadvantaged))
        truth = {row["settlement_id"]: row for row in self.package.ground_truth}
        severe_truth = [row for row in truth.values() if row["severe"]]
        k = min(10, len(severe_truth))
        true_top = {row["settlement_id"] for row in sorted(severe_truth, key=lambda row: row["severity"], reverse=True)[:k]}
        predicted_top = [sid for sid, _ in sorted(by_sid.items(), key=lambda item: item[1], reverse=True)[:k]]
        top_k_recall = len(true_top & set(predicted_top)) / max(1, k)
        claim_sids = {row["settlement_id"] for row in self.db.claims()}
        silent_severe = [row for row in severe_truth if row["settlement_id"] not in claim_sids]
        silent_found = [row for row in silent_severe if by_sid.get(row["settlement_id"], 0) >= 0.5]
        bins = []
        for lower_index in range(10):
            lower = lower_index / 10; upper = (lower_index + 1) / 10
            members = [(sid, probability) for sid, probability in by_sid.items() if lower <= probability < upper or (lower_index == 9 and probability == 1)]
            if members:
                confidence = sum(p for _, p in members) / len(members); accuracy = sum(1.0 if truth.get(sid, {}).get("severe") else 0.0 for sid, _ in members) / len(members)
                bins.append({"lower": lower, "upper": upper, "count": len(members), "confidence": round(confidence, 4), "accuracy": round(accuracy, 4)})
        total = max(1, len(by_sid)); ece = sum(row["count"] / total * abs(row["confidence"] - row["accuracy"]) for row in bins)
        typed = []
        for task in self.state.get("plan", []):
            actual = truth.get(task["settlement_id"])
            if actual and actual["severe"]:
                expected_asset = ASSET_FOR_MODE[FailureMode(actual["failure_mode"])]
                typed.append(task["asset_kind"] == expected_asset)
        first_correct_minutes = None
        if true_top:
            for entry in self.db.decisions():
                if any(task["settlement_id"] in true_top for task in entry["payload"].get("plan", [])):
                    first_correct_minutes = max(0.0, (datetime.fromisoformat(entry["sim_t"]) - self.clock.start).total_seconds() / 60); break
        historical = bool(self.package.meta.get("historical", False))
        return {"calibration": {"status": "historical replay diagnostic; seed LRs still require held-out event fitting" if historical else "synthetic replay validation; seed LRs still require held-out real-event fitting", "ece": round(ece, 4), "curve": bins}, "operational": {"top_k": k, "top_k_recall": round(top_k_recall, 4), "silent_zone_recall": round(len(silent_found) / max(1, len(silent_severe)), 4), "silent_severe_count": len(silent_severe), "asset_type_accuracy": round(sum(typed) / len(typed), 4) if typed else None, "time_to_first_correct_dispatch_minutes": first_correct_minutes, "asset_hours_misallocated": None, "asset_hours_status": "requires a routed report-volume baseline"}, "equity": {"district_mean_priority": round(overall, 4), "disadvantaged_mean_priority": round(equity, 4), "gap": round(equity - overall, 4)}, "robustness": {"injected_events": len(self.injected_events), "disabled_channels": sorted(self.disabled_channels), **self.last_robustness}, "audit": {"hash_chain_valid": self.db.audit_chain_valid(), "entries": len(self.db.decisions())}, "disclosure": self.package.meta.get("provenance", {}).get("disclosure", "See package provenance metadata.")}

    async def shake(self, epicentre: Epicentre, *, inject: bool = False) -> dict[str, Any]:
        """Shake the district and, if asked, let the belief engine hear about it.

        Reading the ground motion is pure: ``inject=False`` computes and returns, and the replay is
        untouched. ``inject=True`` turns the strongest-shaken villages into the evidence an
        earthquake actually produces — firsthand collapse reports and, where a slope was already
        marginal, a landslide report — so the queue that comes back is the queue the existing
        dispatch solver builds from COLLAPSE and LANDSLIDE beliefs. Nothing here writes a new
        failure mode; the engine reasons about what falls down, not about the fault that shook it.

        The injected events are marked ``synthetic``, because they are: a simulated earthquake is a
        scenario an operator is exploring, not something that was observed, and every consumer of
        the decision log needs to be able to tell those two apart afterwards.
        """
        rows = shake_district(epicentre, self.package.settlements)
        response = {
            "epicentre": epicentre.payload(),
            "model": {
                "ground_motion": "Joyner & Boore (1981) horizontal PGA",
                "site_response": "Wald & Allen (2007) topographic-slope Vs30 proxy",
                "intensity": "Wald et al. (1999) PGA to Modified Mercalli",
                "fragility": "HAZUS-MH complete-damage curves, kutcha/pucca weighted",
            },
            "caveats": seismic_caveats(epicentre),
            "provenance": "synthetic",
            "injected": inject,
            "settlements": rows,
        }
        if not inject:
            response["state"] = self.state
            return response

        felt = [row for row in rows if row["mmi"] >= 5.0][:12]
        for index, row in enumerate(felt):
            when = self.clock.current + timedelta(seconds=index * 20)
            self.injected_events.append(RawEvent(
                t=when, kind="report", channel="api", source_id=f"seismic-{index}",
                provenance="synthetic", settlement_id=row["settlement_id"],
                text=(f"Shaking felt at MMI {row['mmi']:g}; masonry structures down, people trapped."
                      if row["collapse_probability"] >= 0.10 else
                      f"Shaking felt at MMI {row['mmi']:g}; walls cracked, no collapse seen."),
                hazard="quake",
                severity_hint="severe" if row["collapse_probability"] >= 0.10 else "moderate",
                is_firsthand=True,
            ))
            if row["landslide_probability"] >= 0.4:
                self.injected_events.append(RawEvent(
                    t=when + timedelta(seconds=5), kind="report", channel="api",
                    source_id=f"seismic-slope-{index}", provenance="synthetic",
                    settlement_id=row["settlement_id"],
                    text="Hillside above the settlement has come down across the approach road.",
                    hazard="landslide", severity_hint="severe", is_firsthand=True,
                ))
        response["state"] = await self.seek(self.clock.current)
        response["reports_injected"] = len(felt)
        return response

    async def inject(self, attack: str, params: dict[str, Any]) -> dict[str, Any]:
        baseline_order = self._ranked_settlements(self.state)
        if attack == "kill_sar": self.disabled_channels.add("sar")
        elif attack == "cut_edge": self.cut_edges.add(str(params.get("edge_id", "unknown")))
        else:
            count = min(500, max(1, int(params.get("count", 200 if attack == "false_reports" else 1))))
            settlement_id = str(params.get("settlement_id", self.package.settlements[0]["id"]))
            for index in range(count):
                if attack == "false_reports":
                    self.injected_events.append(RawEvent(t=self.clock.current + timedelta(seconds=index % 30), kind="report", channel="api", source_id=f"attack-{index}", provenance="synthetic", settlement_id=settlement_id, text=f"Forwarded severe collapse report {index}", hazard="quake", severity_hint="severe", is_firsthand=False))
                elif attack == "silence":
                    self.injected_events.append(RawEvent(t=self.clock.current, kind="telemetry", channel="telecom", source_id="synthetic-telecom", provenance="synthetic", settlement_id=settlement_id, observed=0, expected=100, params={"minutes_to_drop": 10, "sustained_hours": 3}))
        state = await self.seek(self.clock.current)
        if attack == "false_reports":
            after_order = self._ranked_settlements(state); positions = {sid: index for index, sid in enumerate(after_order)}
            displacement = [abs(index - positions.get(sid, len(after_order))) for index, sid in enumerate(baseline_order[:10])]
            self.last_robustness = {"top10_rank_displacement": max(displacement, default=0), "affected_top10": sum(value > 0 for value in displacement)}
        return state

    @staticmethod
    def _ranked_settlements(state: dict[str, Any]) -> list[str]:
        scores: dict[str, float] = {}
        for row in state.get("beliefs", []): scores[row["settlement_id"]] = max(scores.get(row["settlement_id"], 0), row["probability"])
        return [sid for sid, _ in sorted(scores.items(), key=lambda item: (-item[1], item[0]))]
