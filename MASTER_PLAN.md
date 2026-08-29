# SETU — Master Plan

**Severity Estimation & Triage under Uncertainty**
Problem Statement 5 — *The Post-Disaster Information Fog*

> **This file is self-contained.** Any model or engineer handed only this file has everything needed
> to understand the project, make correct decisions, and build it. Companion files
> (`plan.md`, `BACKEND.md`, `INGEST.md`, `DESIGN.md`) expand individual sections but are not required.
>
> **Version:** 1.0 · Supersedes conflicting details in companion files.

---

# PART 0 — OPERATING DIRECTIVES FOR ANY MODEL READING THIS

Read this part before doing anything. It governs every decision.

## 0.1 Prime directive: reuse before build

> **Before writing any non-trivial component, search for an existing, proven, open-source
> implementation and use it.** Write original code only for the ~500 lines listed in §0.3.

**Decision procedure whenever you are about to build something:**

1. Check the **Open Source Registry (§7)**. If it is listed, use the listed project.
2. If not listed, search GitHub / PyPI / npm for a maintained project with a permissive or
   GPL-compatible licence. Prefer: >500 stars, commits in the last 12 months, real documentation.
3. If a domain-specific scientific tool exists (Deltares, ETH, NASA, SERVIR, AI4Bharat, HOT, Google
   Research), **prefer it over a generic library** — it encodes validated domain knowledge you cannot
   reproduce in a hackathon.
4. Only if none of the above applies, write it — and write the minimum that works.
5. **Record what you chose and why** by appending to §7. Keep the registry current.

**Reuse modes** — pick the lightest that works:

| Mode | Meaning | When |
|---|---|---|
| `consume-output` | Run the tool, ingest its files | Heaviest tools (SKAI, RA2CE, CLIMADA) |
| `import` | `pip install` and call it | Libraries |
| `vendor-schema` | Copy their data model, not their code | Ushahidi, Sahana Eden |
| `read-for-reference` | Read the design, write your own | AIDR, FMTM |
| `fork` | Clone and modify | **Almost never. Requires justification.** |

## 0.2 Non-negotiables

These are decided. Do not relitigate them.

| # | Rule |
|---|---|
| 1 | **Software only.** No hardware. No mesh nodes, no LoRa, no drones to build. |
| 2 | **The demo runs fully offline.** Zero outbound network calls at runtime. Verify by pulling the cable. |
| 3 | **The LLM extracts and structures. It NEVER assigns severity.** Severity comes from the Bayesian engine so it stays explainable, calibrated and auditable. |
| 4 | **If a feature does not change which asset goes where, it does not ship.** |
| 5 | **Licence is GPL-3.** CLIMADA and RA2CE already force this. Stop optimising around it; for a government hackathon copyleft is a positive. |
| 6 | **Dark theme only.** One accent colour. See §12. |
| 7 | **`core/` imports nothing from `engine/`.** Pure functions over arrays. |
| 8 | **Never guess a location.** Below 0.5 geocode confidence → disambiguation queue. |
| 9 | **Never destroy the original.** Raw text, audio and language survive every transformation. |
| 10 | **Every number rendered in the UI uses `tabular-nums`.** No exceptions. |
| 11 | **Disclose simulated data on screen and on stage.** `provenance` is a required field. |
| 12 | **Always demoable.** At the end of every work block the system must run end to end. |

## 0.3 The only original code in this project (~500 lines)

Everything else is integration. If you find yourself writing something not on this list, stop and
re-read §0.1.

```
core/belief.py        ~200   log-odds fusion, correlation damping, spatial smoothing
core/likelihoods.py    ~80   LR tables per channel          ← the actual IP
core/silence.py        ~60   heartbeat deviation → LR
core/trust.py          ~40   Beta reliability posteriors
core/dedupe.py         ~60   rumour-cascade collapse (glue over datasketch/ST/imagededup)
core/voi.py            ~70   verification ranking by expected decision change
core/dispatch.py       ~90   expected harm → asset-typed queue (wraps OR-Tools)
core/cascade.py        ~60   time-lagged downstream propagation
```

**This ratio is itself a pitch line:** *"We did not rebuild catastrophe modelling, road-network
resilience, SAR flood mapping or damage classification. Deltares, ETH Zurich, SERVIR and Google
already did those properly. We wrote the 500 lines none of them wrote — the part that turns four
separate layers into one decision."*

## 0.4 How to resolve ambiguity

| Situation | Do this |
|---|---|
| Two valid technical approaches | Pick the one that is demoable sooner. |
| A feature would take >4 h and isn't on the critical path (§16) | Cut it, note it in the roadmap slide. |
| Real data unavailable | Simulate it, set `provenance: "synthetic"`, and disclose. Never silently fake. |
| A model/library is too large for offline | Use the distilled/small variant. See §9.7. |
| Spec here conflicts with a companion file | **This file wins.** |
| Genuinely blocked on a product decision | Implement the simplest version, flag it in code with `# DECISION:`, move on. |

## 0.5 Definition of done for any task

- [ ] It runs offline
- [ ] It appears in the UI or in a metric (no invisible work)
- [ ] It has a golden-test assertion or is covered by the replay test
- [ ] It degrades gracefully when its input is missing
- [ ] Any new dependency is added to §7 with its licence

---

# PART 1 — THE PROBLEM

## 1.1 Problem statement (verbatim)

> **The Post-Disaster Information Fog.** In the critical first 24 hours following a widespread
> multi-hazard event across multiple administrative blocks, the district administration is inundated
> with fragmented, contradictory, and unverified ground reports via word-of-mouth, satellite phone
> fragments, and social media panic. Because interior routes are severed, field verification teams
> cannot physically reach remote settlements. The emergency operations center faces a severe
> information bottleneck: they cannot objectively assess the true scale of destruction across
> different neighborhoods or determine which villages have suffered total collapse versus minor
> waterlogging. As a result, scarce search-and-rescue assets (inflatable boats, heavy excavators, and
> medical teams) are deployed haphazardly, leaving high-mortality zones unassisted.

## 1.2 Decomposition — four requirements, four modules

| PS clause | Requirement | Module |
|---|---|---|
| "fragmented, contradictory, unverified reports… word-of-mouth, satellite phone fragments, social media panic" | Absorb messy multi-channel input; collapse duplicated rumour; weight sources by trust | **M1 Ingest & Truth-Weighting** |
| "cannot objectively assess the true scale… total collapse versus minor waterlogging" | Objective per-settlement severity, **with a type and a confidence** | **M2 Belief Engine** |
| "field verification teams cannot physically reach remote settlements" | Evidence via non-physical channels; spend scarce remote checks optimally | **M3 Verification Queue (VoI)** |
| "scarce assets (boats, excavators, medical teams) deployed haphazardly" | Asset-typed, ordered, routed, executable dispatch plan | **M4 Dispatch** |

## 1.3 The two insights the whole product rests on

### Insight 1 — The information paradox

> **A settlement that is totally destroyed produces zero reports.**

Report volume is *anti-correlated* with severity in exactly the cases that matter most. Every
report-driven system (Ushahidi, social dashboards, the control-room phone) therefore systematically
**inverts** the priority order. Fixing that inversion is the core of SETU.

### Insight 2 — Severity is not a scalar

The PS names **three** assets. That is not decoration: they answer **three different failure modes**,
and the failure mode selects the asset. Output is `(failure_type, magnitude, confidence)`.

| Failure mode | Multi-channel signature | Asset |
|---|---|---|
| **INUNDATION** | SAR backscatter drop; InSAR coherence **preserved**; telecom decays **gradually** over 4–8 h (tower batteries); reports **abundant**; flat terrain; slow onset | 🛶 Inflatable boats |
| **COLLAPSE** | InSAR coherence **lost**; telecom **hard zero at the event timestamp**; power feeder dead; reports **absent**; steep slope / high stream power; sudden onset | 🚜 Heavy excavators |
| **CASUALTY** | population × severity × hours-elapsed × elderly fraction; PHC reachability; survival-decay curve | 🏥 Medical teams |

> **Waterlogging is loud and structurally quiet. Collapse is structurally loud and communicatively
> silent.** They call opposite assets. Today both get whatever vehicle is nearest.

That table simultaneously answers *"total collapse versus minor waterlogging"* and *"deployed
haphazardly."*

---

# PART 2 — THE SOLUTION

## 2.1 One paragraph

SETU maintains **one row per settlement holding a probability distribution over failure modes**.
Every arriving signal — a phone call, a satellite pass, a *silence* — is a likelihood ratio that moves
that distribution. Everything else in the system either writes to that table or reads from it. Output
is not a map: it is a ranked, asset-typed, routed, auditable dispatch order, with an evidence receipt
per line and a calibrated confidence.

## 2.2 Five defining properties

1. **Defined from t = 0.** A physics prior gives every settlement a number **before any report
   arrives**. No cold start, no blank screen for the first six hours.
2. **Silence is evidence, not missing data.** Absence of an expected heartbeat is a likelihood term.
3. **Contradiction is routed, not averaged.** Conflict raises variance → raises Value-of-Information →
   sends the next verification there.
4. **Output is a plan, not a map.** Asset-typed, routed, time-ordered.
5. **Calibrated and auditable.** When it says 0.7 it is right ~70% of the time, and the DM can prove
   what the system knew at 03:12 and why.

## 2.3 Positioning (use these exact lines)

> **Every existing system produces a layer. None produces a decision.**
> SETU consumes their outputs — which means we get *better* as SKAI and ICEYE improve, and we are
> complementary rather than competitive.

On silence — say it **correctly**, because the honest version is stronger:

> "Connectivity-as-a-signal isn't new; Meta and Flowminder proved it. But it ships at 2.4–4.9 km tiles
> with 8-hour aggregation and a young-user sampling bias, delivered as *a separate map*. We take it to
> the settlement, fuse it with PDS and feeder telemetry, and — critically — **feed it into a decision
> instead of a layer.** The novelty is not the signal. It's that the signal changes where the boat goes."

## 2.4 Non-goals — the trap list

**Do not build any of these.** Each is off the fog→decision axis and each is in every hackathon room.

Citizen SOS app · general chatbot · preparedness/awareness portal · blockchain relief tokens ·
any hardware · "predict the disaster before it happens" · social-media sentiment dashboard ·
missing-persons face matching · a custom-trained damage CNN · a general GIS platform.

---

# PART 3 — SYSTEM ARCHITECTURE

## 3.1 Three programs

> **The single most important structural idea in this project.**

| | **THE FORGE** | **THE ENGINE** | **THE TWIN** |
|---|---|---|---|
| What | Offline data pipeline | Runtime service | 3D front end |
| When | Before the event | During | During |
| Duration | Minutes–hours | <50 ms/tick | 60 fps |
| Network | Heavy | **Never** | **Never** |
| Output | Files | Rows + SSE | Pixels |
| Language | Python scripts | Python (FastAPI) | TypeScript (MapLibre) |
| If it breaks | Rerun it | You're on stage | You're on stage |

Compiling vs. running. **Everything expensive happens in the Forge**, so nothing expensive happens at
demo time. That is what makes SETU fast, offline-capable and reliable.

## 3.2 Full data flow

