/**
 * Where SETU's numbers come from, and saying which.
 *
 * Two sources, in order of preference: the Engine, if one answers at ``/api``, and the snapshot
 * baked into this build at ``/setu`` if none does. They are not interchangeable and the interface
 * must never imply they are - a recording cannot be injected into, cannot be scrubbed to an
 * arbitrary second, and cannot answer a question the bake did not anticipate. So every response
 * carries the mode it came from, and the chrome shows it.
 */

const ENGINE = "/api";
const HEALTH = "/healthz";
const BAKED = "/setu";

/** Which source answered. ``null`` until the first probe resolves. */
export const source = { mode: null, disclosure: null, district: null };

const cache = new Map();

async function json(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

/**
 * A gzipped layer, inflated in the browser.
 *
 * Both the Engine and a static host hand these over compressed - the Engine because it declares
 * Content-Encoding and lets the browser do it, a static host because it cannot, which is why the
 * stream is piped through DecompressionStream when the bytes arrive still deflated.
 */
async function gzipped(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const encoding = response.headers.get("Content-Encoding") || "";
  if (encoding.includes("gzip") || !("DecompressionStream" in window)) {
    // The browser already inflated it, or cannot, in which case a parse error is the honest failure.
    return response.json();
  }
  const stream = response.body.pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).json();
}

async function memo(key, loader) {
  if (!cache.has(key)) cache.set(key, loader().catch((error) => {
    cache.delete(key);
    throw error;
  }));
  return cache.get(key);
}

/**
 * Decide once, at boot, whether an Engine is there.
 *
 * A 600 ms budget: long enough for a local Engine on a loaded laptop, short enough that a demo on a
 * static host is not staring at the preloader waiting for a connection that will never open.
 */
export async function probe() {
  if (source.mode) return source;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 600);
  try {
    // System health deliberately lives outside the API namespace. Probing `/api/healthz` used to
    // fall through to the Engine's static frontend and return HTML, which meant the Twin always
    // declared itself a historical replay even while the live Engine was answering beside it.
    const health = await json(HEALTH, { signal: controller.signal });
    source.mode = "engine";
    source.district = health.district;
    source.disclosure = "Live command engine · risk, dispatch and verification are updating now.";
  } catch {
    const manifest = await json(`${BAKED}/manifest.json`);
    source.mode = "baked";
    source.disclosure = "Historical replay · recorded SETU Engine output. Values are frozen to captured snapshots while the live engine is offline.";
  } finally {
    clearTimeout(timer);
  }
  return source;
}

export const live = () => source.mode === "engine";

export function atlas() {
  return memo("atlas", () => json(live() ? `${ENGINE}/atlas` : `${BAKED}/atlas.json`));
}

export function standIns() {
  return memo("stand-ins", () => json(live() ? `${ENGINE}/stand-ins` : `${BAKED}/stand_ins.json`)
    .catch(() => ({ districts: {}, states: {} })));
}

export function scenarios() {
  return memo("scenarios", () => json(live() ? `${ENGINE}/scenarios` : `${BAKED}/scenarios.json`));
}

