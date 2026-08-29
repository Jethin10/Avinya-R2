# Frontend integration

The frontend needs one initial snapshot and one live stream. No backend package or database code
belongs in the browser.

1. Fetch `GET /api/scenarios`; select a replay with `POST /api/scenario` when needed and reconnect SSE.
2. Fetch `GET /api/district`, `/api/settlements`, `/api/layers`, and `/api/timeline`. Cache polygon layers by scenario.
3. Fetch `GET /api/state` for the initial timeline, beliefs, plan, and verification queue.
4. Subscribe to `GET /api/stream` with `EventSource`; replace the current state on each `state` event.
5. Use `POST /api/clock` for the shared timeline. A seek returns the fully recomputed snapshot.
6. Fetch `/api/settlement/{id}/receipt` when the operator selects a settlement.
7. Render the visible provenance disclosure from `state.provenance` and layer provenance on every operational screen.

`frontend-sdk/setu-api.ts` implements this flow without React-specific dependencies:

```ts
import { SetuApi } from "./setu-api";

const api = new SetuApi(import.meta.env.VITE_SETU_API_URL ?? "http://localhost:8000");
const [district, settlements, state] = await Promise.all([
  api.district(), api.settlements(), api.state(),
]);
const stream = api.stream(nextState => render(nextState));
```

The server allows Vite (`5173`) and common React dev (`3000`) origins by default. Override this with
`SETU_ALLOWED_ORIGINS`, as a comma-separated list. The API rejects invalid controls with standard
FastAPI `422` errors and unknown resources with `404`.

## Event payloads

All incoming observations require provenance:

```json
{
  "kind": "report",
  "channel": "ham",
  "source_id": "HAM-VU2XYZ",
  "provenance": "live",
  "text": "I saw severe flooding in Kharsa, people trapped",
  "hazard": "flood",
  "severity_hint": "severe",
  "is_firsthand": true
}
```

Machine channels use `settlement_id` and their measurements. A telecom example:

```json
{
  "kind": "telemetry",
  "channel": "telecom",
  "source_id": "telco-aggregate",
  "provenance": "synthetic",
  "settlement_id": "BH-042",
  "observed": 0,
  "expected": 380,
  "params": {"minutes_to_drop": 10, "sustained_hours": 3}
}
```

## Binary twin state

`GET /api/twin/states?t=...` returns one byte per settlement for the nearest historical frame.
`GET /api/timeline` provides exact timestamps and settlement order. `X-Setu-Frame`,
`X-Setu-Offset`, and `X-Setu-Count` expose the selected frame slice.

## Historical data boundaries

Village polygons are Survey of India data and population/household/SC/ST values are from Census
2011 PCA. KSDMA memoranda provide event timing and impact facts. Derived hazard frames are intended
for animation and say so in their provenance. They are not measured flood depths. Historical
settlement-level telecom and feeder telemetry is not in the public bundle; simulated outage inputs
must use `provenance: "synthetic"`.