```
════════════════ THE FORGE (offline) ════════════════

 Census · LGD · Copernicus DEM · Google Open Buildings 2.5D · OSM
 Sentinel-1 · IMD/GPM · CWC · IODA · Meta D4G · Maxar Open Data
                          │
        ┌─────────────────┴──────────────────┐
        │ GDAL · OSMnx · CLIMADA · Delft-FIAT │
        │ RA2CE · HYDRAFloods · SKAI          │
        │ tippecanoe · rio-rgbify             │
        └─────────────────┬──────────────────┘
                          ▼
              district_package/  (~2 GB, fits a USB stick)
   settlements.gpkg · buildings.gpkg · roads.gpkg · cascade.gpkg
   priors.parquet · terrain/*.tif · hazard/**/*.tif
   passability/t*.parquet · tiles/*.pmtiles · twin_states.bin
   events.jsonl
                          │ load once
════════════════ THE ENGINE (online) ═════════════════
                          ▼
  events ──► ① CLOCK ──► ② INGEST ──► ③ BELIEF ──► ④ CASCADE
                                          │             │
                                          └──► ⑤ DECIDE ◄┘
                                                  │
                                          ⑥ PUBLISH: Postgres + SSE
                          │
════════════════ THE TWIN (browser) ══════════════════
                          ▼
   MapLibre GL JS · PMTiles · fill-extrusion buildings + water
   shared timeline ⟷ dispatch panel ⟷ evidence receipt
```

## 3.3 The three kinds of data

Every table is exactly one. This tells you who writes it and when.

| Kind | Written by | Examples |
|---|---|---|
| **STATIC** | The Forge, once per district | `settlement`, `building`, `road_edge`, `cascade_edge`, `infrastructure` |
| **STREAMING** | The Engine, continuously | `claim`, `evidence`, `belief`, `belief_checkpoint`, `source` |
| **DECISION** | The Engine, per tick | `task`, `verification_task`, `decision_log`, `override` |

**The Engine never writes STATIC. The Forge never writes the other two.**

---

# PART 4 — THE CORE ALGORITHM

This section is complete enough to implement without further questions.

## 4.1 State

For each settlement *i* and failure mode *m* ∈ {INUNDATION, COLLAPSE, CASUALTY, LANDSLIDE, WIND}:

```python
log_odds[i][m] : float      # the ONE number. everything reads or writes this.
variance[i][m] : float      # dispersion → drives VoI
```

`P = sigmoid(log_odds)`. Work in log-odds because Bayesian updating becomes addition.

## 4.2 Physics prior (t = 0, zero reports)

```
hazard intensity  : rainfall (IMD/GPM) + discharge (CWC) + DEM/HAND → inundation depth
                    slope + soil + antecedent moisture → landslide susceptibility
vulnerability     : pct_kutcha / pct_pucca (Census HH-series); plinth; storeys
exposure          : population (Census/WorldPop), time-of-day occupancy, elderly fraction
fragility curve   : (intensity, building class) → P(damage state)
```

```python
log_odds[i][COLLAPSE]   = logit(fragility(depth_i, pct_kutcha_i))
log_odds[i][INUNDATION] = logit(inundation_prob(depth_i, hand_i))
```

**Implementation: use CLIMADA or Delft-FIAT impact functions. Do not write your own curves.**

Seed depth–damage thresholds if you must bootstrap (illustrative — replace with library curves):

| Building class | Minor | Moderate | Severe | Collapse |
|---|---|---|---|---|
| Kutcha (mud/thatch) | 0.3 m | 0.8 m | 1.5 m | 2.2 m |
| Semi-pucca | 0.5 m | 1.2 m | 2.2 m | 3.2 m |
| Pucca (brick/RCC) | 0.8 m | 1.8 m | 3.2 m | 4.5 m |

## 4.3 Evidence update — one line is the engine

```
LR = P(evidence | mode) / P(evidence | ¬mode)
log_odds[i][m] += log(LR)
```

## 4.4 Likelihood ratio tables — **the actual IP**

`core/likelihoods.py`. **These are seed values. Fit them on held-out replay events. The golden test
locks whatever you fit.**

### Channel: `telecom_silence`

`ratio = observed_attaches / expected_baseline`, evaluated over a 3 h window.
Note how the *shape* of the decline discriminates collapse from inundation.

| Band | Condition | LR·COLLAPSE | LR·INUNDATION |
|---|---|---|---|
| A · hard zero | `ratio < 0.05` within 15 min of event, sustained >2 h | **5.30** | 1.80 |
| B · gradual decay | `ratio` falls 1.0 → <0.3 over 4–8 h (battery drain) | 1.20 | **3.10** |
| C · degraded | `ratio` 0.3–0.7 | 1.40 | 1.60 |
| D · normal | `ratio > 0.7` | **0.13** | **0.35** |

> Band D is critical: **normality is evidence too.** A village that can still talk and is not
> complaining is genuinely informative.

**Confounder guard.** Never let silence alone push a settlement above the dispatch threshold without
one corroborating channel. Subtract regional outage footprint (IODA), holiday calendar, and known
backhaul failures before computing `ratio`.

### Channel: `sar`

| Condition | LR·COLLAPSE | LR·INUNDATION |
|---|---|---|
| Coherence loss > 0.5 of footprint | **3.50** | 1.00 |
| Coherence preserved + backscatter drop > 3 dB | **0.40** | **4.20** |
| Coherence preserved, no backscatter change | 0.55 | 0.30 |
| Pass unusable (cloud / decorrelated farmland) | **1.00** | **1.00** ← contributes nothing |

> The last row is the design principle: **a dead sensor degrades to LR = 1. It never lies.**

### Channel: `power_feeder`

| Condition | LR·COLLAPSE | LR·INUNDATION |
|---|---|---|
| Feeder dead instantly, restoration attempts fail | 2.80 | 1.60 |
| Feeder tripped, restorable | 1.10 | 1.90 |
| Feeder normal | 0.45 | 0.60 |

### Channel: `human_report`

A clean formula with the right limiting behaviour — **reliability 0 ⇒ LR = 1 ⇒ no effect**:

```python
STRENGTH = {"catastrophic": 6.0, "severe": 3.0, "moderate": 1.5,
            "minor": 0.7, "none": 0.4, "unknown": 1.0}

def lr_human(hint, reliability, independent_sources, is_firsthand):
    s = STRENGTH[hint]
    w = reliability * (1.0 if is_firsthand else 0.6)
    w *= min(1.0 + 0.35 * math.log(max(independent_sources, 1)), 2.0)
    return 1.0 + (s - 1.0) * w
```

### Channel: `verification_return`

A confirmed remote check is the strongest single signal available.

| Result | LR |
|---|---|
| Confirmed severe by trained observer | 12.0 |
| Confirmed intact | 0.08 |
| Inconclusive | 1.0 |

## 4.5 Correlation damping

Channels within a group share a cause and must not double-count. Damping is **per group**;
across groups, full weight.

```python
DAMPING = {
    "human_report":   0.40,   # reports are the most correlated with each other
    "telemetry":      0.65,   # telecom, power, PDS share infrastructure
    "remote_sensing": 0.70,   # SAR, optical share the same pass
    "verification":   1.00,   # independent by construction
}

posterior = prior + sum(DAMPING[g] * sum(log_lr for e in group_g) for g in groups)
```

> Supersedes the single global λ formulation in `plan.md` §7.3.

## 4.6 Spatial smoothing

Damage is spatially autocorrelated. An isolated "severe" surrounded by intact villages deserves
scepticism.

```python
log_odds = (1 - α) * log_odds + α * (W @ log_odds)      # α = 0.15
```
`W` = row-normalised adjacency over settlements within 5 km **and on the same side of any major
hydrological barrier**. Apply once after each update, never iteratively.

## 4.7 Worked example — the demo money shot

**Bhimsar** — the silent one. Prior P = 0.45 → log-odds −0.20.

| Evidence | Group | log LR |
|---|---|---|
| 11 h telecom hard zero vs 380/day baseline | telemetry | +1.67 |
| InSAR coherence lost, 0.71 of footprint | remote_sensing | +1.25 |
| HAM report, embankment breach, reliability 0.80 | human_report | +1.10 |
| Contradicting "all fine", reliability 0.20 | human_report | −0.16 |

```
telemetry      : 0.65 × 1.67          = +1.086
remote_sensing : 0.70 × 1.25          = +0.875
human_report   : 0.40 × (1.10 − 0.16) = +0.376
posterior      = −0.20 + 2.337 = +2.14   →   P(COLLAPSE) = 0.895
```

**Kolang** — the loud one. Prior P = 0.30 → −0.85. 0.6 m water, mostly pucca.

| Evidence | Group | log LR |
|---|---|---|
| Heartbeat **normal** (band D) | telemetry | −2.04 |
| Coherence preserved | remote_sensing | −0.92 |
| 40 messages → 1 root claim, 1 independent source | human_report | +0.69 |

```
posterior = −0.85 + (0.65×−2.04) + (0.70×−0.92) + (0.40×0.69) = −2.54  →  P = 0.073
```

> **Kolang generates 40× more messages and falls to 0.07. Bhimsar sends one fragment, goes silent,
> and climbs to 0.90.** That divergence, watched live on the timeline, is the entire pitch.

## 4.8 Expected harm and ranking

```python
expected_harm[i] = P(severe)[i] × population[i]
                 × mortality_rate(mode, hours_elapsed)
                 × isolation_multiplier(hours_to_reach)
```

Survival decay (illustrative; cite a source or fit it):

| Hours since event | Trapped-survivor mortality multiplier |
|---|---|
| 0–6 | 1.00 |
| 6–12 | 1.35 |
| 12–24 | 1.90 |
| 24–48 | 3.10 |
| 48–72 | 4.80 |

`isolation_multiplier = 1 + 0.6 · log(1 + hours_to_reach / 6)`, capped at 2.5.

## 4.9 Value of Information

```
VoI(a) = E[regret | decide on current belief] − E[regret | decide after a resolves]
```

Practical implementation:

```python
def voi(settlement, action, plan, beliefs):
    p = sigmoid(beliefs[settlement])
    flip = probability_dispatch_changes(settlement, plan, beliefs)   # Monte Carlo, 200 draws
    cost = expected_harm_delta_if_wrong(settlement, plan)
    observability_bonus = 1.0 + 0.8 * (1 - observability[settlement])   # equity, §6.3b
    return flip * cost * observability_bonus / action.minutes
```

- P ≈ 0.9 → dispatch unchanged → VoI ≈ 0. **The system tells you *not* to look.**
- P ≈ 0.5 at the asset cutoff, or high variance from contradiction → VoI high.

## 4.10 Dispatch optimisation

**Objective:** maximise Σ expected lives saved.
**Subject to:** asset inventory; per-asset traversable subgraph; stochastic travel time; survival decay.

```
Solver : OR-Tools VRP (greedy seed + guided local search, 10 s limit)
Nodes  : top-30 by expected harm + pre-position candidates from cascade
Assets : boats, excavators, medical teams  (each with its own graph — see §6.2)
```
**Optimality is not required.** You need to beat "send whatever is nearest."

---

# PART 5 — MODULE SPECS (M1–M4)

## M1 · Ingest & Truth-Weighting

**Everything collapses into one `Observation` envelope and flows through one pipeline.**
Connectors are thin (30–80 lines) and disposable. Full spec: `INGEST.md`.

