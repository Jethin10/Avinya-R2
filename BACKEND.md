# SETU — Backend, from the ground up

> **The one idea to hold onto:** the backend is **two programs**, not one.
>
> - **THE FORGE** — offline. Turns raw public data into a compact district package. Heavy, slow, runs
>   rarely, outputs **files**. This is 80% of the backend work and it is *not a server*.
> - **THE ENGINE** — online. Reads that package, consumes evidence, updates beliefs, emits decisions.
>   Light, fast, runs during the event. This is a **single FastAPI process**.
>
> Compiling vs. running. Everything expensive happens in the Forge, so that nothing expensive happens
> at demo time. That is what makes SETU fast, offline-capable, and reliable on stage.

---

## Contents

1. [Mental model](#1-mental-model)
2. [The three kinds of data](#2-the-three-kinds-of-data)
3. [THE FORGE — offline pipeline](#3-the-forge--offline-pipeline)
4. [The district package](#4-the-district-package)
5. [THE ENGINE — runtime](#5-the-engine--runtime)
6. [The tick — what happens every simulated minute](#6-the-tick--what-happens-every-simulated-minute)
7. [Scrubbing: checkpoints](#7-scrubbing-checkpoints)
8. [Database schema](#8-database-schema)
9. [API surface](#9-api-surface)
10. [Repo layout](#10-repo-layout)
11. [Process model & deployment](#11-process-model--deployment)
12. [Testing](#12-testing)
13. [Build order](#13-build-order)

---

## 1. Mental model

```
                         ══ THE FORGE ══  (offline, minutes–hours, run once per district)

   raw public data                                              district_package/
   ┌──────────────────┐      ┌────────────────────┐            ┌──────────────────┐
   │ Census, LGD      │      │  GDAL, CLIMADA,    │            │ settlements.gpkg │
   │ Copernicus DEM   │ ───► │  RA2CE, HYDRAFloods│ ─────────► │ roads.gpkg       │
   │ Open Buildings   │      │  SKAI, tippecanoe  │            │ hazard/*.tif     │
   │ Sentinel-1, OSM  │      └────────────────────┘            │ buildings.pmtiles│
   │ IMD, CWC, IODA   │                                        │ twin_states.bin  │
   └──────────────────┘                                        │ events.jsonl     │
                                                               └────────┬─────────┘
                                                                        │  load once
                         ══ THE ENGINE ══  (online, milliseconds)       ▼
                         ┌─────────────────────────────────────────────────────┐
   evidence  ──────────► │  ingest → dedupe → trust → BELIEF → cascade         │
   (replay or live)      │                              ↓                      │
                         │                     dispatch + VoI                  │
                         │                              ↓                      │
                         │              Postgres  +  SSE push to frontend      │
                         └─────────────────────────────────────────────────────┘
```

**Why this split is the whole design:**

| | The Forge | The Engine |
|---|---|---|
| When | Before the event / before the demo | During |
| Duration | Minutes to hours | Sub-second per tick |
| Language | Python scripts, CLI tools | Python service |
| Talks to internet | Yes, heavily | **Never** |
| Output | Files on disk | Rows + SSE messages |
| If it breaks | You rerun it, nobody notices | You are on stage |

**Consequence:** at demo time there is no GDAL, no Earth Engine, no satellite download, no network.
Just NumPy over ~214 settlements. That is why it can run on a laptop with the cable pulled.

---

## 2. The three kinds of data

Every table in the system is exactly one of these. If you can classify a new table, you know who
writes it and when.

| Kind | Written by | When | Examples |
|---|---|---|---|
| **STATIC** | The Forge | Once per district | `settlement`, `road_edge`, `cascade_edge`, `infrastructure`, `building` |
| **STREAMING** | The Engine | Continuously | `claim`, `evidence`, `belief`, `belief_checkpoint` |
| **DECISION** | The Engine | On each tick | `task`, `verification_task`, `decision_log`, `override` |

The Engine **never writes STATIC tables.** The Forge **never writes STREAMING or DECISION tables.**
Hold that line and the system stays comprehensible.

---

## 3. THE FORGE — offline pipeline

Ten stages. Each is a script, each writes a file, each can be rerun independently.
`scripts/forge/` — run in order via `make forge DISTRICT=wayanad`.

### F1 · Define the district → `settlements.gpkg`

**In:** LGD village directory, Census 2011 village boundaries, district admin boundaries
**Out:** one row per settlement — `id, lgd_code, name, name_variants[], geom, block, tehsil`

The name-variant list matters more than it looks: `Bhimsar / Bheemsar / भीमसर` must all resolve to
`BH-042`, or half your reports land nowhere. Build this table with variants generated from
transliteration + common misspellings, and keep a manual override file.

### F2 · Exposure → population + buildings

**In:** WorldPop / Census population, **Google Open Buildings v3** footprints,
**Open Buildings 2.5D Temporal** heights (or the **GOBS** India package, which bundles both)
**Out:** `population`, `elderly_frac`, `pct_sc_st` on `settlement`; a `building` table with
`geom, height_m, settlement_id, area_m2`

### F3 · Terrain → `terrain/`

**In:** Copernicus DEM 30 m (or CartoDEM)
**Out:** `dem.tif`, `slope.tif`, `hand.tif` (Height Above Nearest Drainage), plus
`elevation_m, slope_deg, hand_m` joined onto `settlement`

HAND is what makes flood modelling cheap: depth ≈ `water_surface_elevation − ground_elevation`, and
HAND tells you how far above the nearest channel each point sits.

### F4 · Vulnerability → fragility class

**In:** Census HH-series housing tables (wall material, roof material, storeys)
**Out:** `pct_kutcha, pct_pucca, pct_semi_pucca` on `settlement`, plus a `fragility_class`
that selects which depth–damage curve applies

**Use CLIMADA or Delft-FIAT's impact-function library here. Do not write your own curves.**

### F5 · Hazard → `hazard/{hazard}/t{NNN}.tif`

For each hazard, for each replay timestep, one intensity raster.

| Hazard | Intensity | Produced by |
|---|---|---|
| Flood | depth (m) | HYDRAFloods / Sentinel-1 water extent + HAND bathtub fill |
| Earthquake | PGA (g) | simplified GMPE from epicentre + magnitude |
| Landslide | runout / impact | slope + susceptibility, runout traced down the DEM |
| Cyclone | wind (m/s) + surge (m) | radial wind profile from track; surge reuses flood |
| Fire | burn state | spread over building adjacency |

### F6 · Physics prior → `priors.parquet`

**In:** F2 exposure × F4 vulnerability × F5 hazard
**Out:** `log_odds_prior[settlement][failure_mode]` at t = 0

**Run CLIMADA (or Delft-FIAT).** This is the §7.1 prior in `plan.md`, and it is why every settlement
has a severity number before a single report arrives.

### F7 · Network → `roads.gpkg` + `passability/t{NNN}.parquet`

**In:** OSM extract (via OSMnx) + F5 hazard rasters
**Out:** road graph, and per-edge `p_passable` **per timestep, per asset class**

**Run RA2CE (Deltares)** for the disruption and redundancy analysis. Boat, excavator and 4×4 each get
their own traversable subgraph — that is the F2 flagship, and Deltares already wrote most of it.

### F8 · Cascade graph → `cascade.gpkg`

**In:** DEM flow routing, embankment/dam/bridge inventory
**Out:** `cascade_edge(src, dst, lag_minutes, transfer_weight)`

Upstream → downstream hydrological edges, dam → command area, slope → runout path.

### F9 · Twin package → `buildings.pmtiles`, `terrain.pmtiles`, `twin_states.bin`

**In:** F2 buildings, F3 terrain, F5 hazard
**Out:** vector tiles (via `tippecanoe`) + a packed `uint8` array `[building_id × timestep]` of
damage states

**This is the §20.7 performance rule:** the browser never runs a fragility curve. It looks up a byte.

### F10 · Event stream → `events.jsonl`

The replay itself. One JSON object per line, timestamped, sorted:

```json
{"t":"2024-07-30T04:20:00+05:30","kind":"report","channel":"ham","source_id":"HAM-VU2XYZ",
 "text":"embankment breached near chainage 14, water in houses","audio":null}
{"t":"2024-07-30T04:31:00+05:30","kind":"telemetry","channel":"telecom",
 "settlement_id":"BH-042","observed":0,"expected":380}
{"t":"2024-07-30T04:31:00+05:30","kind":"sar","pass_id":"S1A_20240730",
 "raster":"hazard/flood/t018.tif","coherence":"hazard/coh/t018.tif"}
```

Mixed real and synthetic, and **the file records which is which** — every event carries a
`provenance` field (`archived` | `synthetic`). That is how you answer "what's real?" honestly.

---

## 4. The district package

The Forge's entire output. One directory. Copy it to a laptop and SETU runs.

```
district_package/wayanad/
├── meta.json                 district id, bbox, timezone, replay t0/t1, provenance summary
├── settlements.gpkg          STATIC · 214 rows
├── buildings.gpkg            STATIC · ~180k rows
├── roads.gpkg                STATIC · graph + geometry
├── cascade.gpkg              STATIC · dependency edges
├── priors.parquet            log-odds at t=0, per settlement × failure mode
├── terrain/
│   ├── dem.tif  slope.tif  hand.tif
├── hazard/
│   ├── flood/t000.tif … t144.tif
│   ├── landslide/…  quake/…  cyclone/…
├── passability/t000.parquet … t144.parquet
├── tiles/
│   ├── basemap.pmtiles  terrain.pmtiles  buildings.pmtiles
├── twin_states.bin           [building × timestep] uint8 damage state
└── events.jsonl              the replay stream
```

**Size target: under 2 GB.** It must fit on a USB stick and load in seconds.

---

## 5. THE ENGINE — runtime

One FastAPI process. Six internal components. No microservices, no message broker, no Docker swarm —
this is deliberately a **monolith**, because it has to run on one laptop with no internet.

```
                        ┌─────────────── ENGINE (one process) ───────────────┐
  events.jsonl ────────►│  ① CLOCK      replay driver, accelerated time      │
  or live POST          │      ↓                                             │
                        │  ② INGEST     asr → extract → geocode → dedupe →   │
                        │                trust → evidence rows               │
                        │      ↓                                             │
                        │  ③ BELIEF     log-odds fusion, damping, smoothing  │
                        │      ↓                                             │
                        │  ④ CASCADE    time-lagged downstream propagation   │
                        │      ↓                                             │
                        │  ⑤ DECIDE     dispatch (OR-Tools) + VoI queue      │
                        │      ↓                                             │
                        │  ⑥ PUBLISH    Postgres write + SSE push            │
                        └────────────────────────────────────────────────────┘
```

### ① Clock
Owns simulated time. Drives replay at `speed` (1× … 600×). Pausable, seekable.
In live mode it's just wall-clock and events arrive by POST instead.

### ② Ingest
`raw event → Claim rows → Evidence rows`

```
audio?  ─► faster-whisper ─► text
text    ─► LLM (fixed narrow JSON schema) ─► {location_str, hazard, severity_hint}
        ─► geocode: Nominatim + LGD gazetteer + rapidfuzz ─► settlement_id
        ─► dedupe: embed, cluster by similarity + time-order ─► cascade_root, cascade_size
        ─► trust:  Beta posterior for source_id ─► reliability
        ─► emit Evidence(log_lr, correlation_group)
```

**Architectural rule: the LLM extracts and structures. It never assigns severity.** Severity comes
from ③, so it stays explainable, calibrated and auditable. Say this out loud in the pitch — it
pre-empts "you just wrapped an LLM."

Telemetry and SAR events skip the NLP path and go straight to Evidence via their own likelihood
functions (`core/silence.py`, `core/sar.py`).

### ③ Belief
The heart. Pure functions over NumPy arrays. **No I/O inside.**

```python
def update(prior: np.ndarray,          # [n_settlements, n_modes]
           evidence: list[Evidence],
           neighbours: sparse.csr_matrix,
           damping: dict[str, float]) -> np.ndarray:
    ...
```

214 settlements × 5 modes = ~1,000 floats. A full recompute is **microseconds**. Do not optimise this;
do not cache it; just recompute the touched settlements plus their graph neighbours every tick.

### ④ Cascade
Propagates belief increases downstream with a lag, over `cascade_edge`. Produces the **pre-position
queue** — settlements currently intact with a high `P(severe within 6h)`.

### ⑤ Decide
- `expected_harm = P(severe) × population × mortality_rate(mode, hours) × isolation`
- Look up `p_passable` for the current timestep, build each asset's traversable subgraph
- OR-Tools VRP → routed plan per asset with ETAs
- VoI queue: for each candidate verification action, expected regret reduction
- ~30 candidate nodes, 6 assets → **solves in well under a second**

### ⑥ Publish
Write `belief`, `task`, `verification_task`, hash-chained `decision_log`. Push a compact delta over
**Server-Sent Events** — SSE, not WebSockets, because it's one-directional and trivially simpler.

---

## 6. The tick — what happens every simulated minute

This is the loop. Everything else is plumbing around it.

```python
async def tick(t: SimTime):
    # 1. pull due events
    events = clock.pop_due(t)                       # from events.jsonl or live queue

    # 2. ingest → evidence
    touched: set[str] = set()
    for e in events:
        for ev in ingest.process(e):                # may emit 0..n Evidence rows
            db.add(ev)
            touched.add(ev.settlement_id)

    # 3. recompute belief for touched + graph neighbours
    scope = graph.expand(touched, hops=1)
    beliefs = belief.update(priors[scope], db.evidence_for(scope),
                            neighbours[scope], DAMPING)
    db.upsert_beliefs(beliefs)

    # 4. cascade — time-lagged downstream propagation
    pre_positions = cascade.propagate(beliefs, t)

    # 5. decide
    passability = pkg.passability(t)
    plan  = dispatch.solve(beliefs, pre_positions, assets, passability)
    verify = voi.rank(beliefs, plan, verification_capacity)

    # 6. publish
    entry = decision_log.append(t, plan, verify, hash_of(beliefs))
    if t % CHECKPOINT_INTERVAL == 0:
        db.write_checkpoint(t, beliefs)
    await sse.push({"t": t, "beliefs": delta(beliefs),
                    "plan": plan, "verify": verify, "log": entry.id})
```

**Budget per tick: < 50 ms.** At 300× replay speed that is 5 ticks/second of wall time — smooth.

---

## 7. Scrubbing: checkpoints

The frontend has a timeline scrubber. Dragging it backward must be instant, and re-running 24 hours
of ingest is not instant.

**Solution — checkpoint the belief state every 15 simulated minutes.**

```
seek(t):
  c = nearest checkpoint ≤ t          # load ~1,000 floats
  replay events from c.t to t          # at most 15 sim-minutes of evidence
  → typically < 30 ms
```

**Why not precompute every frame?** Because then the red-team injection console would be fake. You
need the ability to fork from any state and recompute for real. Checkpoints give you both: instant
scrubbing *and* genuine live recomputation when someone injects an attack.

```python
def inject(t: SimTime, attack: Attack):
    state = seek(t)                    # fork from the checkpoint
    extra = attack.to_events(t)        # e.g. 200 synthetic false reports
    return run_forward(state, extra)   # REAL recompute, not a script
```

---

## 8. Database schema

Postgres + PostGIS. (SQLite + SpatiaLite as the single-file offline fallback.)

```sql
-- ═══ STATIC (Forge writes, Engine reads) ═══
CREATE TABLE settlement (
  id              TEXT PRIMARY KEY,
  lgd_code        TEXT, name TEXT, name_variants TEXT[],
  block TEXT, tehsil TEXT, geom GEOMETRY(Point,4326),
  population INT, elderly_frac REAL, pct_sc_st REAL,
  pct_kutcha REAL, pct_pucca REAL, fragility_class TEXT,
  elevation_m REAL, slope_deg REAL, hand_m REAL,
  road_hours_normal REAL, nearest_phc_id TEXT,
  heartbeat_baseline JSONB          -- expected chatter per hour-of-week
);
CREATE TABLE building (
  id BIGINT PRIMARY KEY, settlement_id TEXT REFERENCES settlement,
  geom GEOMETRY(Polygon,4326), height_m REAL, area_m2 REAL
);
CREATE TABLE infrastructure (
  id TEXT PRIMARY KEY, kind TEXT,   -- embankment|bridge|dam|check_dam
  geom GEOMETRY, capacity REAL, fragility_params JSONB
);
CREATE TABLE road_edge (
  id BIGINT PRIMARY KEY, u BIGINT, v BIGINT, geom GEOMETRY(LineString,4326),
  bridge_id TEXT, base_minutes REAL, modes TEXT[]
);
CREATE TABLE cascade_edge (
  src_node TEXT, dst_node TEXT, lag_minutes INT, transfer_weight REAL
);

-- ═══ STREAMING (Engine writes) ═══
CREATE TABLE source (
  id TEXT PRIMARY KEY, channel TEXT,
  alpha REAL DEFAULT 1, beta REAL DEFAULT 1     -- Beta reliability posterior
);
CREATE TABLE claim (
  id TEXT PRIMARY KEY, source_id TEXT REFERENCES source,
  settlement_id TEXT, geo_confidence REAL, hazard TEXT,
  claim_text TEXT, severity_hint TEXT, ts TIMESTAMPTZ,
  cascade_root_id TEXT, cascade_size INT, provenance TEXT
);
CREATE TABLE evidence (
  id BIGSERIAL PRIMARY KEY, settlement_id TEXT, channel TEXT,
  failure_mode TEXT, log_lr REAL, correlation_group TEXT,
  ts TIMESTAMPTZ, raw_ref TEXT
);
CREATE TABLE belief (
  settlement_id TEXT, failure_mode TEXT,
  log_odds REAL, variance REAL, updated_at TIMESTAMPTZ,
  PRIMARY KEY (settlement_id, failure_mode)
);
CREATE TABLE belief_checkpoint (
  sim_t TIMESTAMPTZ PRIMARY KEY, payload BYTEA    -- packed float32 array
);

-- ═══ DECISION (Engine writes) ═══
CREATE TABLE asset (
  id TEXT PRIMARY KEY, kind TEXT,   -- boat|excavator|medical
  capacity INT, home_node BIGINT, current_node BIGINT, status TEXT
);
CREATE TABLE task (
  id BIGSERIAL PRIMARY KEY, settlement_id TEXT, asset_id TEXT,
  seq INT, eta TIMESTAMPTZ, expected_lives_saved REAL, state TEXT
);
CREATE TABLE verification_task (
  id BIGSERIAL PRIMARY KEY, settlement_id TEXT, action TEXT,
  minutes INT, voi_score REAL, state TEXT
);
CREATE TABLE decision_log (
  id BIGSERIAL PRIMARY KEY, sim_t TIMESTAMPTZ,
  payload JSONB, belief_hash TEXT, prev_hash TEXT   -- hash-chained
);
CREATE TABLE override (
  id BIGSERIAL PRIMARY KEY, decision_id BIGINT, actor TEXT,
  reason TEXT, ts TIMESTAMPTZ, outcome TEXT
);
```

---

## 9. API surface

Small on purpose.

### Read
```
GET  /api/district                      meta + bbox + replay window
GET  /api/settlements                   static rows (cached forever by the client)
GET  /api/state?t=<sim_t>               beliefs + plan + verify queue at t
GET  /api/settlement/{id}/receipt?t=    the evidence receipt (prior, all LRs, posterior)
GET  /api/twin/states?t=<sim_t>         byte offsets into twin_states.bin
GET  /api/metrics                       calibration curve, equity panel, robustness
GET  /api/decisions?since=<id>          hash-chained audit log
```

### Control
```
POST /api/clock         {action: play|pause|seek|speed, t?, speed?}
POST /api/inject        {attack: "false_reports"|"kill_sar"|"cut_edge", params}
POST /api/override      {decision_id, actor, reason}
POST /api/verify/{id}   {result}        a verification answer comes back → re-enters ingest
```

### Live ingest (also the path a real deployment uses)
```
POST /api/events        one raw event (report | telemetry | sar)
GET  /api/stream        Server-Sent Events: belief deltas, plan, verify, log
```

### Static
```
/tiles/*.pmtiles        served directly off disk, HTTP range requests
/export/dispatch.pdf    the printed sheet (degradation Level 1)
/export/alerts.cap      CAP 1.2 for SACHET compatibility
```

---

## 10. Repo layout

```
setu/
├── Makefile                       make forge | make serve | make test
├── scripts/forge/
│   ├── f1_settlements.py … f10_events.py
│   └── run_all.py
├── core/                          ← THE 500 NOVEL LINES. Pure, no I/O.
│   ├── belief.py                  log-odds fusion, damping, spatial smoothing
│   ├── likelihoods.py             LR tables per channel   ← the real IP
│   ├── silence.py                 heartbeat deviation → LR
│   ├── sar.py                     backscatter / coherence → LR
│   ├── trust.py                   Beta posteriors
│   ├── dedupe.py                  rumour-cascade collapse
│   ├── cascade.py                 time-lagged propagation
│   ├── voi.py                     verification ranking
│   ├── dispatch.py                expected harm + OR-Tools VRP
│   └── fragility.py               thin wrapper over CLIMADA / Delft-FIAT curves
├── engine/
│   ├── app.py                     FastAPI
│   ├── clock.py                   replay driver
│   ├── ingest.py                  asr → extract → geocode → dedupe → trust
│   ├── tick.py                    the loop (§6)
│   ├── checkpoint.py              seek / fork
│   ├── inject.py                  red-team attacks (REAL recompute)
│   ├── sse.py                     push
│   └── db.py                      SQLAlchemy models
├── exports/  pdf.py  cap.py  geojson.py
├── tests/
│   ├── golden/                    fixed replay → expected dispatch order
│   └── test_belief.py  test_dedupe.py  test_voi.py
└── district_package/wayanad/      the Forge's output (git-ignored, ~2 GB)
```

**`core/` has no imports from `engine/`.** It is pure functions over arrays. That is what makes it
testable, explainable on stage, and reusable in a notebook for the calibration work.

---

## 11. Process model & deployment

```
┌── laptop, no internet ────────────────────────────┐
│  postgres  (or a single .sqlite file)             │
│  uvicorn engine.app:app          ← one process    │
│  nginx / python -m http.server   ← static tiles   │
│  frontend build                  ← static files   │
└───────────────────────────────────────────────────┘
```

- **One process.** No Celery, no Redis, no broker. The tick runs as an `asyncio` background task.
- **No outbound network at runtime.** Ever. Verify this by pulling the cable in rehearsal.
- **`docker compose up`** for the judges' convenience, but it must also run bare with
  `make serve` in case Docker misbehaves on the day.
- Sub-second startup after the package is loaded; memory well under 1 GB.

---

## 12. Testing

Three tiers, in priority order.

**1. Golden replay (the one that matters).**
Fixed `events.jsonl` → fixed expected dispatch order at T+6h. Any change to `likelihoods.py` that
moves the top-10 fails the test loudly. This is your regression net for the only thing that matters.

**2. Property tests on `core/`.**
- Belief is monotone in evidence strength
- Correlated evidence never exceeds the independent bound
- A source with reliability 0 moves the posterior by exactly 0
- `dedupe` is idempotent: re-ingesting a cascade adds nothing

**3. Calibration harness.**
Run three held-out real events → reliability curve, top-k recall, ECE. Not a pass/fail test; a
**number you put on a slide**.

---

## 13. Build order

| # | Task | Hrs | Unblocks |
|---|---|---|---|
| 1 | Schema + `district_package` loader + `/api/settlements` | 3 | everything |
| 2 | **F1–F4, F6** (settlements, exposure, terrain, vulnerability, prior) | 6 | **ranked list with zero reports** |
| 3 | `core/belief.py` + `likelihoods.py` + golden test | 5 | the heart |
| 4 | Clock + `events.jsonl` + tick + SSE | 4 | replay moves |
| 5 | `ingest.py` (whisper, extract, geocode, dedupe, trust) | 6 | real reports |
| 6 | `silence.py` + `sar.py` likelihoods | 3 | the anti-report channels |
| 7 | **F7 RA2CE passability** + `dispatch.py` + OR-Tools | 6 | routed plan |
| 8 | `voi.py` | 3 | verification queue |
| 9 | `checkpoint.py` + seek | 2 | scrubbing |
| 10 | **F9 twin package** + `/api/twin/states` | 4 | the 3D front end |
| 11 | `inject.py` red-team | 3 | robustness demo |
| 12 | `cascade.py` + F8 | 4 | pre-positioning |
| 13 | decision log, override, PDF, CAP | 4 | credibility + degradation |

**Critical path: 1 → 2 → 3 → 4.** After step 4 you have a live, scrubbable, ranked district driven by
a real belief engine — roughly 18 hours, and it is already more than any competing team will have.

**If you fall behind:** drop 12 (cascade) and 13's PDF/CAP before dropping 11 (red-team). A system
that visibly survives attack beats a system with one more feature.

---

*The Forge makes it possible. The Engine makes it fast. Keep them apart.*
