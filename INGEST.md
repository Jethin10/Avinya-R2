# SETU — M1 Ingest Layer

**Turning fragmented, contradictory, unverified chaos into weighted evidence.**

> **The one idea:** every channel — a satphone recording, a WhatsApp forward, an ODK form, an IODA
> outage, a Sentinel-1 pass — collapses into **one envelope** and flows through **one pipeline**.
> Connectors are thin and disposable. The pipeline is shared and is where all the value lives.
>
> Every stage below is a **named, proven, open-source project**. We write the glue and the
> likelihood functions. Nothing else.

---

## Contents

1. [The Observation envelope](#1-the-observation-envelope)
2. [The pipeline at a glance](#2-the-pipeline-at-a-glance)
3. [S0 · Connectors](#s0--connectors)
4. [S1 · Normalise](#s1--normalise)
5. [S2 · Transcribe](#s2--transcribe)
6. [S3 · Translate](#s3--translate)
7. [S4 · Classify](#s4--classify)
8. [S5 · Extract](#s5--extract)
9. [S6 · Locate — the hard part](#s6--locate--the-hard-part)
10. [S7 · Dedupe — rumour-cascade collapse](#s7--dedupe--rumour-cascade-collapse)
11. [S8 · Trust](#s8--trust)
12. [S9 · Emit evidence](#s9--emit-evidence)
13. [Offline footprint](#13-offline-footprint)
14. [Module layout](#14-module-layout)
15. [Licence register](#15-licence-register)
16. [What we deliberately do NOT use](#16-what-we-deliberately-do-not-use)
17. [Build order](#17-build-order)

---

## 1. The Observation envelope

Everything becomes this. One table, one schema, one pipeline. **This is the "one thing."**

```jsonc
{
  "obs_id":      "obs_0f31c9",
  "ts":          "2024-07-30T04:20:11+05:30",   // when it was OBSERVED
  "received_at": "2024-07-30T04:22:40+05:30",   // when WE got it
  "channel":     "ham",            // ham|sms|whatsapp|telegram|odk|voice|email|
                                   // telecom|power|sar|feed|api
  "source_id":   "HAM-VU2XYZ",     // → trust posterior
  "provenance":  "archived",       // archived | synthetic | live   ← never lose this

  "raw":       { "text": null, "audio": "blob://a91f.opus", "media": ["blob://v3.mp4"] },
  "text_orig":  "बांध टूट गया, चौदह चैनेज के पास पानी घरों में",
  "lang":       "hi",
  "text_en":    "embankment breached near chainage 14, water in houses",

  "info_type":  "infrastructure_damage",   // HumAID taxonomy
  "hazard":     "flood",
  "severity_hint": "severe",

  "geo": { "settlement_id": "BH-042", "confidence": 0.82,
           "surface": "भीमसर", "method": "lgd_fuzzy+district_prior" },

  "cascade": { "root_id": "obs_0f31c9", "size": 1, "independent_sources": 1 },

  "trust":   { "alpha": 8, "beta": 2, "reliability": 0.80 },

  "chain": ["connect:ham_dropbox", "asr:indicwhisper", "lid:fasttext",
            "mt:indictrans2", "cls:crisistransformers", "ext:outlines",
            "geo:lgd_matcher", "dedupe:minhash+labse"]
}
```

**Two rules that keep it honest:**

- **Never destroy the original.** `raw`, `text_orig` and `lang` survive every downstream stage. When a
  judge asks "what did the person actually say?", you can show them.
- **`chain` records every model that touched it.** This is the ingest half of the audit trail, and it
  makes debugging a bad geocode take seconds instead of an hour.

---

## 2. The pipeline at a glance

```
  ┌── S0 CONNECT ──────────────────────────────────────────────────────┐
  │ gammu-smsd · Telethon · ODK Central · file-drop · IMAP · webhook   │
  │ IODA API · Meta D4G · Sentinel-1 · CAP/RSS feeds                   │
  └──────────────────────────────┬─────────────────────────────────────┘
                                 ▼   Observation (raw)
  S1 NORMALISE   ftfy · unicodedata · indic-nlp-library · fasttext lid.176
                                 ▼
  S2 TRANSCRIBE  faster-whisper  /  AI4Bharat IndicWhisper        [audio only]
                                 ▼
  S3 TRANSLATE   AI4Bharat IndicTrans2  (indic → en)              [non-en only]
                                 ▼
  S4 CLASSIFY    CrisisTransformers → HumAID info-type taxonomy
                                 ▼
  S5 EXTRACT     LLM + Outlines/Instructor → strict JSON schema
                                 ▼
  S6 LOCATE      libpostal · IndicXlit · LGD+GeoNames index · rapidfuzz
                 + DISTRICT SPATIAL PRIOR   ← the trick that makes this easy
                                 ▼
  S7 DEDUPE      datasketch MinHash-LSH · sentence-transformers · imagededup
                 → union-find → cascade_root, independent_sources
                                 ▼
  S8 TRUST       Beta posterior per source_id  (ours, ~40 lines)
                                 ▼
  S9 EMIT        core/likelihoods.py → Evidence(log_lr, correlation_group)
                                 ▼
                          THE BELIEF ENGINE
```

**Machine channels (telecom, power, SAR, IODA) skip S1–S7 entirely** and go straight from S0 to S9 via
their own likelihood functions. They have no language and no author, so there is nothing to
transcribe, translate or distrust in the same way.

---

## S0 · Connectors

Thin adapters. Each is 30–80 lines and produces a raw Observation. **Deliberately disposable** — if a
channel dies, you delete one file.

| Channel | Tool | Licence | Notes |
|---|---|---|---|
| **SMS** | **gammu-smsd** | GPL-2 | USB modem → files in a spool dir. Dead simple, genuinely offline |
| **Telegram** | **Telethon** | MIT | Real Indian disaster coordination happens in Telegram groups |
| **WhatsApp** | exported `.txt` parser | ours | No official API exists. Parse the export; also the honest demo path |
| **Field forms** | **ODK Central** | Apache-2.0 | XLSForm standard. **Lighter than KoboToolbox, same forms.** Self-host in one container |
| **Voice / HAM / satphone** | file-drop watcher | ours | `.wav/.opus/.mp3` into a directory → S2 |
| **Email** | `imaplib` / `mailparser` | stdlib / MIT | District control rooms still run on email |
| **Alert feeds** | **CAP 1.2** + RSS/Atom parsers | open standard | GDACS, IMD, SACHET-compatible |
| **Telecom / power heartbeat** | REST poller | ours | Simulated in demo (see `plan.md` §9.1) |
| **Internet outage** | **CAIDA IODA API** | free API | ✅ real and live |
| **Connectivity tiles** | **Meta Data for Good** via HDX | HDX | archive pull |
| **SAR** | `sentinelhub-py` / GEE export | MIT / Apache-2.0 | Forge-side, not runtime |
| **Anything else** | `POST /api/events` | ours | Generic webhook. The escape hatch |

**Replay corpora** (for the demo and for fitting likelihood ratios):
**CrisisNLP**, **HumAID**, **CrisisBench**, **TREC-IS** — real labelled crisis messages from real events.

> **Do not run RapidPro or Chatwoot as an omnichannel hub.** Both are proven and both would work, but
> each costs the better part of a day in Django/Rails orchestration for capability you can get from
> five 50-line adapters. Revisit only for a real deployment.

---

## S1 · Normalise

| Job | Tool | Licence |
|---|---|---|
| Fix mojibake, broken encodings | **ftfy** | MIT |
| Unicode NFC, zero-width strip | `unicodedata` | stdlib |
| Indic script normalisation | **indic-nlp-library** | MIT |
| Language identification | **fastText `lid.176`** | MIT |

Output: clean `text_orig` + `lang`. Cheap, and it prevents an entire class of downstream silent
failure (a Devanagari string that fuzzy-matches nothing because of a stray ZWJ).

---

## S2 · Transcribe

| Tool | Licence | Use |
|---|---|---|
| **faster-whisper** (CTranslate2) | MIT | Default. 4× faster than reference Whisper, CPU-viable |
| **AI4Bharat IndicWhisper** | MIT *(verify)* | **Preferred for Indian languages** — Whisper fine-tuned on Indic speech, substantially better than vanilla on Hindi/Malayalam/Tamil |
| **WhisperX** | BSD-4 | Only if you need word timestamps or diarisation on a multi-speaker HAM net |

**Practical notes for satphone audio.** It is 8 kHz, clipped, half-duplex and often unintelligible.
- Set a **confidence floor**; below it, keep the audio and mark `text: null, needs_human: true` rather
  than emitting a hallucinated transcript.
- **Whisper hallucinates on silence.** Run a VAD (`silero-vad`, MIT) first and drop empty segments.
  Without this, you will get fluent invented sentences from static — and they will move your beliefs.

---

## S3 · Translate

| Tool | Licence | Coverage |
|---|---|---|
| **AI4Bharat IndicTrans2** | MIT | **All 22 scheduled Indian languages** → English. The distilled 200M checkpoint is the right size for a laptop |

Translate to `text_en` for classification and extraction; **keep `text_orig` forever**. Every
downstream display shows the original with the translation beneath it.

---

## S4 · Classify

| Tool | Licence | Job |
|---|---|---|
| **CrisisTransformers** (`huggingface.co/crisistransformers`) | *verify* | Pretrained on **15B+ tokens from 30+ real crisis events**. Beats general-purpose transformers on every crisis classification benchmark |
| **HumAID / CrisisBench** | research use | **The label taxonomy** — `infrastructure_damage`, `rescue_volunteering_or_donation_effort`, `injured_or_dead_people`, `caution_and_advice`, … |

**Adopt the HumAID taxonomy verbatim. Do not invent your own categories.** It is standard, it is
defensible in front of a panel, and it comes with labelled training data if you want a classifier
baseline instead of an LLM.

---

## S5 · Extract

Turn free text into a strict record. **The critical architectural constraint:**

> **The LLM extracts and structures. It NEVER assigns severity.**
> Severity is produced by the Bayesian engine so it stays explainable, calibrated and auditable.
> Say this out loud in the pitch — it pre-empts "you just wrapped an LLM."

| Tool | Licence | Job |
|---|---|---|
| **Outlines** | Apache-2.0 | **Grammar-constrained generation — the model physically cannot emit invalid JSON** |
| **Instructor** | MIT | Alternative: Pydantic-typed LLM outputs with retries |
| **spaCy** (+ `stanza` for Indic) | MIT / Apache-2.0 | Fallback classical NER if no LLM is available offline |

Schema is deliberately narrow — five fields, all enums or strings:

```python
class Extraction(BaseModel):
    location_surface: str | None      # verbatim place string as written
    hazard: Literal["flood","landslide","quake","cyclone","fire","other","unknown"]
    severity_hint: Literal["none","minor","moderate","severe","catastrophic","unknown"]
    subjects: list[Literal["people_trapped","injured","dead","displaced",
                           "buildings","road","bridge","embankment","power","water"]]
    is_firsthand: bool                # "I saw" vs "I heard that"
```

`is_firsthand` is small and does real work: second-hand reports feed the cascade detector and get a
lower independent-source weight in S7.

---

## S6 · Locate — the hard part

**This is where projects die.** `Bhimsar / Bheemsar / भीमसर / Bheemsarr` must all resolve to `BH-042`,
and India has ~660,000 villages with heavy name reuse.

### The trick that makes it tractable

> **We already know the district.** That collapses the candidate set from ~660,000 villages to ~214.
>
> Ambiguity essentially disappears. This is why we do **not** need Mordecai3 + Elasticsearch, and why a
> problem that is genuinely hard at national scale is easy at district scale.

### The chain

| Step | Tool | Licence | Job |
|---|---|---|---|
| 1 · Address normalisation | **libpostal** | MIT | Splits and normalises messy place strings. Extremely proven |
| 2 · Script unification | **AI4Bharat IndicXlit** | MIT | Native ⇄ Roman for **21 Indic languages**. `भीमसर` → `bhimsar` |
| 3 · Gazetteer | **LGD** village directory + **GeoNames** | free | ~660k Indian villages with official codes; **filtered to the district** |
| 4 · Candidate scoring | **rapidfuzz** | MIT | Token-set ratio + partial ratio over the 214 candidates |
| 5 · Phonetic backstop | **jellyfish** / **abydos** | MIT / GPL-3 | Soundex/Metaphone on the romanised form for heard-not-read spellings |
| 6 · Index | **SQLite FTS5** or **DuckDB** | public domain / MIT | Trigram index. No Elasticsearch, no separate service |
| 7 · Structured fallback | **Nominatim** | GPL-2 | Only when the surface form looks like a full address |
| 8 · National scale *(optional)* | **Mordecai3** | MIT | Neural geoparser + GeoNames. **Needs Elasticsearch — skip it unless you go national** |

### Confidence, and the queue that catches failures

```python
geo_confidence = 0.55*fuzzy + 0.20*phonetic + 0.15*context_prior + 0.10*source_prior
```
- `context_prior`: settlements already active in this event score higher
- `source_prior`: a HAM operator in Kolang block probably means a Kolang village

**Below 0.5 → the disambiguation queue**, surfaced in the UI as a one-click resolve. Do not silently
guess. A wrong geocode sends a boat to the wrong place, which is the exact failure the whole product
exists to prevent.

---

## S7 · Dedupe — rumour-cascade collapse

**Forty forwards of one video is ONE observation.** Without this, whatever goes viral hijacks the
model — precisely the "social media panic" failure in the problem statement.

### Four-stage cascade, cheapest first

| Stage | Tool | Licence | Catches |
|---|---|---|---|
| A · Exact | `blake2b` of normalised text | stdlib | Verbatim forwards |
| B · Near-dup text | **datasketch** MinHash-LSH (shingles, threshold 0.8) | MIT | Lightly edited forwards. Scales to millions |
| C · Semantic | **sentence-transformers** — `LaBSE` or `multilingual-e5-small` | Apache-2.0 | Paraphrases and **the same claim in a different language** |
| D · Media | **imagededup** (pHash/dHash) + keyframe extraction for video | Apache-2.0 | The same photo or video reposted |

Then: **union-find** over the four similarity graphs → one cluster per real-world claim.

- `cascade_root` = **earliest** observation in the cluster
- `cascade_size` = raw message count (metadata only)
- **`independent_sources` = number of distinct `source_id`s with distinct channels** ← *this* is what
  feeds evidence weight

### The nuance that makes it correct

> Forty forwards from forty phones are **not** forty pieces of evidence — but they are also not
> exactly one. Three people who *independently witnessed* the same breach genuinely is stronger
> evidence than one.
>
> So: **weight by `independent_sources`, never by `cascade_size`.** Independence is estimated from
> source diversity, channel diversity, and the `is_firsthand` flag from S5. A cascade of 200 forwards
> with 1 independent first-hand source contributes exactly as much as that one source.

---

## S8 · Trust

Ours, ~40 lines. Beta posterior per `source_id`:

```python
reliability = alpha / (alpha + beta)          # Beta(α, β), init Beta(1,1)
```

- Verification returns ground truth → `alpha += 1` (confirmed) or `beta += 1` (contradicted)
- Channel priors seed it: ODK form from a trained volunteer starts higher than an anonymous forward
- **Persists across events** — "Cyclone Remal taught it; Wayanad used it"

Ushahidi does this step **by hand**. Making it a number that updates itself is a genuine improvement
over the incumbent, and it costs almost nothing.

---

## S9 · Emit evidence

The bridge into the belief engine. `core/likelihoods.py` converts an Observation into one or more
`Evidence` rows:

```python
Evidence(
  settlement_id    = obs.geo.settlement_id,
  channel          = obs.channel,
  failure_mode     = map_hazard(obs.hazard),
  log_lr           = log(lr_for(obs)),        # reliability- and independence-weighted
  correlation_group= "human_report",          # for the damping in core/belief.py
  ts               = obs.ts,
  raw_ref          = obs.obs_id               # → the evidence receipt
)
```

`correlation_group` is what stops correlated channels double-counting. Human reports, telecom
silence and SAR coherence each get their own group, and `core/belief.py` damps within groups.

---

## 13. Offline footprint

**Everything must run on a laptop with the cable pulled.** Budget it up front and pick small variants.

| Model | Variant | Size | Notes |
|---|---|---|---|
| faster-whisper | `small` int8 | ~500 MB | `medium` only if a GPU is present |
| IndicWhisper | fine-tuned | ~1.5 GB | Swap in for Indic audio |
| fastText `lid.176` | compressed | . 1 MB | Trivial |
| IndicTrans2 | distilled 200M | ~800 MB | Not the 1B — it will not be worth the RAM |
| CrisisTransformers | base | ~500 MB | |
| Sentence encoder | `multilingual-e5-small` | ~470 MB | Prefer over LaBSE (~1.8 GB) unless recall demands it |
| IndicXlit | 11M | ~50 MB | |
| libpostal data | — | ~2 GB | ⚠️ **the biggest single item.** Drop it if space is tight — rapidfuzz + IndicXlit covers most village-name cases |
| spaCy `en_core_web_sm` | — | ~15 MB | |

**Realistic total: ~4 GB with libpostal, ~2 GB without.** Ship a `models/` directory alongside
`district_package/`; nothing is downloaded at runtime, ever.

---

## 14. Module layout

```
ingest/
├── envelope.py            the Observation dataclass + validation
├── connectors/
│   ├── sms_gammu.py  telegram.py  whatsapp_export.py  odk.py
│   ├── voice_drop.py  email_imap.py  cap_feed.py  webhook.py
│   └── machine/  ioda.py  telecom.py  power.py  sar.py
├── s1_normalise.py        ftfy · unicodedata · indic-nlp · fasttext
├── s2_transcribe.py       silero-vad → faster-whisper / IndicWhisper
├── s3_translate.py        IndicTrans2
├── s4_classify.py         CrisisTransformers → HumAID taxonomy
├── s5_extract.py          Outlines-constrained JSON
├── s6_locate/
│   ├── gazetteer.py       LGD + GeoNames → SQLite FTS5, district-filtered
│   ├── translit.py        IndicXlit
│   └── match.py           libpostal · rapidfuzz · phonetic · scoring
├── s7_dedupe.py           blake2b · datasketch · sentence-transformers · imagededup
├── s8_trust.py            Beta posteriors
└── pipeline.py            the one function everything calls
```

```python
# pipeline.py — the whole ingest layer in one signature
def process(raw: RawEvent) -> list[Evidence]:
    obs = envelope.wrap(raw)
    if obs.is_machine:                       # telecom | power | sar | ioda
        return likelihoods.from_machine(obs)
    obs = s1.normalise(obs)
    obs = s2.transcribe(obs)   if obs.raw.audio else obs
    obs = s3.translate(obs)    if obs.lang != "en" else obs
    obs = s4.classify(obs)
    obs = s5.extract(obs)
    obs = s6.locate(obs)
    if obs.geo.confidence < 0.5:
        queue.disambiguate(obs); return []   # never guess a location
    obs = s7.dedupe(obs)
    if obs.cascade.root_id != obs.obs_id:
        s7.merge_into_root(obs); return []   # a forward adds no new evidence row
    obs = s8.trust(obs)
    return likelihoods.from_human(obs)
```

**Every stage is idempotent and independently testable.** A stage that fails returns the Observation
unchanged with a `chain` entry recording the failure — the pipeline degrades, it never drops data.

---

## 15. Licence register

⚠️ **Verify each against the repo's `LICENSE` before submission.**

| Component | Licence | Copyleft risk |
|---|---|---|
| faster-whisper, IndicTrans2, IndicXlit, Telethon, rapidfuzz, libpostal, jellyfish, datasketch, ftfy, indic-nlp-library, fastText, silero-vad, Mordecai3 | MIT | none |
| ODK Central, Outlines, sentence-transformers, imagededup, spaCy, stanza | Apache-2.0 | none |
| SQLite | public domain | none |
| **gammu-smsd** | **GPL-2** | ⚠️ separate process — invoke over the spool dir, do not link |
| **Nominatim** | **GPL-2** | ⚠️ separate service |
| **abydos** | **GPL-3** | ⚠️ prefer `jellyfish` (MIT) instead |
| CrisisTransformers, IndicWhisper | *verify* | model weights may carry separate terms |
| HumAID / CrisisNLP / CrisisBench | research use | ⚠️ fine for a hackathon; check before any commercial path |

**Standing decision from `plan.md`: SETU ships GPL-3.** CLIMADA and RA2CE already put you there.
For a government hackathon copyleft is a positive — it signals the work stays public and adoptable
without vendor lock-in. Stop optimising around it.

---

## 16. What we deliberately do NOT use

| Rejected | Why |
|---|---|
| **RapidPro / Chatwoot** as an omnichannel hub | Proven, but a day of Django/Rails orchestration for what five 50-line adapters give you |
| **KoboToolbox** self-hosted | kpi + kobocat + Enketo + Redis + Celery. **ODK Central is the same XLSForm standard in one container** |
| **Mordecai3 + Elasticsearch** | Excellent at national scale. At district scale the spatial prior already solved the problem — don't run a search cluster for 214 candidates |
| **Ushahidi platform** | Take the report *schema*, not the PHP |
| **X/Twitter API** | Paid, rate-limited, and unusable in an offline demo. Use the archived crisis corpora |
| **Unofficial WhatsApp libraries** (Baileys etc.) | Ban risk, ToS risk, unreliable on stage. Parse exports |
| **A custom-trained classifier** | CrisisTransformers is pretrained on 15B tokens from 30+ real crisis events. You will not beat it in 48 hours |

---

## 17. Build order

| # | Task | Hrs | Milestone |
|---|---|---|---|
| 1 | `envelope.py` + `pipeline.py` skeleton + webhook connector | 2 | An event can enter the system |
| 2 | **S6 locate** — LGD gazetteer, district filter, rapidfuzz | 4 | **Text names resolve to settlement IDs.** Unblocks everything |
| 3 | S5 extract with Outlines | 3 | Free text → structured claim |
| 4 | S9 emit + wire to `core/belief.py` | 2 | **A report visibly moves a belief** |
| 5 | S7 dedupe, stages A + B | 3 | Rumour cascades collapse |
| 6 | Machine connectors — IODA, telecom, SAR | 3 | **The anti-report channels — the differentiator** |
| 7 | S1 normalise + S3 translate | 3 | Indic text works |
| 8 | S2 transcribe + VAD + file-drop | 3 | **The satphone fragment demo** |
| 9 | S8 trust posteriors | 2 | Contradictions get discounted |
| 10 | S4 classify | 2 | HumAID taxonomy on screen |
| 11 | S7 stages C + D (semantic + media) | 3 | Cross-language and reposted-video dedupe |
| 12 | Remaining connectors — ODK, Telegram, SMS, email, CAP | 4 | Breadth for the pitch |

**Critical path: 1 → 2 → 3 → 4.** About 11 hours to "a report changes a dispatch decision."

**If short on time, build 6 before 7–12.** The machine channels are what make SETU different from
every report-driven system ever built; another chat connector is not.

---

*Connectors are disposable. The envelope and the pipeline are the product.*
