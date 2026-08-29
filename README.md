# SETU Engine

SETU is an offline-first disaster severity and triage backend. It fuses reports, telecom/power
telemetry, SAR observations, and verification returns into auditable settlement-level Bayesian
beliefs, then produces an asset-typed dispatch plan and a Value-of-Information verification queue.

The repository ships a complete runtime backend, three reproducible historical Wayanad scenarios
(2018 floods, 2019 floods/Puthumala landslide, and the 2024 Meppadi landslide), plus a deterministic
synthetic stress-test package. Official boundaries, Census demographics, and KSDMA memoranda are
checksum-pinned in `data/source_manifest.json`. Unavailable historical telecom and power streams
are never represented as observations; any such test events remain explicitly `synthetic`.

## Quick start

```powershell
uv sync --extra test
uv run python -m scripts.forge.fetch_sources --verify-only
uv run python -m scripts.forge.run_all
uv run python -m engine.cli serve
```

Open [http://localhost:8000/docs](http://localhost:8000/docs) for the live OpenAPI explorer. The
default frontend origins are `http://localhost:3000` and `http://localhost:5173`.

Run verification:

```powershell
uv run pytest
```

Docker is also supported:

```powershell
docker compose up --build
```

## Runtime contract

- scenario catalog/switching through `GET /api/scenarios` and `POST /api/scenario`
- `GET /api/district`, `/api/settlements`, `/api/state`, and settlement evidence receipts
- official GeoJSON and time-aligned visualization layers through `/api/layers` and `/api/timeline`
- replay `play`, `pause`, `seek`, `speed`, and `reset`
- live observations through `POST /api/events` and 5,000-item `/api/events/batch`
- red-team injection, verification returns, and human overrides
- Server-Sent Events at `GET /api/stream`
- hash-chained decisions and synthetic-data disclosure
- PDF dispatch and CAP 1.2-compatible XML exports
- byte-range-compatible static tile serving and binary twin-state frames

The framework-neutral TypeScript client is [frontend-sdk/setu-api.ts](frontend-sdk/setu-api.ts).
See [docs/FRONTEND_INTEGRATION.md](docs/FRONTEND_INTEGRATION.md) for the integration sequence.

## Operational caveat

Likelihood ratios in `core/likelihoods.py` are the seed values specified by `MASTER_PLAN.md`. They
must be fitted and calibrated on held-out events before operational deployment. `/api/metrics`
states this explicitly instead of fabricating calibration scores.

## Licence

GPL-3.0-only. External production Forge components and model weights retain their own terms and
must be verified before distribution, as required by `MASTER_PLAN.md`.