```
S0 CONNECT   → S1 NORMALISE → S2 TRANSCRIBE → S3 TRANSLATE → S4 CLASSIFY
→ S5 EXTRACT → S6 LOCATE    → S7 DEDUPE     → S8 TRUST     → S9 EMIT EVIDENCE
```

**Machine channels (telecom, power, SAR, IODA) skip S1–S7** and go S0 → S9 via their own likelihood
functions.

### The Observation envelope

```jsonc
{ "obs_id": "obs_0f31c9", "ts": "...", "received_at": "...",
  "channel": "ham", "source_id": "HAM-VU2XYZ", "provenance": "archived",
  "raw": {"text": null, "audio": "blob://a91f.opus", "media": []},
  "text_orig": "बांध टूट गया…", "lang": "hi", "text_en": "embankment breached…",
  "info_type": "infrastructure_damage", "hazard": "flood", "severity_hint": "severe",
  "geo": {"settlement_id": "BH-042", "confidence": 0.82, "surface": "भीमसर",
          "method": "lgd_fuzzy+district_prior"},
  "cascade": {"root_id": "obs_0f31c9", "size": 1, "independent_sources": 1},
  "trust": {"alpha": 8, "beta": 2, "reliability": 0.80},
  "chain": ["connect:ham_dropbox","asr:indicwhisper","mt:indictrans2","geo:lgd_matcher"] }
```

### S6 LOCATE — the hard part, and the trick

India has ~660,000 villages with heavy name reuse. `Bhimsar / Bheemsar / भीमसर` must all resolve.

> **We already know the district.** Candidate set collapses from ~660,000 to ~214.
> **This is why we do NOT need Mordecai3 + Elasticsearch.** A problem that is genuinely hard at
> national scale is easy at district scale.

Chain: **libpostal** (normalise) → **IndicXlit** (native ⇄ Roman) → **LGD + GeoNames** in SQLite FTS5,
district-filtered → **rapidfuzz** token-set → **jellyfish** phonetic backstop.

```python
geo_confidence = 0.55*fuzzy + 0.20*phonetic + 0.15*context_prior + 0.10*source_prior
```
**< 0.5 → disambiguation queue.** Never guess. A wrong geocode sends a boat to the wrong place.

### S7 DEDUPE — rumour-cascade collapse

Four stages, cheapest first: `blake2b` exact → **datasketch** MinHash-LSH (shingles, τ=0.8) →
**sentence-transformers** (`multilingual-e5-small`, catches cross-language paraphrase) →
**imagededup** pHash + video keyframes. Then **union-find** → one cluster per real-world claim.

> **Weight by `independent_sources`, never by `cascade_size`.** Forty forwards from forty phones are
> not forty pieces of evidence — but three *independent first-hand witnesses* genuinely are stronger
> than one. Independence = distinct source × distinct channel × `is_firsthand`.

### S8 TRUST

`Beta(α, β)` per `source_id`, init `Beta(1,1)`. Verification returns → `α += 1` or `β += 1`.
Channel priors seed it. **Persists across events.** Ushahidi does this step by hand.

## M2 · Belief Engine

See PART 4. ~300 lines. Put the strongest engineer here and **do not let them get pulled into UI.**

**Deliberately not deep learning**, for three reasons that are all pitch material:
1. Zero labels exist for *this* event in the first 24 hours.
2. Published damage models drop up to ~30% on unseen disaster events (xBD generalisation results).
3. The DM must see which evidence drove the call. **Explainability is the adoption condition.**

## M3 · Verification Queue

The PS states field teams cannot reach settlements — so verification is remote and tiny:
sat-phone callbacks, HAM queries, a helicopter recon leg, one drone sortie, a call to the block PHC.

```
VERIFY NEXT                              MINS   RESOLVES                 Δ REGRET
1  Sat-phone → Kharsa PHC                   4   BOAT-2 north/south            21
2  HAM net query → Sirsi relay               7   3 settlements, conf <0.4      14
3  Recon leg, Dhanauri corridor             35   pre-position decision          9

NOT RECOMMENDED
   Bhimsar overflight — conf 0.90, dispatch unchanged either way.   Δ 0
```

> Say this aloud once: *"The system will tell you not to look at things. Verification capacity is the
> scarcest asset in the first day."*

## M4 · Dispatch

```
BHIMSAR  (pop 2,140)              COLLAPSE        confidence 0.90
  Dispatch : 1× excavator + 1× medical team       (NOT a boat)
  Expected lives at risk if unassisted 6 h : 40–90
  Why      : 11 h telecom hard-zero vs 380/day baseline
             InSAR coherence lost over settlement footprint
             1× HAM report, embankment breach (reliability 0.80)
             1× contradicting report "all fine" (reliability 0.20, discounted)
  Access   : unreachable by road, Sirsi bridge P(passable) = 0.15
             → river ingress from Kolang ghat, ETA 06:40
  Resolve  : sat-phone callback to PHC, 4 min
```

---

# PART 6 — FLAGSHIP EXTENSIONS (F1–F3)

Build order by dependency: **F2 → F1 → F3.** If time runs out, **cut F1 before F3.**

## F1 · Cascade Engine — anticipatory positioning

The PS says **"multi-hazard event."** The correct reading: **hazards cause each other, with an
exploitable time lag.**

```
cloudburst → landslide → debris dams river → outburst flood           (4–9 h)
embankment breach → downstream inundation propagates village to village (1–3 h)
stagnant water + no sanitation → cholera / leptospirosis              (T+72 h)
```

Second graph over settlements. **Nodes:** settlements + infrastructure (embankments, bridges, check
dams, landslide-dam candidates on steep confined reaches). **Edges:** hydrological downstream, dam →
command area, slope → runout. **Propagation:** upstream belief rise → time-lagged downstream rise.

```
PRE-POSITION — DHANAURI (pop 1,800) — currently intact
  P(severe within 6 h) = 0.61
  Driver : upstream embankment Chainage 14 at 0.80 breach belief; routing lag 4 h 20 m
  Action : move BOAT-3 now, before the Sirsi road closes
```

> **"Open roads are a depreciating asset. Spend them before they are gone."**
> Best line in the pitch. It converts reactive triage into anticipatory positioning, which no
> commercial or open-source system does.

## F2 · Reachability — a ranked list is not a plan

1. Road graph from OSM (**OSMnx** → NetworkX; **Valhalla** for routing).
2. Per-edge `P(passable)`: flood depth over segment, bridge fragility vs discharge, landslide
   susceptibility on the cut slope. **Updated from silence too** — if every settlement beyond node N
   went dark simultaneously, the corridor through N is probably cut.
3. **Different assets traverse different graphs** — this is the key modelling insight:
   - **Boat**: *can* traverse flooded edges a truck cannot; needs a launch point / ghat
   - **Excavator**: heavy; needs bridge load capacity; slowest
   - **Medical (light 4×4)**: fastest on intact road, stopped by shallow water
   - **Helicopter**: ignores the graph; needs an LZ + daylight

   Valhalla is preferred over OSRM precisely because it supports **custom costing models**.
4. Solve with OR-Tools. **Run Deltares RA2CE for the disruption/redundancy analysis** — it already
   does group-disruption and alternative-route identification for area-covering flood/quake events.

```
BOAT-2 | SDRF Team Alpha | depart 04:10
  1. Bhimsar   — ROAD UNREACHABLE (Sirsi bridge P = 0.15)
                 river ingress, Kolang ghat            ETA 06:40
  2. Dhanauri  — pre-position, cascade lead 4 h 20 m   ETA 08:15
  Expected lives saved on this route : 34   (next-best alternative: −11)
```

## F3 · Adversarial & degradation resilience

**Highest leverage item in the plan.** Almost no team demos their own system failing gracefully.

### F3a · Red team — real recompute, never scripted

| Attack | Real-world motive | Response |
|---|---|---|
| **Strategic over-reporting** — a village claims total loss | relief funds, compensation, politics | Reliability posterior + physics prior contradict it; belief barely moves; flagged *"claim inconsistent with hazard model"* |
| **Coordinated misinformation** — 200 messages, fake dam burst | panic, malice, bots | Cascade collapse → **1** low-trust observation |
| **Sensor failure** — SAR 100% cloud/decorrelated | monsoon, vegetation | LR → 1.00, contributes nothing; falls back on remaining channels. **Degrades, does not lie** |

**Ship a number:** *"Under a coordinated 200-message false-report attack, the top-10 dispatch order
changes by 1 position."* Worth more than any UI polish.

### F3b · The equity failure we name before a judge does

The silence channel has a **built-in bias**: a well-connected village going dark screams; a tribal
hamlet with almost no baseline connectivity produces **no detectable change**.

> **Silence-based sensing is systematically weakest for the most marginalised settlements — exactly
> the ones this PS is about.**

Fixes, all implemented:
- **Normalise by baseline strength.** Low-baseline settlements shift weight toward physics prior +
  vulnerability instead of silence.
- **Observability bonus in VoI** (§4.9) — if we cannot infer, we go look.
- **Live equity audit panel** — dispatch rate for SC/ST-majority and low-connectivity hamlets vs
  district mean.

Naming your own system's discriminatory failure mode **and fixing it in the allocator** is the most
mature move available to a student team in a government hackathon.

### F3c · Degradation ladder

| Level | Available | SETU still delivers |
|---|---|---|
| 5 | Full internet | Live multi-channel fusion |
| 4 | Intermittent | Cached tiles, queued sync, local inference |
| 3 | SMS only | RapidPro/Gammu: orders out, verification callbacks in |
| 2 | Voice / HAM only | Duty officer reads the queue over radio |
| 1 | **Power out** | **One-page printed dispatch sheet** — ranked, asset-typed, with evidence receipts |

### F3d · Cheap, high-signal additions

- **Hash-chained audit log.** Indian disasters get judicial inquiries and CAG audits. *"The DM can
  prove what they knew at 03:12 and why"* is an adoption argument no competitor makes.
- **Human-in-command override.** Records the override **and the outcome**, then recalibrates. Frames
  the AI as advisory — the only politically viable framing for a government buyer.
- **Confidence-gated autonomy.** P > 0.8 → recommends. 0.4–0.8 → *demands* verification first.
  P < 0.4 → stays quiet. The system knows the limits of its own competence.
- **Learns across events.** LRs and reliabilities persist. *"Cyclone Remal taught it; Wayanad used it."*
- **Digital-twin drill mode.** Replay past events for EOC training on a blue-sky day. **The adoption
  wedge** — it gets the software installed *before* a disaster, the only way it is ever there *during*.

---

# PART 7 — OPEN SOURCE REGISTRY

> **Consult this before writing anything.** Append new entries as you adopt them.
> ⚠️ **Verify every licence against the repo's `LICENSE` file before submission.**

## 7.1 Scientific engines — the biggest wins

