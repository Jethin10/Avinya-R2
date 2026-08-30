"""Deterministic field-traffic streams for the replay packages.

Two provenance classes, never mixed:

* ``archived`` — facts that exist in the KSDMA memoranda pinned in ``data/source_manifest.json``:
  event timing, Kalladi rainfall, the affected-village lists, relief-camp aggregates.
* ``synthetic`` — per-settlement message traffic, tower-attach heartbeats, feeder SCADA and
  Sentinel-1 passes. None of these exist for these events in any public historical bundle. They are
  synthesised here, deterministically, and carry ``provenance: "synthetic"`` so the engine, the
  metrics endpoint and the UI can disclose them (MASTER_PLAN.md 8.1).

The generator is seeded from the scenario id, so a rebuild reproduces the stream byte for byte.
"""

from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Iterable, Sequence


HUMAN_CHANNELS = ("ham", "sms", "whatsapp", "telegram", "voice", "odk", "email", "cap")

HAM_OPERATORS = ("HAM-VU2WYD", "HAM-VU3KLP", "HAM-VU2MPD", "HAM-VU3SLT")
ASHA_WORKERS = ("ASHA-WYD-104", "ASHA-WYD-118", "ASHA-WYD-127", "ASHA-WYD-133", "ASHA-WYD-141")
OFFICIALS = ("TAHSILDAR-VYTHIRI", "TAHSILDAR-MANANTHAVADY", "TAHSILDAR-SULTHANBATHERY", "POLICE-MEPPADI", "POLICE-KALPETTA")
FIELD_TEAMS = ("FIRE-KALPETTA", "FIRE-MANANTHAVADY", "NDRF-TVM-3", "KSEB-LINEMAN-WYD", "KSRTC-DEPOT-KALPETTA")
CIVILIANS = tuple(f"CIV-{index:04d}" for index in range(1, 61))


def _seed(scenario_id: str) -> int:
    return int.from_bytes(hashlib.blake2b(scenario_id.encode("utf-8"), digest_size=8).digest(), "big")


@dataclass(slots=True)
class StreamSpec:
    """Everything the generator needs that is scenario-specific."""

    scenario_id: str
    t0: datetime
    t1: datetime
    onset: datetime
    hazard: str
    mode: str
    severe: list[str]
    affected: list[str]
    silent: list[str]
    rumour_target: str
    anchors: list[dict[str, Any]] = field(default_factory=list)
    village_traffic: bool = True


