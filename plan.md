# SETU — Severity Estimation & Triage under Uncertainty

**Problem Statement 5 — The Post-Disaster Information Fog**

> *One line:* Every existing disaster system produces a **layer**. None produces a **decision**.
> SETU stands on Ushahidi, KoboToolbox, Sahana Eden, Sentinel-1, SKAI, IODA and Bhuvan, and outputs
> the one thing a District Magistrate needs at 03:00 — a ranked, asset-typed, routed, auditable
> dispatch order — **including for the villages that no layer and no report can see.**

---

## Table of Contents

1. [Problem decomposition](#1-problem-decomposition)
2. [Solution overview](#2-solution-overview)
3. [Non-goals (the trap list)](#3-non-goals-the-trap-list)
4. [Architecture](#4-architecture)
5. [Core modules M1–M4](#5-core-modules-m1m4)
6. [Flagship extensions F1–F3](#6-flagship-extensions-f1f3)
7. [The belief engine — the math](#7-the-belief-engine--the-math)
8. [Reuse inventory — code we fork or vendor](#8-reuse-inventory--code-we-fork-or-vendor)
9. [Data source inventory](#9-data-source-inventory)
10. [Prior art & novelty positioning](#10-prior-art--novelty-positioning)
11. [Data model](#11-data-model)
12. [Tech stack](#12-tech-stack)
13. [Sprint plan & team split](#13-sprint-plan--team-split)
14. [Demo script](#14-demo-script)
15. [Metrics & evaluation](#15-metrics--evaluation)
16. [Risks & mitigations](#16-risks--mitigations)
17. [Roadmap (mention, do not build)](#17-roadmap-mention-do-not-build)
18. [References](#18-references)
19. [Open TODOs to verify](#19-open-todos-to-verify)

---

## 1. Problem decomposition

The PS contains four hard requirements. We build exactly four core modules, one per requirement.

| The PS says | Requirement | Module |
|---|---|---|
| "fragmented, contradictory, unverified ground reports via word-of-mouth, satellite phone fragments, and social media panic" | Absorb messy multi-channel input; collapse duplicated rumour; weight sources by trust | **M1 Ingest & Truth-Weighting** |
| "cannot objectively assess the true scale of destruction... total collapse versus minor waterlogging" | Produce an objective, per-settlement severity **with a type and a confidence** | **M2 Severity / Belief Engine** |
| "field verification teams cannot physically reach remote settlements" | Evidence must arrive by non-physical channels; the few remote checks possible must be spent optimally | **M3 Remote Verification Queue (VoI)** |
| "scarce search-and-rescue assets (inflatable boats, heavy excavators, and medical teams) are deployed haphazardly" | Output an asset-typed, ordered, executable dispatch plan | **M4 Asset-Typed Dispatch** |

### 1.1 The key insight — severity is not a scalar

The PS names **three** asset classes. That is not decoration: they answer **three different failure
modes**, and the failure mode is what selects the asset. So the model output is
`(failure_type, magnitude, confidence)`, not a single "severity score".

| Failure mode | Multi-channel signature | Asset |
|---|---|---|
| **Inundation + stranding** | SAR backscatter drop; InSAR coherence **preserved**; telecom decays gradually over 4–8 h (tower batteries); reports **abundant**; flat terrain; slow onset | Inflatable boats |
| **Structural collapse / burial** | InSAR coherence **lost**; telecom **hard zero at the event timestamp**; power feeder dead; reports **absent**; steep slope / high stream power; sudden onset | Heavy excavators |
| **Casualty load** | population × severity × hours-since-event × elderly fraction; PHC reachability; survival-decay curve | Medical teams |

> **Waterlogging is loud and structurally quiet. Collapse is structurally loud and communicatively
> silent.** They call opposite assets. Today both get whatever vehicle is nearest.

This single table answers *"total collapse versus minor waterlogging"* **and** *"deployed
haphazardly"* at once.

### 1.2 The information paradox at the heart of the PS

A settlement that is **totally destroyed produces zero reports.** Report volume is *anti-correlated*
with severity in exactly the cases that matter most. Every report-driven system (Ushahidi,
social-media dashboards, the district control-room phone) therefore systematically **inverts** the
priority order. Fixing that inversion is the core of SETU.

---

## 2. Solution overview

**SETU maintains one row per settlement holding a probability distribution over failure modes.**
Every arriving signal — a phone call, a satellite pass, a *silence* — is a likelihood ratio that
moves that distribution. Everything else in the system either **writes to** that table or **reads
from** it.

Five properties that define the product:

1. **Defined from t = 0.** A physics prior (rainfall + DEM + Census housing + population) gives every
   settlement a severity number **before any report arrives**. No cold start, no blank screen.
2. **Silence is evidence, not missing data.** Absence of an expected heartbeat is a likelihood term.
3. **Contradiction is routed, not averaged.** Conflicting reports raise variance, which raises
   Value-of-Information, which sends the next verification there.
4. **Output is a plan, not a map.** Asset-typed, routed, time-ordered, with an evidence receipt per line.
5. **Calibrated and auditable.** When it says 0.7 it is right ~70% of the time, and the DM can prove
   what the system knew at 03:12 and why.

---

## 3. Non-goals (the trap list)

**Do not build any of these.** Each is off the fog-to-decision axis, each is already in every
hackathon room, and each dilutes a pitch that currently reads as one coherent idea.

- Citizen SOS / panic-button app
- General-purpose disaster chatbot
- Preparedness / awareness portal
- Blockchain relief tokens or donation tracking
- Any hardware (mesh nodes, LoRa, drones) — this is a **software-only** build
- A "predict the disaster before it happens" model
- Social-media sentiment dashboard
- Missing-persons face matching

**Rule:** if a feature does not change which asset goes where, it does not ship.

---

## 4. Architecture

```
   word-of-mouth · satphone fragments · WhatsApp · HAM · social media
                              |
                    Whisper ASR -> LLM claim extraction -> gazetteer (LGD codes)
                              |
        M1  dedupe (rumour-cascade collapse)  ->  trust (source reliability posterior)
                              |
                              v
  physics prior --->    M2  BELIEF ENGINE    <--- silence  (IODA / Meta D4G / ITU DCM)
  (DEM + Census +       per settlement,      <--- SAR      (Sentinel-1 backscatter + coherence)
   CWC + IMD)           per failure mode     <--- damage   (SKAI / ARIA DPM / Maxar Open Data)
                              |
                +-------------+-------------+
                |                           |
                v                           v
     F1 CASCADE ENGINE            M3 VERIFICATION QUEUE (VoI)
     time-lagged downstream       "sat-phone Kharsa PHC: 4 min,
     belief propagation            flips boat #2"  ----------+
                |                                            |
                v                                            |
     M4 DISPATCH  +  F2 REACHABILITY                         |
     boats / excavators / medical                            |
     routed, ETA, evidence receipt                           |
                |                                            |
                v                                            |
     F3 degradation ladder: web -> SMS -> radio -> printed sheet
                                                             |
     answers re-enter M1 <-----------------------------------+
```

---

## 5. Core modules M1–M4

### M1 — Ingest & Truth-Weighting

**Input:** WhatsApp exports, call-centre logs, satphone audio, HAM net transcripts, tweets,
KoboToolbox forms.

| Sub-component | Job | Built on |
|---|---|---|
| `asr` | Garbled satphone audio → text, multilingual | OpenAI Whisper |
| `extract` | Text → structured Claim JSON (location string, claim, severity hint, hazard type) | LLM with a fixed narrow schema |
| `geocode` | Location string → settlement ID, tolerant of spelling variants (Bhimsar / Bheemsar / भीमसर) | Nominatim + LGD village gazetteer + rapidfuzz |
| `dedupe` | **Rumour-cascade collapse.** 40 forwards of one video = **1** observation, not 40 | sentence-transformers embeddings + propagation-time ordering + union-find |
| `trust` | Per-source reliability posterior, updated whenever ground truth later arrives | Beta posterior per `source_id` |

**Claim schema**

```json
{
  "claim_id": "c_00417",
  "source_id": "HAM-VU2XYZ",
  "channel": "ham",
  "settlement_id": "BH-042",
  "geo_confidence": 0.82,
  "hazard": "flood",
  "claim_text": "embankment breached near chainage 14, water in houses",
  "severity_hint": "severe",
  "timestamp": "2026-08-14T04:20:00+05:30",
  "cascade_root": "c_00417",
  "cascade_size": 1
}
```

**Why `dedupe` is non-negotiable:** without it, whatever goes viral hijacks the model — precisely the
failure the PS describes ("social media panic").

---

### M2 — Severity / Belief Engine

The heart. ~300 lines. Put the strongest engineer here and do not let them get pulled into UI.

- Maintains `log_odds[settlement][failure_mode]`
- Seeded by the **physics prior** (§7.1)
- Updated by a **likelihood ratio** per arriving evidence (§7.2)
- Applies **correlation damping** so correlated channels do not double-count (§7.3)
- Applies **spatial smoothing** over a neighbour graph — damage is spatially autocorrelated; an
  isolated "severe" surrounded by intact villages deserves scepticism
- Emits `(failure_mode, P, variance)` per settlement, plus the full evidence log for the receipt

**Deliberately NOT deep learning.** Three defensible reasons, all pitch material:

1. Zero labels exist for *this* event, in the first 24 hours.
2. Published damage models drop up to ~30% on unseen disaster events (xBD generalisation results).
3. The DM must see **which evidence drove the call**. Explainability is the adoption condition, not a
   nice-to-have.

---

### M3 — Remote Verification Queue (Value of Information)

The PS states field teams **cannot reach** the settlements. So verification capacity is tiny and
non-physical: sat-phone callbacks, HAM net queries, a helicopter recon leg, one drone sortie, a call
to the block PHC. Today those are spent on whoever shouted last.

**Treat verification as an allocable asset and rank it by expected decision change:**

```
VoI(action) = E[regret | decide on current belief]
            - E[regret | decide after this action resolves]
```

Practically: a settlement at P = 0.9 gets the boat regardless — verifying it changes nothing
(VoI ≈ 0). A settlement at P = 0.1 gets nothing regardless (VoI ≈ 0). A settlement **at the asset
cutoff**, or with **high variance from contradictory reports**, is where the answer flips. That is
where the eyes go.

**UI output:**

> `VERIFY NEXT — Kharsa PHC, sat-phone callback, ~4 min.`
> `Resolves whether BOAT-2 goes north or south. Expected regret reduction: 21 lives.`

**Plus an equity term (see F3b):** settlements with weak observability (low telecom baseline,
persistent cloud, no reports either way) receive a **VoI bonus** — if we cannot infer, we go look.

---

### M4 — Asset-Typed Dispatch

```
expected_harm = P(severe) × population × mortality_rate(failure_mode, hours_elapsed)
                × isolation_multiplier
```

- `mortality_rate` uses a **time-decaying survival curve** — trapped-survivor probability falls
  sharply after 24–72 h, which is why hour-6 decisions dominate hour-18 decisions.
- Rank descending, cut against the **real asset inventory**, emit **one queue per asset class**.
- Every line carries its **evidence receipt** (full audit trail from M1/M2) and a **"regret if
  wrong"** figure.

**Sample output line:**

```
BHIMSAR  (pop 2,140)          COLLAPSE      confidence 0.89
  Dispatch : 1x excavator + 1x medical team    (NOT a boat)
  Expected lives at risk if unassisted 6h : 40-90
  Why      : 11h telecom hard-zero vs 380/day baseline
             InSAR coherence lost over settlement footprint
             1x HAM report, embankment breach (source reliability 0.80)
             1x contradicting report "all fine" (source reliability 0.20, discounted)
  Access   : unreachable by road, Sirsi bridge P(passable)=0.15
             -> river ingress from Kolang ghat, ETA 06:40
  Resolve  : sat-phone callback to PHC, 4 min
```

---

## 6. Flagship extensions F1–F3

These take the build from "answers the PS" to "wins the room".
**Build in the order F2 → F1 → F3 by dependency, but if time runs out, cut F1 before F3.**

### F1 — Cascade Engine (anticipatory positioning)

The PS says **"multi-hazard event."** The correct reading is not "we handle floods *and* landslides" —
it is that **hazards cause each other, with an exploitable time lag.**

```
cloudburst -> landslide -> debris dams river -> outburst flood            (4-9 h lag)
embankment breach -> downstream inundation propagates village to village  (1-3 h lag)
stagnant water + no sanitation -> cholera / leptospirosis risk            (T+72 h)
```

**Implementation:** a second graph over the settlements.

- **Nodes:** settlements + infrastructure (embankments, bridges, check dams, landslide-dam candidates
  on steep confined reaches)
- **Edges:** hydrological downstream, dam → command area, slope → runout path, road → dependency
- **Propagation:** when belief rises at an upstream node, propagate a **time-lagged** belief increase
  downstream using flow-routing travel time

**Output — a second queue:**

```
PRE-POSITION -- DHANAURI (pop 1,800) -- currently intact
  P(severe within 6h) = 0.61
  Driver : upstream embankment at Chainage 14 at 0.80 breach belief; routing time 4h20m
  Action : move BOAT-3 now, before the Sirsi road closes
```

**Why it wins:** converts the product from reactive triage to **anticipatory positioning**. SKAI,
ICEYE and Copernicus all describe the past. And it is the strongest answer to "the routes are
severed":

> **Open roads are a depreciating asset. Spend them before they are gone.**

---

### F2 — Reachability (a ranked list is not a plan)

The PS complaint is assets deployed **haphazardly**. A ranked list says *where*; it does not say
*whether you can get there, with what, by when, and in what order.*

1. **Road graph** from OSM for the district (OSRM or Valhalla).
2. **Per-edge survival probability** `P(passable)`: flood depth over the segment (DEM + inundation),
   bridge fragility given discharge, landslide susceptibility on the cut slope. Updated live —
   **including from silence**: if every settlement beyond node N went dark simultaneously, the
   corridor through N is probably cut.
3. **Access mode matters — different assets traverse different graphs.**
   - Boat: *can* traverse flooded edges a truck cannot; needs a launch point / ghat
   - Excavator: heavy; needs bridge load capacity; slowest
   - Medical team (light 4×4): fastest on intact road, stopped by shallow water
   - Helicopter: ignores the graph, needs an LZ + daylight

   (Valhalla is preferred over OSRM here precisely because it supports **custom costing models**.)
4. **Solve a stochastic team-orienteering / VRP:** maximise expected lives saved subject to asset
   inventory, expected travel time, and the time-decaying survival curves. Greedy seed + local search
   with OR-Tools. **Optimality is not needed** — you need to beat "send whatever is nearest".

**Output changes from a list to a plan:**

```
BOAT-2 | Team Alpha | depart 04:10
  1. Bhimsar   -- unreachable by road (Sirsi bridge P=0.15)
                  river ingress from Kolang ghat, ETA 06:40
  2. Dhanauri  -- ETA 08:15  (pre-position, see F1)
  Expected lives saved on this route : 34     (next-best alternative: -11)
```

---

### F3 — Adversarial & degradation resilience

**Highest leverage item in the whole plan.** Almost no team demos their own system failing
gracefully, and every judge is privately wondering what happens when it breaks.

#### F3a — Red-team the model, live on stage

| Attack | Real-world motive | What SETU does |
|---|---|---|
| **Strategic over-reporting** — a village floods the channel claiming total destruction | relief funds, compensation, political pressure | Source-reliability posterior + physics prior contradict it; belief barely moves; flagged *"claim inconsistent with hazard model"* |
| **Coordinated misinformation** — 200 messages about a fake dam burst | panic, malice, bots | Rumour-cascade collapse reduces it to **1** low-trust observation |
| **Sensor failure** — SAR pass 100% cloud / decorrelated | monsoon, vegetation, long temporal baseline | That channel's LR → 1.0, contributes nothing; belief falls back on remaining channels. **It degrades, it does not lie** |

**Put a robustness number on a slide:**
*"Under a coordinated 200-message false-report attack, the top-10 dispatch order changes by 1
position."* That number is worth more than any amount of UI polish.

#### F3b — The equity failure we name before a judge does

The silence channel has a **built-in bias**: a well-connected village going dark screams; a tribal
hamlet with almost no baseline connectivity produces **no detectable change**.
**Silence-based sensing is systematically weakest for the most marginalised settlements — exactly the
ones this PS is about.** We fix it explicitly:

- **Normalise by baseline strength.** Low-baseline settlements shift weight toward physics prior +
  vulnerability instead of silence.
- **Low-observability settlements get a VoI bonus.** Uncertainty itself earns a verification slot.
- **Ship a live equity audit panel:** dispatch rate for SC/ST-majority and remote hamlets vs district
  average.

Naming your own system's discriminatory failure mode **and fixing it in the allocator** is the single
most mature move available to a student team in a government hackathon.

#### F3c — The degradation ladder

| Level | Infrastructure available | SETU still delivers |
|---|---|---|
| 5 | Full internet | Live multi-channel fusion |
| 4 | Intermittent | Cached tiles, queued sync, local inference |
| 3 | SMS only | RapidPro: dispatch orders out, verification callbacks in |
| 2 | Voice / HAM only | Duty officer reads the queue over radio |
| 1 | **Power out, nothing** | **One-page printed dispatch sheet** on last battery — ranked, asset-typed, with evidence receipts |

**Closing demo move: pull the network cable and keep going. Print the sheet.**

#### F3d — Tier-2 cheap wins (few hours each, high signal)

- **Hash-chained audit log.** Every decision stored with the exact belief state at decision time,
  chained. Indian disasters get judicial inquiries and CAG audits — *"the DM can prove what they knew
  at 03:12 and why"* is an adoption argument no competitor makes.
- **Human-in-command override.** DM overrides → system records the override **and the outcome**, then
  recalibrates. Frames the AI as advisory — the only politically viable framing for a govt buyer.
- **Confidence-gated autonomy.** P > 0.8 → recommends. 0.4–0.8 → *demands* verification first.
  P < 0.4 → stays quiet. The system knows the limits of its own competence.
- **Learns across events.** Likelihood ratios and source reliabilities persist between disasters.
  *"Cyclone Remal taught it; Wayanad used it."*
- **Digital-twin drill mode.** Replay past events for EOC training on a blue-sky day. This is the
  **adoption wedge** — it gets the software installed *before* a disaster, which is the only way it is
  ever there *during* one.

---

## 7. The belief engine — the math

### 7.1 Physics prior (t = 0, zero reports)

```
hazard intensity   : rainfall (IMD / GPM IMERG) + discharge (CWC) + DEM/HAND -> inundation depth
                     slope + soil + antecedent moisture -> landslide susceptibility
vulnerability      : pct_kutcha / pct_pucca from Census housing tables; plinth height; storeys
exposure           : population (Census / WorldPop), time-of-day occupancy, elderly fraction
fragility curve    : (depth, building class) -> P(damage state)
```

```python
settlement.log_odds[COLLAPSE]   = logit(fragility(depth, pct_kutcha))
settlement.log_odds[INUNDATION] = logit(inundation_prob(depth, hand))
```

### 7.2 Evidence update — one line is the engine

Every evidence item carries a likelihood ratio:

```
LR = P(evidence | severe) / P(evidence | not severe)
```

```python
settlement.log_odds[mode] += log(LR)
```

### 7.3 Worked example — two villages, same district, T+11h

**Bhimsar** — the silent one. Prior P = 0.45 → log-odds −0.20

| Evidence | P(e\|severe) | P(e\|not) | LR | log LR |
|---|---|---|---|---|
| 11 h telecom hard-zero vs 380/day baseline | 0.80 | 0.15 | 5.3 | +1.67 |
| InSAR coherence lost over settlement footprint | 0.70 | 0.20 | 3.5 | +1.25 |
| HAM report: embankment breach (reliability 0.8) | — | — | 3.0 | +1.10 |
| Contradicting "all fine" (reliability 0.2) | — | — | 0.85 | −0.16 |

Evidence sum = **+3.86**. Telecom silence and coherence loss are **correlated** (same cause), so apply
correlation damping λ = 0.6 (fit on replay data):

```
posterior log-odds = -0.20 + (0.6 x 3.86) = +2.11   ->   P(severe) = 0.89
```

**Kolang** — the loud one. Prior P = 0.30 → log-odds −0.85. 0.6 m water, mostly pucca.

| Evidence | LR | log LR |
|---|---|---|
| Heartbeat **normal** (0.10 / 0.75) | 0.13 | **−2.04** |
| Coherence **preserved** | 0.40 | −0.92 |
| 40 messages → collapsed to 1 root claim | 2.0 | +0.69 |

```
posterior log-odds = -0.85 + (0.6 x -2.27) = -2.21   ->   P(severe) = 0.10
```

**The demo money shot.** Kolang generates 40× more reports and **falls** to 0.10. Bhimsar sends one
fragment then goes silent and **climbs** to 0.89. Note that *"heartbeat normal"* is the strongest
single term in Kolang's row: **normality is evidence too.**

### 7.4 Expected harm → ranking

| Village | P(severe) | Pop | Isolation | Expected lives at risk |
|---|---|---|---|---|
| Bhimsar | 0.89 | 2,140 | 1.8× (30 h to reach) | **68** |
| Kolang | 0.10 | 3,400 | 1.0× | 7 |

### 7.5 Evaluation target — calibration, not accuracy

Only **argmax-relevant errors** matter. Getting settlement #47 vs #52 wrong costs nothing; dropping
the worst-hit village out of the top 10 costs lives. **Optimise for top-k recall, and for
calibration** — when the system says 0.7, is it right ~70% of the time? Plot the reliability curve
and put it in the UI. A well-calibrated system that is often uncertain is operationally trustworthy;
a confident one that is sometimes wrong is worse than nothing.

---

## 8. Reuse inventory — code we fork or vendor

> ⚠️ **Licences below are stated from prior knowledge. VERIFY each repo's `LICENSE` file before the
> submission deadline** — see §19.

### 8.1 Strategy

**Prefer consuming APIs and data models over forking AGPL codebases.** Ushahidi, KoboToolbox and
RapidPro are AGPL-3.0; forking them into our core would make SETU AGPL. Instead we (a) adopt their
*schemas and standards*, and (b) call them over HTTP where they run as separate services. Sahana Eden
is MIT and safe to vendor directly.

### 8.2 Ingest layer

| Project | Repo | Licence | What we take |
|---|---|---|---|
| **Ushahidi Platform** | `github.com/ushahidi/platform` | AGPL-3.0 | Post/survey **data model** and REST API shape; SMS + social ingest patterns. Deployed since Haiti 2010 — do not redesign this schema |
| **KoboToolbox** | `github.com/kobotoolbox/kpi`, `kobotoolbox/kobocat` | AGPL-3.0 | XLSForm standard + offline-first mobile collection. Drops Aapda Mitra volunteers straight in for teams that *can* reach |
| **OpenAI Whisper** | `github.com/openai/whisper` | MIT | ASR on garbled multilingual satphone/HAM audio. Use `faster-whisper` (MIT) for CPU speed |
| **sentence-transformers** | `github.com/UKPLab/sentence-transformers` | Apache-2.0 | Embeddings for rumour-cascade near-duplicate detection |
| **RapidPro** | `github.com/rapidpro/rapidpro` | AGPL-3.0 | Two-way SMS flows for degradation Level 3 (dispatch out, verification callbacks in) |
| **Nominatim** | `github.com/osm-search/Nominatim` | GPL-2.0 | Geocoding backbone |
| **rapidfuzz** | `github.com/rapidfuzz/RapidFuzz` | MIT | Village-name fuzzy matching against LGD codes |
| **CrisisNLP / HumAID / CrisisMMD** | `crisisnlp.qcri.org` | Research use | **The humanitarian information-type label schema** — adopt it, do not invent your own categories. Also labelled training data if we want a classifier baseline |
| **AIDR (QCRI)** | published system | — | Reference architecture for human+machine crisis classification (~80% AUC). Read the paper, borrow the design |

### 8.3 Geospatial & routing

| Project | Repo | Licence | What we take |
|---|---|---|---|
| **PostGIS** | `postgis.net` | GPL-2.0 | Spatial DB — settlements, road graph, hazard rasters |
| **Valhalla** | `github.com/valhalla/valhalla` | MIT | **Preferred router** — supports custom costing models, so boat / excavator / 4×4 can traverse *different graphs* (F2) |
| **OSRM** | `github.com/Project-OSRM/osrm-backend` | BSD-2 | Fallback router if Valhalla setup runs long |
| **NetworkX** | `github.com/networkx/networkx` | BSD-3 | Cascade dependency graph (F1) + reachability probability propagation |
| **Google OR-Tools** | `github.com/google/or-tools` | Apache-2.0 | VRP / team-orienteering solver for the dispatch plan (F2) |
| **GDAL / rasterio / rioxarray** | `github.com/OSGeo/gdal` | MIT | Raster IO for DEM, inundation, SAR |
| **MapLibre GL JS** | `github.com/maplibre/maplibre-gl-js` | BSD-3 | Offline-capable web map (no Mapbox token needed) |
| **leafmap** | `github.com/opengeos/leafmap` | MIT | Fast geospatial prototyping in notebooks during the build |
| **HOT Tasking Manager** | `github.com/hotosm/tasking-manager` | BSD-2 | Reference for volunteer verification task distribution |
| **HOT fAIr** | `github.com/hotosm/fAIr` | AGPL-3.0 | AI-assisted building footprint mapping if OSM coverage is thin |

### 8.4 Remote sensing

| Project | Repo / source | Licence | What we take |
|---|---|---|---|
| **Google/WFP SKAI** | `github.com/google-research/skai` | Apache-2.0 *(verify)* | **Consume as a damage likelihood channel — do NOT compete with it.** Zero-shot building damage; reported 13× faster / 77% cheaper than manual assessment |
| **xView2 baseline / deploy** | `github.com/DIUx-xView/xView2_baseline`, `xView2-deploy` | Apache-2.0 *(verify)* | Fallback damage classifier + the xBD label taxonomy. Note: needs clean optical pre+post, heavy GPU, ~30% accuracy drop on unseen events |
| **sentinelhub-py** | `github.com/sentinel-hub/sentinelhub-py` | MIT | Sentinel-1 SAR fetch |
| **Google Earth Engine API** | `github.com/google/earthengine-api` | Apache-2.0 | Fastest path to Sentinel-1 backscatter + coherence for the demo district |
| **ESA SNAP / snappy** | `step.esa.int` | GPL-3.0 | InSAR coherence processing if GEE is insufficient |
| **torchgeo** | `github.com/microsoft/torchgeo` | MIT | Geospatial ML utilities, pretrained remote-sensing backbones |
| **NASA ARIA Damage Proxy Maps** | `aria.jpl.nasa.gov` | US Gov | Ready-made coherence-based DPMs where an activation exists. **Known limitation:** decorrelation thresholds are chosen ad hoc and vary per event; farmland/forest decorrelates naturally |
| **OpenDroneMap** | `github.com/OpenDroneMap/ODM` | AGPL-3.0 | Only if drone imagery becomes available as a verification return |

### 8.5 Coordination / EM domain

| Project | Repo | Licence | What we take |
|---|---|---|---|
| **Sahana Eden** | `github.com/sahana/eden` | MIT | **Asset / warehouse / organisation / shelter data model.** 15+ years of refinement — vendor the schema, do not redesign it. MIT means we can copy freely |
| **InaSAFE** | `github.com/inasafe/inasafe` | GPL-3.0 | Impact-scenario methodology (hazard × exposure → impact); reference for our fragility layer |
| **CAP 1.2 (OASIS)** | standard | Open standard | Alert output format — **SACHET / NDMA compatible**. Ship this; it is a real adoption argument |

---

## 9. Data source inventory

| Layer | Source | Access | Cost | Demo status |
|---|---|---|---|---|
| DEM / terrain | Copernicus DEM (30 m), SRTM, Bhuvan CartoDEM | Open download; Bhuvan needs registration | Free | ✅ Real |
| Building footprints | **Google Open Buildings**, **Microsoft GlobalMLBuildingFootprints**, OSM | Direct download | Free | ✅ Real |
| Population | **WorldPop**, GHSL, Census of India | Direct download | Free | ✅ Real |
| Vulnerability (kutcha/pucca) | **Census of India housing tables** (HH-series) | Direct download | Free | ✅ Real |
| Village gazetteer + codes | **LGD (Local Government Directory)** `lgdirectory.gov.in` | Direct download | Free | ✅ Real |
| Rainfall | IMD, **NASA GPM IMERG** | API / download | Free | ✅ Real |
| River discharge / flood forecast | **CWC**, **Google Flood Hub API** (80 countries) | API | Free | ✅ Real |
| SAR imagery | **Sentinel-1** via Copernicus Data Space / GEE | API | Free | ✅ Real (pre-fetched) |
| VHR pre/post imagery | **Maxar (Vantor) Open Data Program** | AWS S3, activation-triggered | Free — **CC BY-NC 4.0, non-commercial** ⚠️ | ✅ Real |
| Building damage scores | **SKAI**, **NASA ARIA DPM**, **Copernicus EMS / UNOSAT** products | Varies | Free | ✅ Real where an activation exists |
| **Connectivity outage** | **CAIDA/GaTech IODA public API** | REST API | Free | ✅ **Real and live** |
| Connectivity / power / displacement tiles | **Meta Data for Good** on HDX | HDX download | Free ⚠️ verify terms | ✅ Real (archive for the event) |
| Telecom infra status | **ITU/ETC Disaster Connectivity Map** `dcm.itu.int` | Web portal | Free | 🔎 Reference layer |
| Base map / roads | **OpenStreetMap** | Planet/Geofabrik extracts | Free — ODbL (share-alike) ⚠️ | ✅ Real |
| Human reports | Replayed from real archived event + synthesised rumour cascade | — | — | ⚠️ **Replayed** |
| **Telecom tower / PDS e-POS / DISCOM feeder heartbeat** | Requires NDMA–DoT / NIC / DISCOM agreement | — | — | ⚠️ **SIMULATED — say so on stage** |

### 9.1 On the simulated channel — say it before a judge asks

The per-settlement heartbeat (tower attaches, PDS e-POS biometric auths, feeder SCADA, state bus GPS,
ASHA check-ins) is **simulated** in the demo. Volunteering this is worth more marks than hiding it.
The real integration is an **institutional agreement, not a technical problem** — and the pathway
already exists: **GSMA's Big Data for Social Good programme includes Bharti Airtel in India.**
We use **aggregated, non-personal counts only** — never subscriber-level data. That is both the
privacy-correct and the politically viable position.

### 9.2 Choice of demo event

Pick one real event with post-hoc ground truth so top-k recall is measurable:

- **Wayanad landslides, Kerala — July 2024** (best fit: multi-hazard, remote hamlets, severed routes)
- **Sikkim GLOF — October 2023** (best fit for the F1 cascade story)
- **Kerala floods — August 2018** (best data availability)

---

## 10. Prior art & novelty positioning

### 10.1 What already exists (be able to name all of it)

**Institutional / India**

| System | What it does | Gap |
|---|---|---|
| **NDEM** (NRSC/MHA) | National geospatial repo + DSS tools, secure facility at Shadnagar | Data layer, not a triage engine |
| **Bhuvan** (ISRO) | Web-GIS, flood inundation, geohazard layers | Visualisation; no severity ranking, no dispatch logic |
| **SACHET** (NDMA) | CAP-based citizen alerting, 12 languages | Outbound warning — opposite direction from this PS |
| **CWC / IMD** | Flood forecasting, rainfall nowcasts | Hazard forcing input — **use, don't rebuild** |
| **Copernicus EMS / UNOSAT** | On-demand rapid mapping activations | Activation latency; analyst-in-loop; extent ≠ severity |
| **NASA ARIA** | Automated InSAR Damage Proxy Maps | Ad-hoc thresholds; earthquake-tuned; not triage |
| **ITU/ETC Disaster Connectivity Map** | Live telecom infra status pre/post disaster | Maps *the network's* health, not *the village's* |
| **Aapda Mitra** | 100k trained community volunteers | People, not software — an **input channel for us** |

**Commercial**

| Vendor | Product | Threat |
|---|---|---|
| **Google + WFP SKAI** | Zero-shot building damage; 385k buildings scored after Hurricane Melissa (Oct 2025); Colombia floods (Feb 2026) | 🔴 **Existential if we position as "AI damage assessment."** Free and deployed — so we **consume** it |
| **ICEYE Flood Insights / Flood Rapid Impact** | Own SAR constellation; block/plot-level damage heat map within 24 h of landfall | 🔴 Commercial answer to "which areas are flooded, how badly" |
| **Esri ArcGIS Emergency Management** | Damage assessment solution, Survey123, FEMA-aligned reporting | 🟠 Owns the EOC screen — our realistic path is **plugging into** it |
| **Meta Data for Good / Disaster Maps** | Displacement, **network connectivity, electricity access**, baseline-differenced, Bing tiles z13–16 (~4.9 km) | 🔴 **Our silence pillar, already shipped** — but coarse and delivered as a separate map |
| Palantir, One Concern, Cape Analytics, Jupiter, Fathom | Risk modelling, insurance-grade analytics | 🟡 Pre-event risk / loss, not first-24h triage |

**Open source:** Ushahidi (manual verification, filters only by time/category), Sahana Eden (stronger
GIS, ageing, no inference), KoboToolbox (collection only — assumes you can reach the place), HOT/OSM +
Maxar Open Data (human-in-loop, hours-to-days), xView2/xBD, AIDR, InaSAFE, GDACS, HDX.

**Research:** TREC Incident Streams (crisis-tweet criticality triage — multi-year benchmark),
DisasterNet (KDD'23, causal Bayesian networks + normalizing flows — **closest academic relative to our
fusion engine**), DORA benchmark (arXiv 2605.11633, 2026 — 515 expert tasks, 45 real events, 108-tool
MCP library; "LLM agent for EOC" is now a benchmarked, crowded area), Joint Source Selection in Social
Sensing (arXiv 1512.00500 — nearest thing to our VoI, but for data sources not physical assets),
Flowminder CDR displacement (Haiti 2010, Nepal 2015).

**Hackathon precedent:** Call for Code 2018 **Project OWL** (mesh DuckLinks + AI clustering; $25M IBM
deployment; hardware). Call for Code 2019 Prometeo. NASA Space Apps — satellite damage mapping is
**saturated** territory. SIH past entries: "Disaster Response Management Tool", "Helping Hand"
(Assam), NDRF tweet-geolocation portal, SIH2025 preparedness platform. **Pattern: portal + chatbot +
dashboard + tweet classifier. Nobody builds a decision model.** That is our actual competition.

### 10.2 Honest novelty scoring

| Pillar | Prior art | Verdict |
|---|---|---|
| Silence as signal | Meta Disaster Maps (connectivity + electricity, baseline-differenced), Flowminder CDR, ITU DCM, CAIDA IODA | ❌ **Not novel.** Established, deployed, published |
| Physics priors → fragility curves | Standard catastrophe modelling; **SEEDS + Microsoft "Sunny Lives"** already does roof-material risk scores per home in Chennai, Bhopal, Gangtok, Dehradun | ❌ **Not novel**, and already India-localised |
| Source reliability + rumour collapse | AIDR, TREC-IS, misinformation-management literature | 🟡 **Partly novel in execution** — the problem is acknowledged everywhere, the updating reliability posterior is rarely implemented |
| **VoI-driven verification tasking** | Informative path planning, drone-routing OR literature, social-sensing source selection | ✅ **Genuinely open in product form** |
| **Regret-ranked, asset-typed, routed dispatch with evidence receipts** | Esri does damage *collection*; nobody does calibrated triage with audit trail | ✅ **Open** |
| **The fusion layer itself** | SKAI, ICEYE, Meta, Ushahidi, CWC are five separate portals | ✅ **The real gap.** Literature confirms EOCs suffer "fragmented systems, data silos, and manual struggles to correlate information across disparate platforms" |

### 10.3 Positioning — the line to use

**Kill this framing:** *"AI that detects disaster damage."* Dead on arrival — SKAI, ICEYE and xView2
own it.

**Use this:**

> **Every existing system produces a layer. None produces a decision.** SETU consumes their outputs —
> which means we get *better* as SKAI and ICEYE improve, and we are complementary rather than
> competitive.

On silence, say it **correctly** — this is stronger, not weaker:

> "Connectivity-as-a-signal isn't new; Meta and Flowminder proved it. But it ships at 2.4–4.9 km tiles
> with 8-hour aggregation and a young-user sampling bias, delivered as *a separate map*. We take it to
> the settlement, fuse it with PDS and feeder telemetry, and — critically — **feed it into a decision
> instead of a layer.** The novelty is not the signal. It's that the signal changes where the boat goes."

**Citing prior art is a scoring advantage.** The room will be full of teams claiming novelty for a
dashboard. A team that says "here are the eleven things that already exist, here is precisely the 20%
nobody has built, and here is why" reads as the only serious team present.

### 10.4 Judge Q&A prep

| Question | Answer |
|---|---|
| *"Google already does this — SKAI."* | SKAI scores buildings from imagery. It can't tell you which of two equally damaged villages to reach first, it needs an image (monsoon cloud, 12–72 h revisit), and it says nothing about a village it cannot see. We consume SKAI as **one likelihood term**. |
| *"Isn't this just Ushahidi?"* | Ushahidi is report-in, map-out, verification by hand. If nobody reports, Ushahidi shows nothing. Our worst-case village has a defined severity number with **zero** reports. |
| *"Where's your data from?"* | Public for the demo (DEM, Census, CWC, IMD, Sentinel-1, IODA live, Meta D4G on HDX). Telecom/PDS heartbeat is simulated and we say so — the real integration is an NDMA–DoT MoU, and GSMA Big Data for Social Good already includes Airtel. |
| *"Prove it works."* | Replay a real event side-by-side against report-volume ranking; show top-k recall, time-to-first-correct-dispatch, and the calibration curve. |
| *"What if it's wrong?"* | Confidence-gated autonomy, human-in-command override, hash-chained audit log, and a live equity panel. It is advisory, calibrated, and it knows when it doesn't know. |

---

## 11. Data model

```sql
-- static, loaded once
settlement(
  id, lgd_code, name, name_variants[], geom,
  population, pct_kutcha, pct_pucca, pct_sc_st, elderly_frac,
  hand_m, slope_deg, elevation_m,
  road_hours_normal, nearest_phc_id,
  heartbeat_baseline  -- expected chatter per hour-of-week
);
infrastructure(id, type, geom, capacity, fragility_params);   -- embankments, bridges, dams
road_edge(id, geom, u, v, bridge_id, base_minutes, p_passable);
cascade_edge(src_node, dst_node, lag_minutes, transfer_weight);

-- live
source(id, channel, reliability_alpha, reliability_beta);      -- Beta posterior
claim(id, source_id, settlement_id, hazard, severity_hint, ts,
      cascade_root_id, cascade_size, geo_confidence);
evidence(id, settlement_id, channel, failure_mode,
         log_lr, correlation_group, ts, raw_ref);
belief(settlement_id, failure_mode, log_odds, variance, updated_at);
belief_history(...);                                           -- for the audit trail

-- decisions
asset(id, type, capacity, home_base, status, current_node);    -- boat|excavator|medical
task(id, settlement_id, asset_id, kind, eta, expected_lives_saved, state);
verification_task(id, settlement_id, action, minutes, voi_score, state);
decision_log(id, ts, payload_json, belief_snapshot_hash, prev_hash);  -- hash-chained
override(id, decision_id, user, reason, ts, outcome);
```

---

## 12. Tech stack

| Layer | Choice | Why |
|---|---|---|
| DB | **PostgreSQL + PostGIS** (SQLite+SpatiaLite fallback for the offline laptop build) | Spatial joins, and the offline story needs a file-based fallback |
| Backend | **Python 3.11 + FastAPI** | Same language as the geo/ML stack; fast to write |
| Belief engine | Plain **NumPy / pandas** — no framework | ~300 lines; must be readable and explainable on stage |
| Routing | **Valhalla** (OSRM fallback) | Custom costing per asset class (F2) |
| Optimisation | **OR-Tools** | VRP / team orienteering |
| Graphs | **NetworkX** | Cascade graph, reachability propagation |
| ASR | **faster-whisper** | CPU-viable multilingual transcription |
| Embeddings | **sentence-transformers** (`all-MiniLM-L6-v2`) | Small, fast, good enough for near-duplicate detection |
| LLM extraction | Claude / local model with a **fixed narrow JSON schema** | Narrow task = reliable. Never let the LLM decide severity — it extracts, the Bayesian engine decides |
| Frontend | **React + MapLibre GL + Tailwind**, PWA with service worker | Offline-first; no map API token |
| Tiles | **OSM MBTiles** served locally | Works with the network cable pulled |
| SMS | **RapidPro** (or Gammu + a USB modem in the demo) | Degradation Level 3 |
| Export | **CAP 1.2**, GeoJSON, ArcGIS/QGIS layer | Standards compliance = adoption argument |
| Print | Server-rendered HTML → PDF | Degradation Level 1 |

**Architectural rule:** the LLM extracts and structures. **It never assigns severity.** Severity comes
from the Bayesian engine so that it is explainable, calibrated, and auditable. Say this out loud in
the pitch — it pre-empts the "you just wrapped GPT" critique.

---

## 13. Sprint plan & team split

**48-hour plan. For a 36-hour event, compress sprints 1–2 and cut F1 first.**

| Sprint | Hours | Deliverable | Milestone (must be demoable) |
|---|---|---|---|
| **S1** | 0–8 | Schema; one real district loaded (~200 villages) with Census, DEM, WorldPop, Open Buildings; physics prior computed | **Every village has a severity number and a rank with ZERO reports ingested.** This alone beats the room |
| **S2** | 8–18 | Whisper + LLM extractor + gazetteer; dedupe; trust posteriors; IODA live API; pre-baked Sentinel-1 rasters; LR tables | **Belief numbers move as the event stream replays** |
| **S3** | 18–26 | Road graph + per-edge `p_passable` + per-asset costing; OR-Tools dispatch plan (**F2**) | **Output is a routed plan with ETAs, not a list** |
| **S4** | 26–34 | Cascade graph + time-lagged propagation + pre-position queue (**F1**) | **"Dhanauri is fine now and won't be in 5 hours"** |
| **S5** | 34–40 | Red-team scenarios; equity audit panel; degradation ladder; printed dispatch sheet (**F3**) | **Attack it live; pull the cable; print** |
| **S6** | 40–48 | Hash-chained audit log; override UI; calibration curve; **rehearse the demo ×5** | Clean 4-minute run |

**Non-negotiable:** if behind at hour 34, **cut F1 (cascade), not F3 (red-team)**. A system that
visibly survives attack beats a system with one more feature.

### Team split (6 people)

| Role | Owns |
|---|---|
| **Belief lead** (strongest engineer) | M2 engine, LR tables, calibration. **Must not be pulled into UI** |
| **Ingest / NLP ×2** | Whisper, LLM extractor, gazetteer, dedupe, trust posteriors |
| **Geo / routing** | PostGIS, DEM, SAR rasters, Valhalla, `p_passable`, cascade graph |
| **Optimisation / backend** | OR-Tools dispatch, VoI queue, FastAPI, audit log |
| **Frontend + pitch** | React/MapLibre UI, evidence receipts, equity panel, printed sheet, slides, rehearsals |

---

## 14. Demo script (4 minutes)

1. **T+0, zero reports, full ranked list already on screen.**
   *"Today this screen is blank for the first six hours. Ours isn't."*
2. **Replay to T+6h, two panels side by side.** Left = rank by report volume (today's method).
   Right = SETU. **Kolang generates 40 messages and falls. Bhimsar goes silent and climbs to #1.**
3. **Click Bhimsar → evidence receipt.** Collapse, not waterlogging → **excavator + medical, not a boat.**
4. **The routed plan.** *"Bhimsar is unreachable by road — Sirsi bridge P(passable) = 0.15.
   River ingress from Kolang ghat, ETA 06:40."*
5. **Pre-position alert (F1).** *"Dhanauri is fine right now and will not be in five hours.
   The road you'd use is closing. Move BOAT-3 now."*
6. **Attack it live (F3a).** Inject 200 false reports on stage → top-10 order shifts by one position.
7. **Equity panel (F3b).** *"Here is how our own system could have failed tribal hamlets — and here
   is the constraint that stops it."*
8. **Pull the network cable. Print the sheet.**

**Closing line:**

> *"Every other system tells you what happened. This one tells you what to do, whether it can be
> done, what happens next — and it keeps telling you after the power goes out."*

---

## 15. Metrics & evaluation

Run on a **held-out real event** with post-hoc ground truth (state DDMA reports, post-event damage
surveys, PDNA documents).

| Metric | Definition | Why it matters |
|---|---|---|
| **Top-k recall @ hour 6 / 12 / 24** | Fraction of the truly-worst *k* settlements in our top *k* | Only argmax-relevant errors matter |
| **Silent-zone recall** | % of severe settlements identified **before any report arrived from them** | The headline number — this is the PS's core failure |
| **Time-to-first-correct-dispatch** | Hours until the worst settlement gets a correctly-typed asset | Operational impact |
| **Asset-hours misallocated** | vs. report-volume baseline | Direct answer to "deployed haphazardly" |
| **Calibration error (ECE)** | Reliability curve deviation | Trustworthiness > accuracy |
| **Robustness under attack** | Top-10 rank displacement under 200 injected false reports | F3a headline |
| **Equity gap** | Dispatch rate for SC/ST-majority & low-connectivity hamlets vs district mean | F3b headline |
| **Asset-type accuracy** | % of dispatches with the correct asset class (boat vs excavator vs medical) | Directly tests the collapse-vs-waterlogging discriminator |

**Baseline to beat:** rank by report volume. It is the real EOC baseline, and it is genuinely terrible
— which is the point.

---

## 16. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Silence has benign causes** (routine power cut, festival, weekend, upstream backhaul failure) | 🔴 High | Nuisance layer: regional outage footprint, holiday calendar, backhaul topology. **Never dispatch above threshold on silence alone** without one corroborating channel. When the model can't separate hypotheses, it says so and raises a VoI task |
| **Correlated channels double-count** | 🟠 | Correlation damping λ, groups declared per evidence row |
| **Telecom/PDS data needs institutional access** | 🟠 | Simulate in demo, disclose openly; aggregated non-personal counts only; GSMA/Airtel pathway cited |
| **Miscalibration destroys trust faster than error** | 🔴 High | Ship the reliability curve in the UI; confidence-gated autonomy |
| **Adversarial / strategic reporting** | 🟠 | Source reliability posteriors + physics-prior consistency check. **Designed-for, not discovered later** — demo it |
| **Equity: silence is uninformative in low-connectivity hamlets** | 🔴 High | Baseline normalisation + VoI bonus + live equity audit panel (F3b) |
| **Gazetteer mismatch** (Bhimsar / Bheemsar / भीमसर) | 🟠 | LGD codes + name variants + rapidfuzz + manual disambiguation queue in the UI |
| **AGPL contamination** from forking Ushahidi/Kobo/RapidPro | 🟡 | Consume over HTTP; adopt schemas not code; vendor MIT-licensed Sahana Eden instead |
| **Maxar Open Data is CC BY-NC** | 🟡 | Fine for a hackathon; flagged for any commercial path |
| **Scope creep into the trap list** | 🔴 High | §3 is a contract. Re-read it at every sprint boundary |
| **Demo depends on live internet** | 🟠 | Everything pre-cached; the offline mode is *itself* a demo feature (F3c) |

---

## 17. Roadmap (mention, do not build)

Twenty seconds on a slide, then move on:

- Continuity from the 24-hour triage into the **7-day PDNA** and the relief/compensation ledger —
  same belief state, later phase
- **Multi-district federation** and state-level EOC rollup
- **Epidemic risk module** (T+72 h cholera/leptospirosis from stagnant water + sanitation loss)
- Integration **into NDEM / Bhuvan** as an upstream decision layer rather than a parallel system
- Formal **NDMA–DoT/NIC MoU** for the live heartbeat channel

---

## 18. References

**Damage assessment & remote sensing**
- Gupta et al., *xBD: A Dataset for Assessing Building Damage from Satellite Imagery* — arXiv:1911.09296
- DIUx-xView, xView2 baseline & deploy — `github.com/DIUx-xView`
- Google Research / WFP **SKAI** — `innovation.wfp.org/project/SKAI`; UN Global Pulse writeup
- NASA JPL **ARIA** Damage Proxy Maps (InSAR coherence change) — `aria.jpl.nasa.gov`
- NASA Applied Sciences, *Global Rapid Damage Mapping System with Spaceborne SAR*
- Copernicus EMS Rapid & Recovery Mapping — `mapping.emergency.copernicus.eu`
- NRSC, *Flood Affected Area Atlas of India (1998–2022)*
- NHESS 25:2455 (2025), *Automated rapid estimation of flood depth using DEM and EOS-04 inundation*
- ICEYE, *Flood Rapid Impact* / *Flood Insights* product documentation

**Fusion, Bayesian inference & uncertainty**
- **DisasterNet**: Causal Bayesian Networks with Normalizing Flows for Cascading Hazards — KDD '23,
  `doi.org/10.1145/3580305.3599807`
- *Bayesian Inference for Uncertainty-Aware Post-Disaster Damage Assessment* — ASCE
- *Multi-class Seismic Building Damage Assessment from InSAR via Variational Causal Bayesian
  Inference* — arXiv:2502.18546
- Probabilistic depth–damage curves for flood-induced building losses — *Natural Hazards* (2019)
- CHARIM handbook §7.2, *Generating physical vulnerability curves*
- *Flood Proofing Low-Income Houses in India* (kutcha/pucca vulnerability) — *Econ. of Disasters &
  Climate Change* (2018)

**Crowdsourcing, verification & crisis NLP**
- Imran et al., **AIDR: Artificial Intelligence for Disaster Response** — WWW '14
- **TREC Incident Streams** track — e.g. arXiv:2112.03737
- *Crowdsourcing Crisis Information in Disaster-Affected Haiti* — PreventionWeb
- *Emergency Incident Detection from Crowdsourced Waze Data using Bayesian Information Fusion* —
  arXiv:2011.05440
- *Joint Source Selection and Data Extrapolation in Social Sensing* — arXiv:1512.00500
- *On the Interplay of Data and Cognitive Bias in Crisis Information Management* — *Inf. Syst.
  Frontiers* (2022)

**Silence / connectivity as signal (prior art — know it cold)**
- Maas et al., **Facebook Disaster Maps: Aggregate Insights for Crisis Response & Recovery** —
  KDD '19, `doi.org/10.1145/3292500.3340412`
- Wilson et al., *Rapid and Near Real-Time Assessments of Population Displacement Using Mobile Phone
  Data: 2015 Nepal Earthquake* — PMC4779046
- Flowminder, *Mobile Data for Humanitarian Operations: Haiti Earthquake 2010*
- **CAIDA / Georgia Tech IODA** — Internet Outage Detection and Analysis, `caida.org/projects/ioda/`
- **ITU / ETC Disaster Connectivity Map** — `dcm.itu.int`
- CRS Report R48776, *Cellular Network Outage Reporting and Restoration During Disasters*

**Allocation, routing & VoI**
- Yucesoy et al., *The role of drones in disaster response: a literature review of OR applications* —
  *Intl. Trans. in OR* (2025)
- *A Unified Model for Multi-Task Drone Routing in Post-Disaster Road Assessment* — arXiv:2510.21525
- *Recent Advances in Disaster Emergency Response Planning: Optimization, ML, and Simulation* —
  arXiv:2505.03979

**Agents & benchmarks**
- **DORA**: *Can LLM Agents Respond to Disasters? Benchmarking Heterogeneous Geospatial Reasoning in
  Emergency Operations* — arXiv:2605.11633

**India context**
- NRSC **NDEM** — `nrsc.gov.in/nrscnew/Apps_DMS_overview.php`
- ISRO **Bhuvan** — `bhuvan.nrsc.gov.in`
- NDMA **SACHET**, **Aapda Mitra** — `ndma.gov.in`
- **SEEDS + Microsoft "Sunny Lives"** AI for Humanitarian Action — `seedsindia.org`
- **GSMA Big Data for Social Good** (incl. Bharti Airtel) — `gsma.com`

---

## 19. Open TODOs to verify

Before submission, one person owns this checklist:

- [ ] **Verify every licence in §8** against the actual `LICENSE` file in each repo — do not cite from memory
- [ ] Confirm `github.com/google-research/skai` exists, its licence, and whether it is runnable or inference-only
- [ ] Confirm CAIDA/GaTech **IODA API** terms of use and rate limits; get a working query for the demo district
- [ ] Confirm **Meta Data for Good** HDX dataset licence terms for the chosen event
- [ ] Confirm **Maxar/Vantor Open Data** CC BY-NC applies to the chosen event's activation
- [ ] Confirm **Bhuvan CartoDEM** access/registration and redistribution terms; have Copernicus DEM as fallback
- [ ] Pull **LGD village codes** for the demo district and build the name-variant table
- [ ] Source **Census housing tables (HH-series)** for kutcha/pucca fractions at village level
- [ ] Locate post-hoc **ground truth** for the chosen event (DDMA reports / PDNA) — without it there is no metric
- [ ] Fit initial likelihood ratios and the correlation damping λ on at least one held-out event
- [ ] Decide whether we ship **CAP 1.2** export in v1 (recommended: yes, it is cheap and it is an adoption argument)
- [ ] Confirm OSM **ODbL** share-alike implications for any derived data we publish

---

## 20. The 3D front end — "The District Twin"

**Decision:** the 3D simulation is **SETU's front end**, not a separate product. It renders what the
belief engine inferred. One clock drives both the 3D scene and the dispatch queue — that is what makes
it a front end rather than a toy sitting beside the real thing.

### 20.1 Scope decisions

| Question | Decision |
|---|---|
| Geography | **India → one district in depth.** National map for orientation; full 3D buildings + terrain + hazard data for **1 district** (3 max) |
| Data driver | **Real past event replay**, tied to the same replay clock as the dispatch panel |
| Hazards | **All major Indian hazards** — via one generic interface (§20.3), not five bespoke builds |
| Renderer | **MapLibre GL JS only.** No Three.js, no Cesium, no game engine |
| Backend | **None.** Reads precomputed artefacts; runs offline |

### 20.2 Interaction flow

```
1. INDIA          flat 2D, states shaded by hazard exposure
2. click state -> districts
3. click district -> easeTo({pitch: 60, zoom: 14}) + terrain on
                     + fill-extrusion-height animates 0 -> real height (~800 ms)
4. TIMELINE       one scrubber drives BOTH the 3D scene and the dispatch queue
5. click building/settlement -> evidence receipt (same panel as §M4)
```

**The shared timeline is the whole point.** Scrub to T+06:12 and the water is at the depth the belief
engine inferred at T+06:12, the buildings are coloured by the fragility state that produced
`P(collapse) = 0.89`, and the dispatch queue beside it says `EXC+MED`. The visualisation *is* the
model's output, not an illustration of it.

### 20.3 The unified damage pipeline — one interface, five implementations

```
hazard intensity raster  ->  per-building intensity  ->  fragility curve  ->  damage state  ->  render
```

Only the **first step** differs per hazard. Rendering, fragility and colouring are shared.

| Hazard | Intensity metric | Computed as | Visual treatment |
|---|---|---|---|
| **Flood** | depth (m) | **Bathtub fill**: `WSE − DEM` (see §20.4) | translucent blue volume rises and follows terrain; buildings submerge and redden |
| **Earthquake** | PGA (g) | attenuation from epicentre + magnitude (simplified GMPE) | 2 s camera shake; damage colour; **collapsed = height × 0.4** |
| **Landslide** | runout / impact | slope + susceptibility, runout path traced down the DEM | brown debris polygon flows downslope; buildings in path destroyed |
| **Cyclone** | wind speed (m/s) + surge depth | radial wind profile from track; surge reuses the flood layer | roof-loss colouring; surge = flood volume |
| **Urban fire** | burn state | spread over a building-adjacency graph | orange propagation across footprints over time |

**Cost:** the first hazard costs ~2 days (it builds the shared pipeline). Each additional hazard is
roughly **half a day**, because it only contributes an intensity function.

> This is the answer to "all hazards without exploding scope." Do **not** build five renderers.

### 20.4 The one design decision that matters — bathtub fill, not a flat plane

A flat blue plane reads as a graphic. **Bathtub fill reads as real.**

```
Flood layer = a SECOND fill-extrusion layer
    fill-extrusion-base   = ground elevation (from DEM)
    fill-extrusion-height = water surface elevation (WSE)
    hidden where WSE < ground
```

Same amount of code — a data-driven expression instead of a constant — but the water then pours into
valleys, leaves ridges dry, and creeps up streets unevenly.

**And it closes the loop:** it produces a genuine per-building submersion depth, which feeds the same
kutcha/pucca depth–damage curve from §7.1. The visualisation and the model become one thing.

### 20.5 Data sources for the twin

| Layer | Source | Notes |
|---|---|---|
| **Building footprints** | **Google Open Buildings v3** | Excellent India coverage |
| **Building heights** | **Google Open Buildings 2.5D Temporal** | Per-building height, ~4 m effective resolution, **MAE ≈ 1.5 m** (< one storey). Available via Earth Engine |
| **India-packaged alternative** | **GOBS — Geospatial Open Building Stack**, `gobs.aeee.in` | Already combines Open Buildings v3 footprints + 2.5D heights for India. Check this first — it may remove the GEE export step entirely |
| Building heights (fallback) | **Overture Maps** buildings theme | 780M+ footprints; height parsed from OSM tags — sparser in India than Open Buildings |
| Terrain | **Copernicus DEM 30 m** → terrain-RGB tiles → `map.setTerrain()` | CartoDEM as alternative |
| Basemap | **Protomaps** basemap PMTiles | Single file, offline |
| Hazard rasters | Per §9 — Sentinel-1 water extent, modelled depth, landslide runout | Precomputed per timestep |

### 20.6 Build stack

| Component | Choice | Licence |
|---|---|---|
| Renderer | **MapLibre GL JS** | BSD-3 |
| Tiles | **PMTiles** (`protomaps/PMTiles`) — single file, static hosting, HTTP range requests, **works offline** | BSD-3 |
| Tile generation | **tippecanoe** (≥ 2.17 emits PMTiles directly) | BSD-2 |
| Raster prep | GDAL | MIT |
| Terrain | `map.setTerrain()` with terrain-RGB | — |

**Total: ~3 days for one person, no backend, ~500–700 lines of JS.**

### 20.7 Performance rules (non-negotiable)

1. **Precompute damage state per building per timestep, offline.** Ship it as a compact typed array
   keyed by building ID. **The browser never runs a fragility curve.** It looks up a value and sets a
   colour. This is what keeps it at 60 fps.
2. **Zoom-gate the buildings.** All of India cannot render. Load only the selected district's PMTiles.
3. **Cap ~150k buildings in view**; use tippecanoe feature-dropping at low zoom.
4. **No network calls at demo time.** PMTiles files sit on local disk.

### 20.8 Data prep pipeline (offline, one script)

```
scripts/build_twin.py
  1. GEE: export Open Buildings v3 footprints + 2.5D heights for the district  -> GeoJSON
     (or download the GOBS package directly and skip this step)
  2. tippecanoe -> buildings.pmtiles
  3. Copernicus DEM -> gdaldem / rio-rgbify -> terrain.pmtiles
  4. For each replay timestep t:
       compute per-building hazard intensity
       apply fragility -> damage_state
  5. pack -> twin_states.bin  (building_id x timestep -> uint8 damage state)
```

### 20.9 Honest constraints — state these before a judge finds them

| Constraint | The honest framing |
|---|---|
| **"Exact" buildings** | Footprints are real; **heights are ML-estimated (±1.5 m)**. Block-level realistic, not photoreal per building |
| **Buildings look flat at true scale** | Real Indian residential stock is 6–15 m tall, not the 30–40 m it feels like it should be. Use **vertical exaggeration ×2.5, labelled on screen.** Standard dataviz practice; say it out loud |
| **Bathtub fill is not hydraulics** | *"This renders the inundation depth our model infers. It is not a hydrodynamic solver."* Real physics means ANUGA or LISFLOOD-FP — days of mesh setup and it will not run in a browser. The stated framing is completely defensible; claiming otherwise is not |
| **Earthquake "cracking open"** | Not feasible in MapLibre and not worth a 3D engine. **Collapse reads better anyway**: height × 0.4 + damage colour + debris footprint. Cheaper and more legible than cracks |
| **Not every hazard has a real event in one district** | **Label the mode on screen: `REPLAY` vs `SCENARIO`.** Replay where real ground truth exists (Wayanad 2024 = flood + landslide); Scenario for hazards that did not occur there. Distinguishing them rigorously is a credibility gain, not a weakness |

### 20.10 District selection

| Candidate | Hazards with real ground truth | Fit |
|---|---|---|
| **Wayanad, Kerala — July 2024** | Landslide + flood + debris; remote hamlets; severed routes | ⭐ **Primary.** Matches the PS almost line for line |
| **Sikkim GLOF — Oct 2023** | Dam break + flood + landslide | Best for the F1 cascade story |
| Kerala floods — Aug 2018 | Flood | Best data availability |

Earthquake, cyclone and fire run in **`SCENARIO`** mode on the same district.

### 20.11 Sprint impact

Insert as a parallel track owned by the frontend engineer. **Order matters:**

| Step | Hours | Output |
|---|---|---|
| T1 | 0–6 | India → district drill-down; buildings extrude on click |
| T2 | 6–12 | Terrain + **bathtub flood layer with a working WSE slider** |
| T3 | 12–18 | Damage colouring wired to the belief engine's fragility output |
| T4 | 18–24 | **Shared timeline** with the dispatch panel — this is the step that makes it a front end |
| T5 | 24–30 | Earthquake + landslide intensity functions |
| T6 | 30+ | Cyclone + fire, if time remains |

**If behind: cut hazards (T5/T6), never cut T4.** A twin that shares the clock with the decision engine
is the product. A twin with five hazards and no linkage is a screensaver.

---

*Rule of the build: if a feature does not change which asset goes where, it does not ship.*