| Purpose | Project | Repo | Licence | Mode | What it saves |
|---|---|---|---|---|---|
| **Physics prior / impact model** | **CLIMADA** (ETH Zurich) | `CLIMADA-project/climada_python` | GPL-3 | `import` | Probabilistic natcat impact framework; global 4×4 km hazard API (river flood, TC, drought); exposure modules. **This is §4.2, already built and validated** |
| **Flood depth–damage** | **Delft-FIAT** (Deltares) | `Deltares/Delft-FIAT` | open | `import` | Fast Impact Assessment Tool: flood maps + depth–damage functions + assets → damage |
| **Road disruption / reachability** | **RA2CE** (Deltares) | `Deltares/ra2ce` | GPL-3 | `import` | Critical-infrastructure network resilience; **group disruption + alternative-route redundancy analysis** for area-covering events. **This is F2, already written** |
| **SAR flood mapping** | **HYDRAFloods** (SERVIR) | `Servir-Mekong/hydra-floods` | open | `consume-output` | Sensor-agnostic surface-water mapping from Sentinel-1 + Landsat on Earth Engine; operational NRT flood detection |
| **Building damage from imagery** | **SKAI** (Google Research + WFP) | `google-research/skai` | **Apache-2.0** | `consume-output` | Matches expert assessments on **85–98%** of buildings. **Consume as a likelihood channel — never compete with it** |
| **Fragility curve library** | **GEM OpenQuake** | `gem/oq-engine` | AGPL-3 | `import` | Reference vulnerability/fragility functions, if CLIMADA's are too coarse |
| **Damage classifier fallback** | **xView2 baseline** | `DIUx-xView/xView2_baseline` | Apache-2.0 *(verify)* | `consume-output` | xBD taxonomy + baseline model. Needs clean optical pre+post; ~30% drop on unseen events |

## 7.2 Geospatial & optimisation

| Purpose | Project | Licence | Mode |
|---|---|---|---|
| Spatial DB | **PostGIS** | GPL-2 | `import` |
| Road graph from OSM | **OSMnx** | MIT | `import` |
| Routing with custom costing | **Valhalla** | MIT | `consume-output` |
| Routing fallback | **OSRM** | BSD-2 | `consume-output` |
| Graphs (cascade, reachability) | **NetworkX** | BSD-3 | `import` |
| VRP / team orienteering | **Google OR-Tools** | Apache-2.0 | `import` |
| Raster I/O | **GDAL / rasterio / rioxarray** | MIT | `import` |
| Vector tiles | **tippecanoe** (≥2.17 emits PMTiles) | BSD-2 | `consume-output` |
| Tile format | **PMTiles** (`protomaps/PMTiles`) | BSD-3 | `import` |
| Terrain-RGB encoding | **rio-rgbify** | MIT | `consume-output` |
| Notebook geo prototyping | **leafmap** | MIT | `import` |

## 7.3 Ingest & NLP

| Purpose | Project | Licence | Mode |
|---|---|---|---|
| ASR | **faster-whisper** | MIT | `import` |
| **Indic ASR** | **AI4Bharat IndicWhisper** | MIT *(verify)* | `import` |
| Voice activity detection | **silero-vad** | MIT | `import` |
| **Indic translation (22 langs)** | **AI4Bharat IndicTrans2** | MIT | `import` |
| **Indic transliteration (21 langs)** | **AI4Bharat IndicXlit** | MIT | `import` |
| Language ID | **fastText `lid.176`** | MIT | `import` |
| Encoding repair | **ftfy** | MIT | `import` |
| Indic normalisation | **indic-nlp-library** | MIT | `import` |
| **Crisis-domain LM** | **CrisisTransformers** (HF) | *verify* | `import` |
| Crisis label taxonomy + data | **HumAID / CrisisNLP / CrisisBench / TREC-IS** | research | `vendor-schema` |
| Constrained JSON generation | **Outlines** | Apache-2.0 | `import` |
| Typed LLM outputs (alt) | **Instructor** | MIT | `import` |
| Classical NER fallback | **spaCy** (+ `stanza`) | MIT / Apache-2.0 | `import` |
| Address normalisation | **libpostal** | MIT | `import` |
| Fuzzy matching | **rapidfuzz** | MIT | `import` |
| Phonetic matching | **jellyfish** | MIT | `import` |
| Near-dup text | **datasketch** (MinHash-LSH) | MIT | `import` |
| Embeddings | **sentence-transformers** (`multilingual-e5-small`) | Apache-2.0 | `import` |
| Image/video dedupe | **imagededup** | Apache-2.0 | `import` |
| Geocoding (structured) | **Nominatim** | GPL-2 | `consume-output` |
| Neural geoparser (national scale only) | **Mordecai3** | MIT | `import` |

## 7.4 Connectors & humanitarian domain

| Purpose | Project | Licence | Mode |
|---|---|---|---|
| Field forms | **ODK Central** | Apache-2.0 | `consume-output` |
| Telegram | **Telethon** | MIT | `import` |
| SMS | **gammu-smsd** | GPL-2 | `consume-output` (separate process) |
| SMS flows (optional, heavy) | **RapidPro** | AGPL-3 | `consume-output` |
| Report data model | **Ushahidi Platform** | AGPL-3 | `vendor-schema` |
| Asset/warehouse/org model | **Sahana Eden** | MIT | `vendor-schema` |
| App structure reference | **HOT Field-TM** | `hotosm/fmtm` · AGPL-3 | `read-for-reference` |
| Impact scenario methodology | **InaSAFE** | GPL-3 | `read-for-reference` |
| Crisis classification design | **AIDR (QCRI)** | paper | `read-for-reference` |
| Alert format | **CAP 1.2 (OASIS)** | standard | `vendor-schema` |
| Humanitarian tabular tagging | **HXL** | standard | `vendor-schema` |

## 7.5 Frontend

| Purpose | Project | Licence |
|---|---|---|
| Map + 3D renderer | **MapLibre GL JS** | BSD-3 |
| Tiles | **PMTiles** | BSD-3 |
| UI framework | **React 18 + Vite + TypeScript** | MIT |
| Styling | **Tailwind CSS** (tokens from §12) | MIT |
| Icons | **Lucide** | ISC |
| Typeface | **Inter** | SIL OFL |
| Mono | **IBM Plex Mono** | SIL OFL |
| Charts (calibration curve) | **visx** or hand-rolled SVG | MIT |

## 7.6 Deliberately NOT used

| Rejected | Why |
|---|---|
| **KoboToolbox** self-hosted | kpi + kobocat + Enketo + Redis + Celery. ODK Central is the same XLSForm in one container |
| **Ushahidi platform** (as code) | PHP/Laravel, 15 years of accretion. Take the schema |
| **Sahana Eden** (as code) | web2py, substantially legacy. Take the schema (MIT, so freely) |
| **Mordecai3 + Elasticsearch** | Excellent nationally; pointless for 214 district candidates |
| **RapidPro / Chatwoot** as a hub | A day of Django/Rails for what five 50-line adapters give you |
| **X/Twitter API** | Paid, rate-limited, unusable offline. Use archived crisis corpora |
| **Unofficial WhatsApp libs** (Baileys) | Ban risk, ToS risk, unreliable on stage. Parse exports |
| **Three.js / CesiumJS** | MapLibre `fill-extrusion` does everything needed. See §11 |
| **A custom-trained classifier** | CrisisTransformers is pretrained on 15B tokens from 30+ real events |
| **Celery / Redis / message broker** | It must run on one laptop. asyncio + a DB table is enough |

## 7.7 Licence position

**SETU ships GPL-3.** CLIMADA and RA2CE already force it. For a government hackathon copyleft is a
positive — it signals the work stays public and adoptable without vendor lock-in. **Stop optimising
around it.** Keep GPL/AGPL tools that must stay separate (gammu-smsd, Nominatim) as external
processes invoked over files or HTTP.

---

# PART 8 — DATA SOURCE REGISTRY

| Layer | Source | Access | Licence note | Demo status |
|---|---|---|---|---|
| Village boundaries + codes | **LGD** `lgdirectory.gov.in` + Census 2011 | download | free | ✅ real |
| Population | **WorldPop**, **GHSL**, Census | download | CC-BY | ✅ real |
| **Vulnerability (kutcha/pucca)** | **Census HH-series housing tables** | download | free | ✅ real |
| **Building footprints** | **Google Open Buildings v3** | download / GEE | CC-BY / ODbL | ✅ real |
| **Building heights** | **Open Buildings 2.5D Temporal** | GEE | CC-BY | ✅ real — **MAE ≈ 1.5 m** |
| **India building package** | **GOBS** `gobs.aeee.in` | download | *verify* | 🔎 **check first — may bundle both above** |
| Building fallback | **Overture Maps** buildings | download | ODbL/CDLA | ✅ real |
| Terrain | **Copernicus DEM 30 m**, SRTM, Bhuvan CartoDEM | download | free (Bhuvan needs registration) | ✅ real |
| Roads | **OpenStreetMap** (Geofabrik) | download | **ODbL — share-alike** ⚠️ | ✅ real |
| Basemap tiles | **Protomaps** basemap | download | BSD | ✅ real |
| Rainfall | **IMD**, **NASA GPM IMERG** | API | free | ✅ real |
| Discharge / flood forecast | **CWC**, **Google Flood Hub API** | API | free | ✅ real |
| SAR | **Sentinel-1** via Copernicus Data Space / GEE | API | free | ✅ real |
| VHR pre/post | **Maxar (Vantor) Open Data** | AWS S3 | **CC BY-NC 4.0** ⚠️ non-commercial | ✅ real |
| Damage products | **SKAI**, **NASA ARIA DPM**, **Copernicus EMS / UNOSAT** | varies | free | ✅ where activated |
| **Connectivity outage** | **CAIDA/GaTech IODA API** | REST | free | ✅ **real and live** |
| Connectivity/power/displacement | **Meta Data for Good** on HDX | download | *verify* | ✅ real (archive) |
| Telecom infra status | **ITU/ETC Disaster Connectivity Map** | portal | — | 🔎 reference |
| Human reports | Archived event + synthesised cascade | — | — | ⚠️ **replayed** |
| **Telecom / PDS / feeder heartbeat** | needs NDMA–DoT / NIC / DISCOM agreement | — | — | ⚠️ **SIMULATED — disclose** |

## 8.1 On the simulated channel — say it before a judge asks

Per-settlement heartbeat (tower attaches, PDS e-POS auths, feeder SCADA, bus GPS, ASHA check-ins) is
**simulated**. Volunteering this earns more than hiding it. The real integration is an
**institutional agreement, not a technical problem**, and the pathway exists: **GSMA's Big Data for
Social Good programme includes Bharti Airtel in India.** We use **aggregated, non-personal counts
only** — never subscriber-level data. That is both privacy-correct and politically viable.

## 8.2 Demo district

| Candidate | Real ground truth for | Fit |
|---|---|---|
| **Wayanad, Kerala — July 2024** | landslide + flood + debris; remote hamlets; severed routes | ⭐ **PRIMARY.** Matches the PS almost line for line |
| Sikkim GLOF — Oct 2023 | dam break + flood + landslide | best for the F1 cascade story |
| Kerala floods — Aug 2018 | flood | best data availability |

Earthquake, cyclone and fire run in **`SCENARIO`** mode on the same district.
**Label `REPLAY` vs `SCENARIO` on screen.** Distinguishing them rigorously is a credibility gain.

---

# PART 9 — THE FORGE (offline pipeline)

Ten stages. Each is a script, each writes a file, each rerunnable independently.
`make forge DISTRICT=wayanad`