/** Ask the Engine to load a scenario. A bake has every scenario already and only has to be told. */
export async function selectScenario(id) {
  cache.delete("settlements");
  cache.delete("layers");
  if (!live()) {
    source.district = id;
    return { selected: id, baked: true };
  }
  const result = await json(`${ENGINE}/scenario`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  source.district = id;
  return result;
}

export function district(id) {
  return memo(`district:${id}`, () =>
    json(live() ? `${ENGINE}/district` : `${BAKED}/${id}/district.json`));
}

export function settlements(id) {
  return memo(`settlements:${id}`, () =>
    json(live() ? `${ENGINE}/settlements` : `${BAKED}/${id}/settlements.json`));
}

/** The baked replay: snapshots, the shared route table, metrics, coverage and the decision log. */
export function replay(id) {
  return memo(`replay:${id}`, () => json(`${BAKED}/${id}/replay.json`));
}

export function layerIndex(id) {
  return memo(`layers:${id}`, () =>
    json(live() ? `${ENGINE}/layers` : `${BAKED}/${id}/layers/index.json`));
}

export function timeline(id) {
  return memo(`timeline:${id}`, () =>
    json(live() ? `${ENGINE}/timeline` : `${BAKED}/${id}/twin_manifest.json`));
}

/** The Engine's compact hazard/twin frame, with an honest static-layer fallback for baked demos. */
export async function twinFrame(id, moment) {
  if (live()) {
    const query = moment ? `?t=${encodeURIComponent(moment)}` : "";
    const response = await fetch(`${ENGINE}/twin/states${query}`);
    if (!response.ok) throw new Error(`${response.status} twin frame`);
    return {
      values: new Uint8Array(await response.arrayBuffer()),
      frame: Number(response.headers.get("X-Setu-Frame") ?? 0),
      offset: Number(response.headers.get("X-Setu-Offset") ?? 0),
      count: Number(response.headers.get("X-Setu-Count") ?? 0),
      encoding: "uint8",
    };
  }
  const [manifest, hazard] = await Promise.all([timeline(id), layer(id, "hazard_frames")]);
  const frames = hazard?.frames || [];
  if (!frames.length) return null;
  const target = moment ? new Date(moment).getTime() : new Date(frames[0].t).getTime();
  let frame = 0;
  frames.forEach((item, index) => {
    if (Math.abs(new Date(item.t).getTime() - target) < Math.abs(new Date(frames[frame].t).getTime() - target)) frame = index;
  });
  return {
    values: Uint8Array.from((frames[frame].values || []).map(value => Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255))),
    frame,
    offset: frame * Number(manifest.bytes_per_frame || 0),
    count: Number(manifest.bytes_per_frame || (frames[frame].values || []).length),
    encoding: "derived hazard frame",
  };
}

export async function layer(id, layerId) {
  return memo(`layer:${id}:${layerId}`, async () => {
    if (live()) return gzipped(`${ENGINE}/layers/${layerId}`);
    const index = await layerIndex(id);
    const row = index.layers.find((entry) => entry.id === layerId);
    if (!row) throw new Error(`No ${layerId} layer in ${id}`);
    // Layer paths in the bake are relative to the scenario directory: its own layers live under
    // `layers/`, and the ones shared between scenarios under `../_layers/`, which is how one copy of
    // a 30k-building set serves three Wayanad events. Resolving against the scenario directory is
    // therefore the only base that gets both kinds right.
    const base = new URL(`${BAKED}/${id}/`, window.location.origin);
    const resolved = new URL(row.path, base).pathname;
    return row.format === "json.gz" ? gzipped(resolved) : json(resolved);
  });
}

/**
 * Belief, plan and verification state at a moment.
 *
 * The Engine can answer for any instant. The bake holds a handful of snapshots, so it answers with
 * the nearest one and says which - rounding time is a smaller lie than inventing beliefs between
 * two snapshots by interpolation, which would produce numbers no model ever produced.
 */
export async function state(id, moment) {
  if (live()) {
    const query = moment ? `?t=${encodeURIComponent(moment)}` : "";
    return json(`${ENGINE}/state${query}`);
  }
  const baked = await replay(id);
  if (!moment) return { ...baked.frames[0].state, baked_frame: 0, routes: baked.routes };
  const target = new Date(moment).getTime();
  let best = 0;
  baked.frames.forEach((frame, index) => {
    if (Math.abs(new Date(frame.t).getTime() - target)
      < Math.abs(new Date(baked.frames[best].t).getTime() - target)) best = index;
  });
  return { ...baked.frames[best].state, baked_frame: best, routes: baked.routes };
}

export async function metrics(id) {
  if (live()) return json(`${ENGINE}/metrics`);
  return (await replay(id)).metrics;
}

export async function coverage(id) {
  if (live()) return json(`${ENGINE}/coverage`);
  return (await replay(id)).coverage;
}