class _Builder:
    def __init__(self, spec: StreamSpec, settlements: Sequence[dict[str, Any]]):
        self.spec = spec
        self.random = random.Random(_seed(spec.scenario_id))
        self.by_id = {row["id"]: row for row in settlements}
        self.rows: list[dict[str, Any]] = []

    # ---------------------------------------------------------------- emitters
    def _add(self, row: dict[str, Any]) -> dict[str, Any]:
        row["t"] = row["t"].isoformat()
        row["obs_id"] = f"{self.spec.scenario_id}-{len(self.rows):04d}"
        self.rows.append(row)
        return row

    def human(
        self,
        t: datetime,
        channel: str,
        source_id: str,
        text: str,
        *,
        hazard: str | None = None,
        hint: str = "unknown",
        firsthand: bool = False,
        settlement_id: str | None = None,
        lang: str = "en",
        text_orig: str | None = None,
        provenance: str = "synthetic",
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        row: dict[str, Any] = {
            "t": t, "kind": "report", "channel": channel, "source_id": source_id,
            "provenance": provenance, "text": text, "hazard": hazard or self.spec.hazard,
            "severity_hint": hint, "is_firsthand": firsthand, "lang": lang,
        }
        if text_orig: row["text_orig"] = text_orig
        if settlement_id: row["settlement_id"] = settlement_id
        if params: row["params"] = params
        return self._add(row)

    def telecom(self, t: datetime, settlement_id: str, observed: float, expected: float, *, minutes_to_drop: int, sustained_hours: float) -> dict[str, Any]:
        return self._add({
            "t": t, "kind": "telemetry", "channel": "telecom", "source_id": "telco-aggregate-wyd",
            "provenance": "synthetic", "settlement_id": settlement_id,
            "observed": round(observed, 2), "expected": round(expected, 2),
            "params": {"minutes_to_drop": minutes_to_drop, "sustained_hours": sustained_hours,
                       "measure": "aggregated tower attach count", "personal_data": False},
        })

    def power(self, t: datetime, settlement_id: str, condition: str) -> dict[str, Any]:
        return self._add({
            "t": t, "kind": "power", "channel": "power", "source_id": "kseb-feeder-scada",
            "provenance": "synthetic", "settlement_id": settlement_id, "condition": condition,
            "params": {"measure": "11 kV feeder state"},
        })

    def sar(self, t: datetime, settlement_id: str, *, coherence_loss: float, backscatter_drop_db: float, usable: bool = True) -> dict[str, Any]:
        return self._add({
            "t": t, "kind": "sar", "channel": "sar", "source_id": "sentinel1-iw-desc",
            "provenance": "synthetic", "settlement_id": settlement_id,
            "coherence_loss": round(coherence_loss, 3), "backscatter_drop_db": round(backscatter_drop_db, 2),
            "usable": usable, "params": {"note": "synthesised pass geometry; no Sentinel-1 granule is bundled"},
        })

    def verification(self, t: datetime, settlement_id: str, result: str, *, mode: str | None = None, actor: str = "verification-team", provenance: str = "synthetic") -> dict[str, Any]:
        return self._add({
            "t": t, "kind": "verification", "channel": "verification", "source_id": actor,
            "provenance": provenance, "settlement_id": settlement_id, "result": result,
            "params": {"failure_mode": mode or self.spec.mode},
        })

    # ---------------------------------------------------------------- helpers
    def name(self, settlement_id: str) -> str:
        return str(self.by_id[settlement_id]["name"])

    def jitter(self, base: datetime, *, minutes: int) -> datetime:
        return base + timedelta(minutes=self.random.randint(-minutes, minutes), seconds=self.random.randint(0, 59))

    def pick(self, values: Sequence[str]) -> str:
        return self.random.choice(list(values))

    def spread(self, count: int, start: datetime, end: datetime) -> list[datetime]:
        span = max(1.0, (end - start).total_seconds())
        offsets = sorted(self.random.random() for _ in range(count))
        return [start + timedelta(seconds=offset * span) for offset in offsets]


# ------------------------------------------------------------------ phrasings
# Corroboration is *distinct messages that say the same thing*. The variants below differ by a
# single token, so token_similarity() clears the 0.8 collapse threshold: the cluster stays one
# claim while independent_source_count() rises with each new source x channel pair.
FIRSTHAND_SLIDE = "we saw the slope come down at {name} houses buried and people trapped near the {spot} line"
FIRSTHAND_FLOOD = "we saw the river break its bund at {name} water inside the houses and people stranded on the {spot} side"
SPOTS = ("estate", "school", "market", "temple", "chapel", "mosque", "ration", "anganwadi")

RUMOUR = "forwarded as received the dam at {name} has breached everyone must leave immediately"
CONTRADICTION = (
    "spoke to relatives in {name} they say all is fine and the houses are intact",
    "no damage reported from {name} as of now everything looks safe there",
    "{name} is intact my cousin says there is no damage on that road",
)
MODERATE = (
    "waterlogging on the {name} approach road, vehicles are being turned back",
    "the culvert near {name} is damaged and one lane is under water",
    "power is out at {name} and the feeder road has minor slips",
    "trees down across the {name} route, moderate damage to two houses",
)
MALAYALAM_SLIDE = "ഞങ്ങൾ കണ്ടു, {name} ൽ മല ഇടിഞ്ഞു വീടുകൾ മൂടി, ആളുകൾ കുടുങ്ങി"
MALAYALAM_FLOOD = "ഞങ്ങൾ കണ്ടു, {name} ൽ പുഴ കര കവിഞ്ഞു വീടുകളിൽ വെള്ളം കയറി"
UNRESOLVABLE = (
    "landslide near the seventh mile estate lines, need help now",
    "water rising fast behind the new colony past the check post",
    "road gone at the upper division, three families cut off",
)


def _baseline(settlement: dict[str, Any]) -> float:
    return round(max(40.0, float(settlement["population"]) / 12.0), 2)


def _finalise(builder: _Builder) -> list[dict[str, Any]]:
    rows = sorted(builder.rows, key=lambda row: (row["t"], row["obs_id"]))
    for index, row in enumerate(rows):
        row["obs_id"] = f"{builder.spec.scenario_id}-{index:04d}"
    return rows

def build(spec: StreamSpec, settlements: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
    """Compose one scenario's full event stream, ordered in time and stably identified."""
    builder = _Builder(spec, settlements)
    ids = [row["id"] for row in settlements]
    severe = [sid for sid in spec.severe if sid in builder.by_id]
    affected = [sid for sid in spec.affected if sid in builder.by_id]
    silent = [sid for sid in spec.silent if sid in builder.by_id]
    quiet = [sid for sid in ids if sid not in affected and sid not in severe]
    firsthand_template = FIRSTHAND_SLIDE if spec.hazard == "landslide" else FIRSTHAND_FLOOD
    malayalam = MALAYALAM_SLIDE if spec.hazard == "landslide" else MALAYALAM_FLOOD

    for anchor in spec.anchors:
        builder.human(
            spec.t0 + timedelta(minutes=int(anchor.get("offset_minutes", 0))),
            anchor.get("channel", "official-record"), anchor["source_id"], anchor["text"],
            hint=anchor.get("severity_hint", "unknown"), provenance="archived",
            params={"scope": "district", **anchor.get("params", {})},
        )

    # Phase 1 - normality as evidence. Attach counts and feeder states while nothing is wrong carry
    # LR < 1 for both failure modes, so the map starts genuinely, provably calm rather than blank.
    hours = max(3, int((spec.onset - spec.t0).total_seconds() // 3600))
    for hour in range(0, hours, 3):
        stamp = spec.t0 + timedelta(hours=hour)
        for sid in ids[:: 1 if hour % 6 == 0 else 2]:
            expected = _baseline(builder.by_id[sid])
            builder.telecom(stamp, sid, expected * builder.random.uniform(0.93, 1.04), expected,
                            minutes_to_drop=0, sustained_hours=0.0)
    for sid in ids[::4]:
        builder.power(spec.t0 + timedelta(minutes=30), sid, "normal")

    if not spec.village_traffic:
        return _finalise(builder)
    # Phase 2 - onset. Distinct first-hand messages that say the same thing, arriving from
    # different source x channel pairs: one claim, a rising independent-source count.
    for order, sid in enumerate(severe):
        name = builder.name(sid)
        witnesses = [(builder.pick(HAM_OPERATORS), "ham"), (builder.pick(ASHA_WORKERS), "voice"),
                     (builder.pick(FIELD_TEAMS), "sms"), (builder.pick(OFFICIALS), "telegram"),
                     (builder.pick(CIVILIANS), "whatsapp")]
        for index, (source_id, channel) in enumerate(witnesses):
            spot = SPOTS[(order + index) % len(SPOTS)]
            stamp = builder.jitter(spec.onset + timedelta(minutes=8 + 17 * index), minutes=4)
            english = firsthand_template.format(name=name, spot=spot)
            if index == 2:
                builder.human(stamp, channel, source_id, english, hint="catastrophic", firsthand=True,
                              settlement_id=sid, lang="ml", text_orig=malayalam.format(name=name))
                continue
            builder.human(stamp, channel, source_id, english, hint="catastrophic" if index == 0 else "severe",
                          firsthand=True, settlement_id=sid)
        builder.sar(spec.onset + timedelta(hours=4, minutes=12), sid,
                    coherence_loss=0.78 if spec.hazard == "landslide" else 0.22,
                    backscatter_drop_db=1.1 if spec.hazard == "landslide" else 5.4)
        builder.power(builder.jitter(spec.onset + timedelta(minutes=6), minutes=3), sid, "dead")
        if sid not in silent:
            # A village people are reporting from is still reachable, but not intact: the attach
            # count decays as handsets lose power and the valley fills. Without this reading the
            # pre-onset "normal" heartbeat would stay the newest telemetry a destroyed village has,
            # and go on arguing against the very failure five witnesses just described.
            expected = _baseline(builder.by_id[sid])
            builder.telecom(spec.onset + timedelta(minutes=35), sid, expected * 0.21, expected,
                            minutes_to_drop=280, sustained_hours=2.5)

    # Phase 3 - the rumour cascade. Twenty-four forwards of one identical, non-first-hand claim
    # about a village that is fine. Volume without independence: the cluster keeps one weight.
    target = spec.rumour_target if spec.rumour_target in builder.by_id else (quiet or ids)[0]
    rumour_text = RUMOUR.format(name=builder.name(target))
    for stamp in builder.spread(24, spec.onset + timedelta(minutes=25), spec.onset + timedelta(hours=5)):
        builder.human(stamp, builder.pick(("whatsapp", "telegram", "sms")), builder.pick(CIVILIANS),
                      rumour_text, hint="severe", firsthand=False, settlement_id=target)

    # Phase 4 - contradictions about a village that is genuinely destroyed. Not suppressed: carried
    # with LR < 1 so the receipt can show them being discounted rather than quietly dropped.
    for sid in severe:
        for offset, template in enumerate(CONTRADICTION):
            builder.human(builder.jitter(spec.onset + timedelta(hours=2 + offset), minutes=20),
                          builder.pick(("whatsapp", "email", "telegram")), builder.pick(CIVILIANS),
                          template.format(name=builder.name(sid)), hint="none", firsthand=False,
                          settlement_id=sid)

    # Phase 5 - silence. A hard zero reached inside fifteen minutes and sustained, plus a dead
    # feeder: the shape of a village that lost its towers, not one that simply stopped talking.
    for sid in silent:
        expected = _baseline(builder.by_id[sid])
        builder.telecom(spec.onset - timedelta(minutes=25), sid, expected * 0.88, expected, minutes_to_drop=0, sustained_hours=0.0)
        builder.telecom(spec.onset + timedelta(minutes=12), sid, 0.0, expected, minutes_to_drop=11, sustained_hours=3.5)
        builder.telecom(spec.onset + timedelta(hours=6), sid, 0.0, expected, minutes_to_drop=9, sustained_hours=8.0)
        builder.power(spec.onset + timedelta(minutes=18), sid, "dead")
        # Nobody is sending messages from here, so the overhead pass is the only other witness.
        builder.sar(spec.onset + timedelta(hours=4, minutes=12), sid, coherence_loss=0.71,
                    backscatter_drop_db=1.4 if spec.hazard == "landslide" else 3.6)
    # Phase 6 - the ordinary majority: moderate damage on affected villages, gradual telecom decay
    # where a valley is filling rather than collapsing, and one pass with no usable signal at all.
    # Silent villages are excluded here too: a place whose towers are a hard zero cannot file a
    # moderate-damage report either, and one stray ODK row from it would quietly turn the silent-zone
    # metric into a no-op by giving the village a claim it could never have sent.
    ordinary = [sid for sid in affected if sid not in severe and sid not in silent][:18]
    for index, sid in enumerate(ordinary):
        builder.human(builder.jitter(spec.onset + timedelta(minutes=40 + 11 * index), minutes=15),
                      builder.pick(("odk", "sms", "voice", "email")),
                      builder.pick(ASHA_WORKERS + OFFICIALS + FIELD_TEAMS),
                      MODERATE[index % len(MODERATE)].format(name=builder.name(sid)),
                      hint="moderate", firsthand=index % 3 == 0, settlement_id=sid)
        if index % 3 == 1:
            expected = _baseline(builder.by_id[sid])
            builder.telecom(spec.onset + timedelta(hours=3), sid, expected * 0.18, expected,
                            minutes_to_drop=300, sustained_hours=3.0)
        if index % 5 == 2:
            builder.power(spec.onset + timedelta(hours=1), sid, "tripped")
    for sid in ordinary[:6] or severe:
        builder.sar(spec.onset + timedelta(hours=4, minutes=12), sid, coherence_loss=0.12,
                    backscatter_drop_db=4.6 if spec.hazard == "flood" else 1.2)
    if ordinary:
        builder.sar(spec.onset + timedelta(hours=4, minutes=13), ordinary[-1], coherence_loss=0.0,
                    backscatter_drop_db=0.0, usable=False)

    # Phase 7 - reports whose place name is in no gazetteer. These must queue for a human rather
    # than be attached to whichever village happens to look plausible.
    for index, text in enumerate(UNRESOLVABLE):
        builder.human(builder.jitter(spec.onset + timedelta(hours=1, minutes=20 * index), minutes=10),
                      builder.pick(("voice", "sms", "ham")), builder.pick(CIVILIANS), text,
                      hint="severe", firsthand=True)

    # Phase 8 - verification returns. The rumour target is checked and found intact; that single
    # return is worth more than all twenty-four forwards put together.
    builder.verification(spec.onset + timedelta(hours=5, minutes=30), target, "confirmed_intact")
    for sid in silent:
        if sid not in severe:
            builder.verification(spec.onset + timedelta(hours=9), sid, "inconclusive")
    return _finalise(builder)