| Stage | In | Out | Tools |
|---|---|---|---|
| **F1** Define district | LGD, Census boundaries | `settlements.gpkg` — id, lgd_code, name, **name_variants[]**, geom, block | GeoPandas |
| **F2** Exposure | WorldPop, Open Buildings v3 + 2.5D | population, elderly_frac, pct_sc_st; `buildings.gpkg` (geom, height_m) | GEE / GOBS |
| **F3** Terrain | Copernicus DEM | `dem.tif`, `slope.tif`, **`hand.tif`** | GDAL, pysheds |
| **F4** Vulnerability | Census HH-series | pct_kutcha/pucca, `fragility_class` | pandas |
| **F5** Hazard | rainfall, discharge, Sentinel-1 | `hazard/{hazard}/t000..t144.tif` | HYDRAFloods, GDAL |
| **F6** Physics prior | F2 × F4 × F5 | `priors.parquet` — log-odds at t=0 | **CLIMADA / Delft-FIAT** |
| **F7** Network | OSM + F5 | `roads.gpkg`, `passability/t*.parquet` **per asset class** | OSMnx, **RA2CE** |
| **F8** Cascade graph | DEM flow routing + infra inventory | `cascade.gpkg` (src, dst, lag_minutes, weight) | pysheds, NetworkX |
| **F9** Twin package | F2, F3, F5 | `*.pmtiles`, **`twin_states.bin`** `[building × timestep] uint8` | tippecanoe, rio-rgbify |
| **F10** Event stream | archived reports + synthetic | `events.jsonl` with **`provenance`** on every line | ours |

> **HAND (Height Above Nearest Drainage) is what makes flood modelling cheap.** Depth ≈
> `water_surface_elevation − ground_elevation`, and HAND says how far above the nearest channel each
> point sits.

## 9.1 The district package

```
district_package/wayanad/
├── meta.json                 id, bbox, tz, replay t0/t1, provenance summary
├── settlements.gpkg          STATIC · ~214 rows
├── buildings.gpkg            STATIC · ~180k rows
├── roads.gpkg  cascade.gpkg  STATIC
├── priors.parquet            log-odds at t=0 per settlement × mode
├── terrain/  dem.tif  slope.tif  hand.tif
├── hazard/   flood/ landslide/ quake/ cyclone/ fire/  ×  t000..t144.tif
├── passability/ t000.parquet … t144.parquet
├── tiles/    basemap.pmtiles  terrain.pmtiles  buildings.pmtiles
├── twin_states.bin           [building × timestep] uint8
└── events.jsonl              the replay
```

**Target < 2 GB.** Must fit a USB stick and load in seconds.

## 9.2 `events.jsonl` format

```json
{"t":"2024-07-30T04:20:00+05:30","kind":"report","channel":"ham","source_id":"HAM-VU2XYZ",
 "text":"embankment breached near chainage 14","provenance":"archived"}
{"t":"2024-07-30T04:31:00+05:30","kind":"telemetry","channel":"telecom",
 "settlement_id":"BH-042","observed":0,"expected":380,"provenance":"synthetic"}
{"t":"2024-07-30T04:31:00+05:30","kind":"sar","raster":"hazard/flood/t018.tif",
 "coherence":"hazard/coh/t018.tif","provenance":"archived"}
```

## 9.3 Offline model footprint

| Model | Variant | Size |
|---|---|---|
| faster-whisper | `small` int8 | ~500 MB |
| IndicWhisper | fine-tuned | ~1.5 GB |
| IndicTrans2 | **distilled 200M** (not 1B) | ~800 MB |
| CrisisTransformers | base | ~500 MB |
| Sentence encoder | `multilingual-e5-small` (not LaBSE) | ~470 MB |
| IndicXlit | 11M | ~50 MB |
| fastText lid.176 | compressed | ~1 MB |
| libpostal data | — | **~2 GB** ⚠️ biggest item; droppable |
| spaCy `en_core_web_sm` | — | ~15 MB |

**~4 GB with libpostal, ~2 GB without.** Ship a `models/` dir. **Nothing downloads at runtime.**

---

# PART 10 — THE ENGINE (runtime)

**One FastAPI process. Deliberately a monolith** — no Celery, no Redis, no broker. It must run on one
laptop with no internet.

## 10.1 Six components

```
① CLOCK    replay driver; accelerated sim time; pausable, seekable
② INGEST   asr → extract → geocode → dedupe → trust → Evidence rows
③ BELIEF   log-odds fusion, damping, spatial smoothing        (PART 4)
④ CASCADE  time-lagged downstream propagation                 (F1)
⑤ DECIDE   dispatch (OR-Tools) + VoI queue                    (M3, M4)
⑥ PUBLISH  Postgres write + hash-chained log + SSE push
```

## 10.2 The tick — the entire runtime, in one function

```python
async def tick(t: SimTime):
    events = clock.pop_due(t)

    touched: set[str] = set()
    for e in events:
        for ev in ingest.process(e):          # may emit 0..n Evidence rows
            db.add(ev); touched.add(ev.settlement_id)

    scope   = graph.expand(touched, hops=1)   # + spatial neighbours
    beliefs = belief.update(priors[scope], db.evidence_for(scope),
                            neighbours[scope], DAMPING)
    db.upsert_beliefs(beliefs)

    pre_positions = cascade.propagate(beliefs, t)
    passability   = pkg.passability(t)
    plan   = dispatch.solve(beliefs, pre_positions, assets, passability)
    verify = voi.rank(beliefs, plan, verification_capacity)

    entry = decision_log.append(t, plan, verify, hash_of(beliefs))
    if t % CHECKPOINT_INTERVAL == 0:
        db.write_checkpoint(t, beliefs)

    await sse.push({"t": t, "beliefs": delta(beliefs),
                    "plan": plan, "verify": verify, "log": entry.id})
```

**Budget: < 50 ms per tick.** 214 settlements × 5 modes = ~1,000 floats — a full belief recompute is
*microseconds*. **Do not cache it. Do not optimise it.**

## 10.3 Scrubbing — checkpoints, not precomputation

Checkpoint the belief state every **15 simulated minutes**.

```python
def seek(t):
    c = nearest_checkpoint(t)         # ~1,000 floats
    return replay_forward(c, t)       # ≤ 15 sim-min of evidence, < 30 ms
```

> **Why not precompute every frame?** Because then the red-team injection console would be **fake**.
> Checkpoints give you instant scrubbing **and** genuine live recomputation on injection.

```python
def inject(t, attack):
    state = seek(t)                   # fork from checkpoint
    return run_forward(state, attack.to_events(t))   # REAL recompute
```

## 10.4 Database schema

```sql
-- ═══════════ STATIC (Forge writes, Engine reads) ═══════════
CREATE TABLE settlement (
  id TEXT PRIMARY KEY, lgd_code TEXT, name TEXT, name_variants TEXT[],
  block TEXT, tehsil TEXT, geom GEOMETRY(Point,4326),
  population INT, elderly_frac REAL, pct_sc_st REAL,
  pct_kutcha REAL, pct_pucca REAL, fragility_class TEXT,
  elevation_m REAL, slope_deg REAL, hand_m REAL,
  road_hours_normal REAL, nearest_phc_id TEXT,
  heartbeat_baseline JSONB,        -- expected chatter per hour-of-week
  observability REAL               -- 0..1, drives the equity bonus (§6.3b)
);
CREATE TABLE building (
  id BIGINT PRIMARY KEY, settlement_id TEXT REFERENCES settlement,
  geom GEOMETRY(Polygon,4326), height_m REAL, area_m2 REAL);
CREATE TABLE infrastructure (
  id TEXT PRIMARY KEY, kind TEXT,          -- embankment|bridge|dam|check_dam
  geom GEOMETRY, capacity REAL, fragility_params JSONB);
CREATE TABLE road_edge (
  id BIGINT PRIMARY KEY, u BIGINT, v BIGINT, geom GEOMETRY(LineString,4326),
  bridge_id TEXT, base_minutes REAL, modes TEXT[]);
CREATE TABLE cascade_edge (
  src_node TEXT, dst_node TEXT, lag_minutes INT, transfer_weight REAL);

-- ═══════════ STREAMING (Engine writes) ═══════════
CREATE TABLE source (
  id TEXT PRIMARY KEY, channel TEXT, alpha REAL DEFAULT 1, beta REAL DEFAULT 1);
CREATE TABLE claim (
  id TEXT PRIMARY KEY, source_id TEXT REFERENCES source, settlement_id TEXT,
  geo_confidence REAL, hazard TEXT, claim_text TEXT, text_orig TEXT, lang TEXT,
  severity_hint TEXT, info_type TEXT, is_firsthand BOOL, ts TIMESTAMPTZ,
  cascade_root_id TEXT, cascade_size INT, independent_sources INT, provenance TEXT);
CREATE TABLE evidence (
  id BIGSERIAL PRIMARY KEY, settlement_id TEXT, channel TEXT, failure_mode TEXT,
  log_lr REAL, correlation_group TEXT, ts TIMESTAMPTZ, raw_ref TEXT);
CREATE TABLE belief (
  settlement_id TEXT, failure_mode TEXT, log_odds REAL, variance REAL,
  updated_at TIMESTAMPTZ, PRIMARY KEY (settlement_id, failure_mode));
CREATE TABLE belief_checkpoint (sim_t TIMESTAMPTZ PRIMARY KEY, payload BYTEA);

-- ═══════════ DECISION (Engine writes) ═══════════
CREATE TABLE asset (
  id TEXT PRIMARY KEY, kind TEXT,          -- boat|excavator|medical
  capacity INT, home_node BIGINT, current_node BIGINT, status TEXT);
CREATE TABLE task (
  id BIGSERIAL PRIMARY KEY, settlement_id TEXT, asset_id TEXT, seq INT,
  eta TIMESTAMPTZ, expected_lives_saved REAL, access_mode TEXT, state TEXT);
CREATE TABLE verification_task (
  id BIGSERIAL PRIMARY KEY, settlement_id TEXT, action TEXT, minutes INT,
  voi_score REAL, resolves TEXT, state TEXT);
CREATE TABLE decision_log (
  id BIGSERIAL PRIMARY KEY, sim_t TIMESTAMPTZ, payload JSONB,
  belief_hash TEXT, prev_hash TEXT);
CREATE TABLE override (
  id BIGSERIAL PRIMARY KEY, decision_id BIGINT, actor TEXT,
  reason TEXT, ts TIMESTAMPTZ, outcome TEXT);
```

## 10.5 API surface

```
── READ ─────────────────────────────────────────────────────────
GET  /api/district                    meta, bbox, replay window
GET  /api/settlements                 STATIC rows (client caches forever)
GET  /api/state?t=<sim_t>             beliefs + plan + verify queue
GET  /api/settlement/{id}/receipt?t=  prior, every LR, posterior
GET  /api/twin/states?t=<sim_t>       byte offsets into twin_states.bin
GET  /api/metrics                     calibration, equity, robustness
GET  /api/decisions?since=<id>        hash-chained audit log

── CONTROL ──────────────────────────────────────────────────────
POST /api/clock       {action: play|pause|seek|speed, t?, speed?}
POST /api/inject      {attack: false_reports|kill_sar|cut_edge|silence, params}
POST /api/override    {decision_id, actor, reason}
POST /api/verify/{id} {result}         → re-enters ingest

── LIVE ─────────────────────────────────────────────────────────
POST /api/events      one raw event (also the real-deployment path)
GET  /api/stream      SSE: belief deltas, plan, verify, log

── STATIC ───────────────────────────────────────────────────────
/tiles/*.pmtiles      served off disk, HTTP range requests
/export/dispatch.pdf  the printed sheet (degradation L1)
/export/alerts.cap    CAP 1.2, SACHET-compatible
```

