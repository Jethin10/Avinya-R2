# Backend architecture

The backend preserves the master plan's Forge/Engine split.

- The Forge (`scripts/forge/run_all.py`) writes immutable district artifacts. The included adapter
  emits a deterministic synthetic package for offline development and testing.
- The Engine is one FastAPI process with SQLite WAL persistence. It performs no outbound network
  calls. Postgres/PostGIS can replace persistence for production without changing the API contract.
- `core/` is pure decision logic and imports nothing from `engine/`.
- `ingest/` keeps original text, provenance, and processing-chain metadata; locations below 0.5
  confidence enter a disambiguation queue and emit no evidence.
- `engine/runtime.py` replays observations, fuses evidence, propagates cascade risk, produces typed
  dispatch and VoI queues, checkpoints belief snapshots, and writes a hash-chained audit record.

## Deliberate degradation

The local ingest layer uses transparent rule-based extraction because model weights are not bundled.
It does not infer severity; it only structures supplied/lexical hints, which are translated to
likelihood ratios by `core/likelihoods.py`. Production ASR, translation, classification, and constrained
extraction adapters can be inserted before the same envelope without changing downstream logic.

Dead or unavailable sensors return a neutral likelihood ratio of 1. Missing district artifacts fail
startup with an actionable Forge command. Unknown locations are quarantined, never guessed.