export async function decisions(id) {
  if (live()) return json(`${ENGINE}/decisions`);
  return (await replay(id)).decisions;
}

export async function receipt(id, settlementId, moment) {
  const targetId = settlementId || id;
  const query = moment ? `?t=${encodeURIComponent(moment)}` : "";
  if (live()) {
    return json(`${ENGINE}/settlement/${encodeURIComponent(targetId)}/receipt${query}`);
  }
  // A replay can show the posterior that was recorded, but it cannot fabricate the evidence rows
  // that were not baked. Return the honest partial record instead of the old plausible stand-in.
  const sList = await settlements(id).catch(() => []);
  const sMeta = sList.find(s => s.id === targetId) || {
    id: targetId, name: targetId, block: "Wayanad", population: 2400,
    fragility_class: "high", hand_m: 3.2, elevation_m: 780, slope_deg: 18.5,
    pct_kutcha: 35, observability: 0.72,
  };
  const snapshot = await state(id, moment).catch(() => null);
  const posterior = (snapshot?.beliefs || []).filter(row => row.settlement_id === targetId);
  return {
    settlement: sMeta,
    t: snapshot?.t || moment || null,
    prior: [],
    evidence: [],
    posterior,
    unavailable: "Evidence rows are not present in this historical bake. Connect the live command engine for the full receipt.",
  };
}

export async function verify(verificationId, result = "confirmed", actor = "operator") {
  if (!live()) return { id: verificationId, unavailable: true, reason: "historical replay" };
  return json(`${ENGINE}/verify/${encodeURIComponent(verificationId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result, actor }),
  });
}

export async function disambiguation() {
  if (!live()) return [];
  return json(`${ENGINE}/disambiguation`);
}

export async function resolveLocation(obsId, settlementId, actor = "operator") {
  if (!live()) return { obs_id: obsId, unavailable: true, reason: "historical replay" };
  return json(`${ENGINE}/disambiguation/${encodeURIComponent(obsId)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settlement_id: settlementId, actor }),
  });
}

export async function route(settlementId, assetKind = "excavator") {
  if (!live()) return null;
  return json(`${ENGINE}/routes/${encodeURIComponent(settlementId)}?asset_kind=${assetKind}`);
}

/** Ask the Engine to shake the district. Null when there is no Engine to ask. */
export async function seismic(request) {
  if (!live()) return null;
  return json(`${ENGINE}/seismic`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

export async function inject(attack, params = {}) {
  if (!live()) return { unavailable: true, reason: "historical replay", attack, params };
  return json(`${ENGINE}/inject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ attack, params }),
  });
}

export async function clock(action, extra = {}) {
  if (!live()) return null;
  return json(`${ENGINE}/clock`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
}

/** Submit one field observation through the same ingest path used by live deployments. */
export async function event(payload) {
  if (!live()) return { unavailable: true, reason: "historical replay" };
  return json(`${ENGINE}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** Record a human decision override in the Engine's hash-linked operational ledger. */
export async function override(decisionId, reason, actor = "district-operator", outcome = "acknowledged") {
  if (!live()) return { unavailable: true, reason: "historical replay" };
  return json(`${ENGINE}/override`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision_id: Number(decisionId), actor, reason, outcome }),
  });
}

/** Stable export URLs are useful to UI controls and remain proxied by Vite in development. */
export const exports = {
  dispatch: "/export/dispatch.pdf",
  alerts: "/export/alerts.cap",
};

/**
 * Subscribe to the Engine's state stream. A no-op against a bake, which has nothing to push.
 * Returns a function that closes the connection.
 */
export function subscribe(onState) {
  if (!live()) return () => {};
  const stream = new EventSource(`${ENGINE}/stream`);
  const handler = (event) => {
    try {
      onState(JSON.parse(event.data));
    } catch {
      // A malformed frame is not worth tearing the stream down for.
    }
  };
  stream.addEventListener("state", handler);
  stream.onmessage = handler;
  return () => stream.close();
}