**SSE, not WebSockets** — one-directional, trivially simpler, reconnects for free.

---

# PART 11 — THE TWIN (3D front end)

**MapLibre GL JS only. No Three.js, no Cesium, no game engine.** Everything is a paint-property
animation on a `fill-extrusion` layer. ~3 days, ~600 lines of TypeScript, no backend of its own.

## 11.1 Interaction flow

```
1. INDIA           flat 2D, states shaded by hazard exposure
2. click state  →  districts
3. click district → easeTo({pitch: 60, zoom: 14}) + setTerrain()
                    + fill-extrusion-height animates 0 → real height (850 ms, 8 ms/tile stagger)
4. TIMELINE        ONE scrubber drives BOTH the 3D scene and the dispatch queue
5. click building/settlement → evidence receipt
```

> **The shared timeline is the entire point.** Scrub to T+06:12 and the water sits at the depth the
> belief engine inferred, buildings are coloured by the fragility state that produced P = 0.90, and
> the dispatch panel says `EXC+MED`. **The visualisation IS the model's output.**
> **Cut hazards before you cut this linkage.**

## 11.2 One damage pipeline, five hazards

```
hazard intensity → per-building intensity → fragility curve → damage state → render
```
Only the **first step** differs. Rendering, fragility and colouring are shared.

| Hazard | Intensity | Computed | Visual |
|---|---|---|---|
| **Flood** | depth (m) | **bathtub fill**: `WSE − DEM` | translucent blue volume follows terrain; buildings submerge and redden |
| **Earthquake** | PGA (g) | attenuation from epicentre + magnitude | 2 s camera shake; collapsed = **height × 0.4** |
| **Landslide** | runout/impact | slope + susceptibility, runout traced down DEM | brown debris polygon flows downslope |
| **Cyclone** | wind (m/s) + surge (m) | radial wind profile from track; surge reuses flood | roof-loss colouring |
| **Fire** | burn state | spread over building adjacency graph | orange propagation over time |

**Cost: first hazard ~2 days (it builds the pipeline); each additional ~half a day.**
**Do not build five renderers.**

## 11.3 Bathtub fill — the decision that matters most

```
Flood layer = a SECOND fill-extrusion layer
  fill-extrusion-base   : ground elevation (DEM)
  fill-extrusion-height : water surface elevation
  hidden where WSE < ground
```

Identical effort to a flat plane, but water then pours into valleys, leaves ridges dry, and creeps up
streets unevenly. **And it closes the loop:** it produces a real per-building submersion depth feeding
the same depth–damage curve from §4.2.

**Then add the detail that actually sells it:** a **1.5 px bright shoreline line layer along the
depth = 0 contour.** That is what makes the flood read as a volume rather than a blue wash. One extra
layer; does more than any shader.

## 11.4 Scene art direction

```js
map.setLight({ anchor: 'map', position: [1.4, 210, 28],
               color: '#FFF3E0', intensity: 0.42 });      // low angle, faintly warm

map.setSky({ 'sky-color': '#0E1621', 'horizon-color': '#1B2735',
             'fog-color': '#0A0B0D',
             'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.4 });
```

A single low-angle warm light against a cool ground is the entire difference between "3D bar chart"
and "a place." Distance fog is the cheapest depth cue available. **Do these two before anything else
— together they are ~60% of the perceived quality gain.**

- Default buildings near-neutral `#3E444C`. **Only damaged buildings take colour.**
- **Do not paint the district red.** A neutral field with seven red clusters is legible; a red field
  is not.
- **Vertical exaggeration ×2.5**, labelled `VERTICAL EXAGGERATION ×2.5` in the scene chrome.

## 11.5 Performance rules — non-negotiable

1. **Precompute damage state per building per timestep, offline** (F9). Ship as a `uint8` typed array.
   **The browser never runs a fragility curve** — it looks up a byte and sets a colour.
2. **Zoom-gate buildings.** All of India cannot render. Load only the selected district's PMTiles.
3. **Cap ~150k buildings in view**; tippecanoe feature-dropping at low zoom.
4. **Zero network calls at demo time.** PMTiles on local disk.

## 11.6 Honest constraints — state before a judge finds them

| Constraint | Framing |
|---|---|
| "Exact" buildings | Footprints real; **heights ML-estimated ±1.5 m**. Block-level realistic, not photoreal |
| Buildings look flat at true scale | Real stock is 6–15 m. **×2.5 exaggeration, labelled.** Standard dataviz practice |
| Bathtub ≠ hydraulics | *"This renders the inundation depth our model infers. It is not a hydrodynamic solver."* Real physics = ANUGA/LISFLOOD-FP, days of mesh setup, will not run in a browser |
| "Cracking open" buildings | Not feasible in MapLibre, not worth a 3D engine. **Collapse reads better**: height × 0.4 + colour + debris footprint |
| Not all hazards had a real event here | **Label `REPLAY` vs `SCENARIO` on screen.** Rigour, not weakness |

---

# PART 12 — DESIGN SYSTEM

**Reference: Apple's *pro* tools — Final Cut, Logic, Instruments, Watch, Maps at night.**
Not the consumer apps. Premium in a 3 a.m. EOC tool is **restraint and hierarchy**, not decoration.

**Three governing principles:**
1. **Saturation is a scarce resource.** Only the worst thing on screen is fully saturated.
2. **Numbers must never jitter.** Tabular figures everywhere, always.
3. **Uncertainty is designed, not omitted.**

## 12.1 Tokens

```css
:root {
  --bg-base:#0A0B0D; --bg-surface:#141619; --bg-raised:#1C1F23;
  --bg-overlay:rgba(20,22,25,0.72);
  --line:rgba(255,255,255,0.08); --line-strong:rgba(255,255,255,0.14);
  --text-primary:#F5F6F7;
  --text-secondary:rgba(245,246,247,0.62);
  --text-tertiary:rgba(245,246,247,0.38);

  --accent:#0A84FF;               /* interaction + selection ONLY. never severity */
  --accent-dim:rgba(10,132,255,0.16);

  /* severity: neutral → amber → red. saturation climbs monotonically */
  --sev-none:#3E444C; --sev-minor:#6E6A4E; --sev-moderate:#C08A2E;
  --sev-severe:#E0662F; --sev-catastroph:#FF3B30;

  --water-fill:rgba(46,111,168,0.42); --water-edge:#6FB4E8;
  --ok:#30D158; --warn:#FFD60A; --danger:#FF453A;

  --space-1:4px;  --space-2:8px;  --space-3:12px; --space-4:16px;
  --space-5:24px; --space-6:32px; --space-7:48px;
  --radius-chip:6px; --radius-card:10px; --radius-panel:14px;

  --ease-out:cubic-bezier(0.32,0.72,0,1);
  --dur-micro:180ms; --dur-ui:320ms; --dur-camera:1200ms; --dur-extrude:850ms;
}
```

## 12.2 Rules that matter

- **Severity never uses blue** — blue is the accent and the water. Collision here turns the map to mud.
- **Only `--sev-catastroph` is fully saturated.** If half the map is red, nothing is red.
- **Confidence = opacity + texture, never hue.**
  `P ≥ 0.8` solid · `0.4–0.8` 62% opacity · `< 0.4` 38% + **1 px dashed outline**.
  **This is the most important rule in the file** — it is how the interface refuses to lie about
  certainty, which is the same argument the whole product rests on.
- **Nothing bounces.** No overshoot, no spring.
- **Animate list reordering.** Watching Bhimsar climb past Kolang *is* the argument; a hard cut kills it.
- Type scale: Display 34/40 · Title 22/28 · Headline 17/22 · Body 15/20 · Caption 13/16 · Micro 11/14.
  Max three weights: 400/500/600.
- Numbers **right-aligned**, decimals aligned, never centred.

```css
/* every element containing a number. no exceptions. */
font-variant-numeric: tabular-nums;
```

```css
/* the single most "Apple" declaration available. panels over the map only. */
.panel { background: var(--bg-overlay);
         backdrop-filter: blur(24px) saturate(140%);
         border: 1px solid var(--line); border-radius: var(--radius-panel); }
```

## 12.3 Key components

**Dispatch row** — 56 px. Rank in Mono/tertiary · name Headline · block+pop Caption/secondary ·
severity as Micro uppercase chip (`--sev-*` at 18% alpha bg, full colour text) · confidence and harm
right-aligned tabular. Selected: `--bg-raised` + 4 px `--accent` leading bar. **No glow, no border.**

**Evidence receipt** — slides from the right on the blur material. Prior, then one row per evidence:
`timestamp · channel · description · LR · Δlog-odds`, Δ right-aligned signed tabular.
**The discounted contradiction stays visible** at `--text-tertiary` with its LR struck through.
**Showing the evidence you dismissed, and why, is the whole credibility argument. Never hide it.**

**The unknown state** — a first-class component:
```
┌──────────────────────────────────────┐
│  NO USABLE SIGNAL              26    │
│  Insufficient observability for a    │
│  severity estimate. Queued for       │
│  verification.               [VIEW]  │
└──────────────────────────────────────┘
```
Dashed `--line-strong`, no severity colour. **Every other dashboard projects false completeness.**

## 12.4 Banned (tells of a hackathon UI)

Unmodified Bootstrap/Material · purple→blue gradients · emoji as chrome icons · drop shadows on
non-floating elements · >1 accent colour · centred data tables · mixed radii or icon stroke weights ·
heavy-bordered glassmorphism · rainbow severity ramps · loading spinners (use skeleton rows) ·
**any number without `tabular-nums`**.

## 12.5 Five details that read as expensive and cost nothing

1. `tabular-nums` everywhere · 2. `backdrop-filter` on floating panels · 3. `setLight` + `setSky` ·
4. animated list reordering · 5. a designed empty/unknown state.

---

# PART 13 — SCREEN LAYOUT

One page, four map modes, one scrubber. **No tabs, no nav menus** — a hackathon UI with navigation
is one nobody explores.

```
┌──────────────────────────────────────────────────────────────────────┐
│ SETU · Wayanad REPLAY        T+06:12    LIVES SAVED vs BASELINE: 142 │
├───────────────────────────────┬──────────────────────────────────────┤
│                               │  ▸ DISPATCH QUEUE                    │
│         [ 3D MAP ]            │  1 BHIMSAR    COLLAPSE   0.90  🚜🏥  │
│                               │  2 KHARSA     COLLAPSE   0.81  🚜🏥  │
│  ◉ severity   ○ silence       │  3 DHANAURI   PRE-POS    0.61  🛶    │
│  ○ reports    ○ reachability  │  …                                   │
│                               │  14 KOLANG    INUNDATE   0.07  —     │
│  VERTICAL EXAGGERATION ×2.5   ├──────────────────────────────────────┤
│                               │  ▸ VERIFY NEXT (highest VoI)         │
│                               │  ☎ Kharsa PHC · 4 min                │
│                               │    flips BOAT-2 north/south          │
│                               ├──────────────────────────────────────┤
│                               │  ▸ INCOMING     247 msgs → 31 claims │
│                               │  ▸ NO USABLE SIGNAL           26     │
├───────────────────────────────┴──────────────────────────────────────┤
│ T+0 ├────────●──────────────────────────────────────┤ T+24h   [⚠ RED]│
└──────────────────────────────────────────────────────────────────────┘
```

## 13.1 The four map modes

| Mode | Shows |
|---|---|
| **Severity** | Default. Buildings/settlements by failure mode + magnitude |
| **Silence** ⭐ | **Inverted.** Chattering villages fade out; **silent villages glow, sized by expected harm.** One toggle and the priority order visibly inverts. **~3 h to build; highest visual-impact-per-hour item in the project** |
| **Reports** | Raw report density — i.e. what today's system sees |
| **Reachability** | Road graph coloured by `P(passable)`, per selected asset class |

---

# PART 14 — DEMO

## 14.1 Register: serious operational walkthrough

**No games, no theatrics.** Differentiation comes from **evidence** — a validated number against real
ground truth, which competing teams cannot fake. The spine is one duty officer's shift, hour 0 → 12,
in the order the work actually happens. That makes the demo self-explaining: you never have to say
"and this addresses requirement three."

## 14.2 Run of show — 4 minutes

| Time | Beat | Lands |
|---|---|---|
| 0:00–0:25 | **Situation screen at T+0.** Full ranked list, **zero reports ingested.** *"Today this screen is blank for the first six hours."* | Cold start |
| 0:25–1:00 | Scrub to T+06:12. Split: left = rank by report volume (today's method), right = SETU. **Kolang falls to 14. Bhimsar climbs to 1.** Rows animate | The core argument |
| 1:00–1:20 | Toggle **Silence Map.** Order visibly inverts | Silence-as-signal |
| 1:20–1:45 | Click Bhimsar → **evidence receipt.** Every LR, including the discounted contradiction. **COLLAPSE → excavator, not boat** | Collapse vs waterlogging |
| 1:45–2:05 | Dispatch: *"Bhimsar unreachable by road, Sirsi bridge P = 0.15 → river ingress from Kolang ghat, ETA 06:40"* | Reachability (F2) |
| 2:05–2:25 | **Pre-position alert:** *"Dhanauri is fine now and won't be in five hours. The road you'd use is closing."* | Cascade (F1) |
| 2:25–2:50 | **Verify queue.** *"Do not fly the drone at Bhimsar — you're going regardless. Call Kharsa PHC: 4 minutes, flips boat 2."* | VoI (M3) |
| 2:50–3:15 | **Red team.** Inject 200 false reports. Counter spikes to 247 → `1 root claim, trust 0.18`. **Top-10 shifts by one position** | Robustness (F3a) |
| 3:15–3:30 | **Equity panel.** *"Here is how our own system could have failed tribal hamlets, and the constraint that stops it."* | Maturity (F3b) |
| 3:30–3:45 | **Validation slide.** Top-k recall, silent-zone recall, calibration curve on 3 held-out events | Evidence |
| 3:45–4:00 | **Pull the network cable. Keep going. Print the dispatch sheet. Hand it to the judge.** | Deployability (F3c) |

**Closing line:**
> *"Every other system tells you what happened. This one tells you what to do, whether it can be done,
> what happens next — and it keeps telling you after the power goes out."*

## 14.3 Demo-day engineering rules

- **A `RESET` hotkey.** One keypress → T+0. You will use it fifteen times.
- **Seeded randomness.** Identical run every time.
- **Screen-record a perfect run the night before.** If the laptop dies, narrate over video and finish.
- **Aeroplane mode is a feature** — so it had better genuinely work. Rehearse with the cable out.
- **Rehearse five times.** The demo is the product.

## 14.4 Judge Q&A

| Question | Answer |
|---|---|
| *"Google already does this — SKAI."* | SKAI scores buildings from imagery. It cannot tell you which of two equally damaged villages to reach first, it needs an image (monsoon cloud, 12–72 h revisit), and it says nothing about a village it cannot see. **We consume SKAI as one likelihood term.** |
| *"Isn't this Ushahidi?"* | Ushahidi is report-in, map-out, verification by hand. If nobody reports, it shows nothing. **Our worst-case village has a severity number with zero reports.** |
| *"Where's the data from?"* | Public for the demo — DEM, Census, CWC, IMD, Sentinel-1, **IODA live**, Meta D4G on HDX. Telecom/PDS heartbeat is simulated and we say so; the real integration is an NDMA–DoT MoU, and **GSMA Big Data for Social Good already includes Airtel**. |
| *"Prove it works."* | Replay a real event side by side against report-volume ranking. Top-k recall, time-to-first-correct-dispatch, calibration curve. |
| *"What if it's wrong?"* | Confidence-gated autonomy, human-in-command override, hash-chained audit log, live equity panel. **Advisory, calibrated, and it knows when it doesn't know.** |
| *"You just wrapped an LLM."* | **The LLM extracts and structures. It never assigns severity.** Severity is a Bayesian posterior you can audit line by line — here is the receipt. |
| *"Is silence really novel?"* | No, and we say so — Meta and Flowminder proved it. What's new is settlement-level resolution and **feeding it into a decision instead of a layer.** |

---

# PART 15 — METRICS & VALIDATION

Run on **held-out real events** with post-hoc ground truth (DDMA reports, PDNA documents).

| Metric | Definition | Why |
|---|---|---|
| **Top-k recall @ 6/12/24 h** | fraction of the truly-worst *k* in our top *k* | **Only argmax-relevant errors matter** |
| **Silent-zone recall** ⭐ | % of severe settlements identified **before any report from them** | **The headline number** |
| **Time-to-first-correct-dispatch** | hours until the worst settlement gets a correctly-typed asset | Operational impact |
| **Asset-hours misallocated** | vs report-volume baseline | Direct answer to "haphazardly" |
| **Asset-type accuracy** | % dispatches with the right asset class | Tests the collapse-vs-waterlogging discriminator |
| **Calibration error (ECE)** | reliability-curve deviation | **Trustworthiness > accuracy** |
| **Robustness** | top-10 rank displacement under 200 injected false reports | F3a headline |
| **Equity gap** | dispatch rate, SC/ST-majority & low-connectivity hamlets vs district mean | F3b headline |

**Baseline to beat: rank by report volume.** It is the real EOC baseline, and it is genuinely terrible
— which is the point.

## 15.1 Testing

**1. Golden replay (the one that matters).** Fixed `events.jsonl` → fixed expected top-10 at T+6 h.
Any change to `likelihoods.py` that moves the ranking **fails loudly**.

**2. Property tests on `core/`.** Belief monotone in evidence strength · correlated evidence never
exceeds the independent bound · reliability 0 moves the posterior by exactly 0 · `dedupe` idempotent.

**3. Calibration harness.** Three held-out events → reliability curve, top-k recall, ECE.
Not pass/fail — **a number for the slide.**

---

# PART 16 — BUILD PLAN

## 16.1 Repo layout

```
setu/
├── Makefile                    make forge | make serve | make test | make demo
├── docker-compose.yml          for judges; must ALSO run bare
├── scripts/forge/
│   ├── f1_settlements.py … f10_events.py
│   └── run_all.py
├── core/                       ← THE 500 NOVEL LINES. pure, no I/O.
│   ├── belief.py  likelihoods.py  silence.py  sar.py  trust.py
│   ├── dedupe.py  cascade.py  voi.py  dispatch.py  fragility.py
├── ingest/
│   ├── envelope.py  pipeline.py
│   ├── connectors/  sms_gammu.py telegram.py whatsapp_export.py odk.py
│   │                voice_drop.py email_imap.py cap_feed.py webhook.py
│   │                machine/ ioda.py telecom.py power.py sar.py
│   ├── s1_normalise.py … s8_trust.py
│   └── s6_locate/  gazetteer.py translit.py match.py
├── engine/
│   ├── app.py  clock.py  tick.py  checkpoint.py  inject.py  sse.py  db.py
├── exports/  pdf.py  cap.py  geojson.py
├── web/                        Vite + React + TS + MapLibre
│   ├── src/map/  twin.ts  layers.ts  hazards/  modes/
│   ├── src/panels/  dispatch.tsx  receipt.tsx  verify.tsx  equity.tsx
│   ├── src/timeline/  scrubber.tsx
│   └── src/design/  tokens.css
├── tests/  golden/  test_belief.py  test_dedupe.py  test_voi.py
├── models/                     offline model weights (~2–4 GB, git-ignored)
└── district_package/wayanad/   Forge output (~2 GB, git-ignored)
```

## 16.2 Dependency graph

```
   [1] schema + package loader
        │
   [2] Forge F1–F4, F6 ────────────► RANKED LIST, ZERO REPORTS ★
        │
   [3] core/belief + likelihoods
        │
   [4] clock + tick + SSE ─────────► REPLAY MOVES ★
        ├──────────────┬─────────────────┬──────────────┐
   [5] ingest      [6] machine       [7] F7 RA2CE   [10] F9 twin
       pipeline        channels ★        + dispatch       package
        │               │                  │               │
   [9] trust        [11] inject ★      [8] voi        [12] THE TWIN UI ★
        │                                  │               │
   [13] cascade F8 ───────────────────────┴───────────────┘
        │
   [14] audit log · override · PDF · CAP · equity panel
        │
   [15] design pass (§12) ★
```
★ = a demo beat. Every starred item must be visible on stage.

## 16.3 Sprint plan (48 h; compress proportionally for 36 h)

| # | Task | Hrs | Owner | Milestone |
|---|---|---|---|---|
| 1 | Schema, `district_package` loader, `/api/settlements` | 3 | Backend | Data loads |
| 2 | **Forge F1–F4, F6** (CLIMADA prior) | 6 | Geo | ★ **Ranked list with zero reports** |
| 3 | `core/belief.py` + `likelihoods.py` + golden test | 5 | Belief lead | The heart |
| 4 | Clock + `events.jsonl` + tick + SSE | 4 | Backend | ★ **Replay moves** |
| 5 | Ingest S6 locate → S5 extract → S9 emit | 6 | NLP ×2 | ★ **A report moves a belief** |
| 6 | **Machine channels** — IODA, telecom, SAR likelihoods | 3 | NLP | ★ **The differentiator** |
| 7 | **Forge F7 RA2CE** + `dispatch.py` + OR-Tools | 6 | Geo + Opt | ★ **Routed plan, not a list** |
| 8 | `voi.py` + verify panel | 3 | Opt | ★ Verification queue |
| 9 | S7 dedupe + S8 trust | 4 | NLP | Cascades collapse |
| 10 | **Forge F9** twin package + `/api/twin/states` | 4 | Geo | Twin data ready |
| 11 | `inject.py` red team | 3 | Backend | ★ **Robustness** |
| 12 | **THE TWIN UI** — drill-down, extrude, terrain, bathtub, shared timeline | 12 | Frontend | ★ **The 3D scene** |
| 13 | `cascade.py` + Forge F8 | 4 | Belief lead | ★ Pre-positioning |
| 14 | Audit log, override, PDF, CAP, equity panel | 4 | Backend | Credibility + L1 |
| 15 | **Design pass** (§12 steps 1–7) | 11 | Frontend | ★ **Looks premium** |
| 16 | Metrics + calibration harness | 3 | Belief lead | The validation slide |
| 17 | **Rehearse ×5** | 3 | All | Clean 4-min run |

**Critical path: 1 → 2 → 3 → 4 → 5.** ~24 h to a live, scrubbable, ranked district driven by a real
belief engine — already more than any competing team will have.

## 16.4 Team split (6)

| Role | Owns |
|---|---|
| **Belief lead** (strongest) | `core/` — belief, likelihoods, cascade, calibration. **Must not touch UI** |
| **NLP ×2** | Whisper, extractor, gazetteer, dedupe, trust, machine channels |
| **Geo** | PostGIS, Forge F1–F9, CLIMADA, RA2CE, tiles |
| **Backend/Opt** | FastAPI, tick, checkpoints, OR-Tools dispatch, VoI, exports |
| **Frontend** | Twin, panels, timeline, design system, slides, rehearsals |

## 16.5 The cut list (in order)

If behind, drop in this order — **and never reorder it**:

1. Cyclone + fire hazards (twin) — 12 → keep flood, landslide, quake
2. S7 dedupe stages C+D (semantic + media) — keep A+B
3. `cascade.py` / F1 pre-positioning — 13
4. CAP export, extra connectors — 14
5. S4 classify (HumAID taxonomy display)

**Never cut:** the shared timeline · the Silence map mode · the red-team injection · the evidence
receipt · the design pass · the rehearsals.

> A system that visibly survives attack beats a system with one more feature.
> A twin that shares the clock with the decision engine is the product; a twin with five hazards and
> no linkage is a screensaver.

---

# PART 17 — PRIOR ART

Know all of it. **Citing prior art accurately is a scoring advantage** — the room will be full of
teams claiming novelty for a dashboard.

## 17.1 Landscape

**Institutional (India):** NDEM (NRSC/MHA — geospatial repo + DSS, not a triage engine) · Bhuvan
(ISRO — visualisation) · SACHET (NDMA — outbound citizen alerting, opposite direction) · CWC/IMD
(**use as input**) · Copernicus EMS / UNOSAT (activation latency, analyst-in-loop) · NASA ARIA DPM
(ad-hoc decorrelation thresholds, quake-tuned) · **ITU/ETC Disaster Connectivity Map** (maps the
*network's* health, not the *village's*) · Aapda Mitra (100k volunteers — **an input channel for us**).

**Commercial:** 🔴 **Google/WFP SKAI** (85–98% expert agreement; 385k buildings after Hurricane
Melissa Oct 2025; Colombia floods Feb 2026) · 🔴 **ICEYE Flood Insights** (own SAR constellation,
block/plot damage heat map <24 h) · 🟠 **Esri ArcGIS EM** (owns the EOC screen — **plug into it**) ·
🔴 **Meta Data for Good** (connectivity + electricity, baseline-differenced, Bing tiles z13–16 ≈ 4.9 km,
8 h aggregation, young-user bias) · 🟡 Palantir, One Concern, Cape Analytics, Jupiter, Fathom.

**Open source:** Ushahidi (manual verification) · Sahana Eden (ageing, no inference) · KoboToolbox
(collection only — assumes you can reach) · HOT/OSM + Maxar Open Data (human-in-loop, hours–days) ·
xView2/xBD · AIDR · InaSAFE · GDACS · HDX.

**Research:** TREC Incident Streams · **DisasterNet** (KDD'23 — closest academic relative to our
fusion engine) · **DORA** (arXiv 2605.11633, 2026 — 515 tasks, 45 events, 108-tool MCP library;
"LLM agent for EOC" is now benchmarked and crowded) · Joint Source Selection in Social Sensing
(arXiv 1512.00500 — nearest thing to VoI, but for data sources not physical assets) · Flowminder CDR
(Haiti 2010, Nepal 2015).

**Hackathon precedent:** Call for Code 2018 **Project OWL** (mesh DuckLinks — hardware, $25M IBM
deployment) · CfC 2019 Prometeo · NASA Space Apps (satellite damage mapping is **saturated**) · SIH
entries: portals, chatbots, dashboards, tweet classifiers. **Nobody builds a decision model.**

## 17.2 Honest novelty scoring

| Pillar | Prior art | Verdict |
|---|---|---|
| Silence as signal | Meta Disaster Maps, Flowminder, ITU DCM, CAIDA IODA | ❌ **Not novel** — established and deployed |
| Physics prior → fragility | Standard cat modelling; **SEEDS + Microsoft "Sunny Lives"** already does per-home roof-material risk in Chennai, Bhopal, Gangtok, Dehradun | ❌ **Not novel**, already India-localised |
| Source reliability + rumour collapse | AIDR, TREC-IS, Ushahidi (manual) | 🟡 **Partly novel in execution** |
| **VoI verification tasking** | informative path planning, drone routing OR, social-sensing source selection | ✅ **Open in product form** |
| **Regret-ranked, asset-typed, routed dispatch with receipts** | Esri does collection; nobody does calibrated triage with audit trail | ✅ **Open** |
| **The fusion layer itself** | SKAI, ICEYE, Meta, Ushahidi, CWC are five separate portals | ✅ **The real gap** — literature confirms EOCs suffer "fragmented systems, data silos, manual struggles to correlate across disparate platforms" |

**Kill this framing:** *"AI that detects disaster damage."* Dead on arrival.
**Use §2.3 instead.**

---

# PART 18 — RISKS

| Risk | Sev | Mitigation |
|---|---|---|
| **Silence has benign causes** (power cut, festival, backhaul failure) | 🔴 | Nuisance layer: IODA regional footprint, holiday calendar, backhaul topology. **Never dispatch on silence alone** without corroboration |
| **Miscalibration destroys trust faster than error** | 🔴 | Reliability curve in the UI; confidence-gated autonomy |
| **Equity: silence uninformative in low-connectivity hamlets** | 🔴 | Baseline normalisation + VoI observability bonus + live equity panel |
| **Scope creep into the trap list** | 🔴 | §2.4 is a contract. Re-read at every sprint boundary |
| **Whisper hallucinates on satphone static** | 🟠 | `silero-vad` first; confidence floor; `needs_human` rather than a fabricated transcript |
| **Gazetteer mismatch** | 🟠 | LGD + variants + IndicXlit + rapidfuzz + **disambiguation queue** |
| **Correlated channels double-count** | 🟠 | Per-group damping (§4.5) |
| **Telecom data needs institutional access** | 🟠 | Simulate + disclose; aggregated non-personal only; GSMA/Airtel pathway |
| **Adversarial / strategic reporting** | 🟠 | Reliability posteriors + physics consistency. **Designed-for; demo it** |
| **Twin performance collapse** | 🟠 | Precomputed `twin_states.bin`; zoom-gating; 150k cap |
| **Demo depends on network** | 🟠 | Everything pre-cached; offline mode **is** a demo feature |
| **libpostal 2 GB blows the footprint** | 🟡 | Droppable — rapidfuzz + IndicXlit covers most village names |
| **Maxar Open Data is CC BY-NC** | 🟡 | Fine for a hackathon; flagged for any commercial path |
| **OSM ODbL share-alike on derived data** | 🟡 | We ship GPL-3 anyway; note in the licence file |

---

# PART 19 — VERIFICATION CHECKLIST

One person owns this. **All licence claims in §7 are from prior knowledge and MUST be verified
against each repo's `LICENSE` file.**

- [ ] Verify every licence in §7 · [ ] Confirm `google-research/skai` runnability and licence
- [ ] Confirm CAIDA IODA API terms + rate limits; get a working query for the demo district
- [ ] Confirm Meta D4G HDX licence for the chosen event
- [ ] Confirm Maxar/Vantor CC BY-NC applies to the event activation
- [ ] **Check GOBS `gobs.aeee.in` first** — may bundle Open Buildings v3 footprints + 2.5D heights and
      remove the GEE export step entirely
- [ ] Confirm Bhuvan CartoDEM access; Copernicus DEM as fallback
- [ ] Pull LGD codes for the district; build the name-variant table
- [ ] Source Census HH-series housing tables at village level
- [ ] **Locate post-hoc ground truth** (DDMA / PDNA) — **without it there is no metric**
- [ ] Fit likelihood ratios and per-group damping λ on ≥1 held-out event
- [ ] Confirm CrisisTransformers + IndicWhisper model weight terms
- [ ] Decide CAP 1.2 export in v1 (recommended: yes — cheap, and an adoption argument)

---

# PART 20 — GLOSSARY

| Term | Meaning |
|---|---|
| **The Forge** | Offline data pipeline producing `district_package/` |
| **The Engine** | Runtime FastAPI service — ingest, belief, decide |
| **The Twin** | 3D MapLibre front end |
| **Belief** | Log-odds per settlement per failure mode. The one number |
| **LR** | Likelihood ratio — how much an observation moves the belief |
| **Correlation group** | Set of channels sharing a cause; damped together |
| **VoI** | Value of Information — expected reduction in decision regret |
| **Cascade root** | Earliest observation in a rumour cluster; the only one that counts |
| **Independent sources** | Distinct source × channel × first-hand. **Drives weight, not message count** |
| **Observability** | 0–1, how detectable a settlement is. Low → VoI bonus |
| **HAND** | Height Above Nearest Drainage — makes bathtub flood modelling cheap |
| **Bathtub fill** | `depth = WSE − ground_elevation`. Visualisation, not hydraulics |
| **LGD** | Local Government Directory — official Indian village codes |
| **Kutcha / Pucca** | Mud-and-thatch / brick-and-RCC housing. Selects the fragility curve |
| **REPLAY / SCENARIO** | Real event with ground truth / hypothetical. **Always labelled on screen** |

---

# PART 21 — BOOTSTRAP

```bash
# ── Day 0, in this order ──────────────────────────────────────────────
# 1. Physics prior BEFORE writing any of our own code
pip install climada geopandas rasterio osmnx networkx ortools
python -c "import climada; print(climada.__version__)"
#    → load Wayanad exposure + a flood hazard → priors.parquet
#    MILESTONE: 214 settlements have a severity number, zero lines of SETU written

# 2. Road disruption — F2 flagship, day one
pip install ra2ce          # Deltares/ra2ce
#    → OSM extract + flood raster → per-edge p_passable

# 3. SAR flood extent
pip install hydrafloods    # Servir-Mekong/hydra-floods  (needs GEE auth)

# 4. Building damage channel
git clone https://github.com/google-research/skai
#    → run inference on one Maxar Open Data pre/post pair

# 5. Ingest stack
pip install faster-whisper silero-vad ftfy fasttext rapidfuzz jellyfish \
            datasketch sentence-transformers imagededup outlines spacy
#    AI4Bharat: IndicTrans2, IndicXlit, IndicWhisper from HuggingFace

# 6. Tiles
brew install tippecanoe    # or build from source
pip install rio-rgbify
#    → buildings.pmtiles, terrain.pmtiles

# 7. App skeleton
#    Backend:  fastapi uvicorn sqlalchemy geoalchemy2 psycopg2-binary
#    Frontend: npm create vite@latest web -- --template react-ts
#              npm i maplibre-gl pmtiles lucide-react

# 8. NOW write core/belief.py — against four real evidence channels, not stubs
```

**Why this order:** your novel code gets built against real data from hour one, instead of against
stubs you will have to rewrite.

---

*Reuse before build. The Forge makes it possible, the Engine makes it fast, the Twin makes it visible.*
*If a feature does not change which asset goes where, it does not ship.*
