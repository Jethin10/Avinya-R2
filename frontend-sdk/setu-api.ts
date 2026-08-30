/** Framework-agnostic frontend client for the SETU Engine API. */
export type FailureMode = "INUNDATION" | "COLLAPSE" | "CASUALTY" | "LANDSLIDE" | "WIND";
export type Provenance = "archived" | "synthetic" | "live";
export type AssetKind = "boat" | "excavator" | "medical";

export interface Belief {
  settlement_id: string;
  failure_mode: FailureMode;
  probability: number;
  log_odds: number;
  variance: number;
  confidence: number;
}

export interface DispatchTask {
  id: string; settlement_id: string; settlement_name: string; asset_id: string;
  asset_kind: AssetKind; failure_mode: FailureMode;
  seq: number; eta_minutes: number; expected_lives_saved: number;
  expected_harm: number; access_mode: string; state: string;
}

export interface VerifyTask {
  id: string; settlement_id: string; action: string; minutes: number;
  voi_score: number; resolves: string; state: string;
}

export interface Settlement {
  id: string; lgd_code: string; name: string; name_variants: string[];
  block: string; tehsil: string; location: {type: "Point"; coordinates: [number, number]};
  population: number; elderly_frac: number; pct_sc_st: number; pct_kutcha: number; pct_pucca: number;
  fragility_class: string; elevation_m: number; slope_deg: number; hand_m: number;
  road_hours_normal: number; nearest_phc_id: string; observability: number;
  geometry: {type: string; coordinates: number[][][]}; provenance: Provenance;
}

export interface EvidenceRow {
  id: number; settlement_id: string; channel: string; failure_mode: FailureMode;
  log_lr: number; lr: number; correlation_group: string; ts: string;
  raw_ref: string | null; superseded: boolean;
}

export interface Receipt {
  settlement: Settlement;
  t: string;
  prior: Array<{failure_mode: FailureMode; probability: number; variance: number}>;
  evidence: EvidenceRow[];
  posterior: Belief[];
}

export interface CoverageRow {
  settlement_id: string; messages: number; claims: number; independent_sources: number;
  evidence_rows: number; channels: number; observability: number | null;
}

export interface Coverage {
  totals: {
    messages_ingested: number; messages_located: number; distinct_claims: number;
    unresolved_locations: number; evidence_rows: number; settlements: number;
    settlements_with_reports: number; settlements_without_reports: number;
  };
  settlements: CoverageRow[];
  without_reports: string[];
}

export interface Metrics {
  calibration: {status: string; ece: number; curve: Array<{lower: number; upper: number; count: number; confidence: number; accuracy: number}>};
  operational: {
    top_k: number; top_k_recall: number; silent_zone_recall: number; silent_severe_count: number;
    asset_type_accuracy: number | null; time_to_first_correct_dispatch_minutes: number | null;
    asset_hours_misallocated: number | null; asset_hours_status: string;
  };
  equity: {district_mean_priority: number; disadvantaged_mean_priority: number; gap: number};
  robustness: {injected_events: number; disabled_channels: string[]; top10_rank_displacement?: number; affected_top10?: number};
  audit: {hash_chain_valid: boolean; entries: number};
  disclosure: string;
}

export interface DecisionEntry {
  id: number; sim_t: string; belief_hash: string; prev_hash: string; entry_hash: string;
  payload?: Record<string, unknown>;
}

export interface DisambiguationItem {
  obs_id: string; created_at: string; state: string;
  payload: {text_en?: string; text_orig?: string; channel?: string; source_id?: string; geo_surface?: string; geo_confidence?: number; severity_hint?: string; [key: string]: unknown};
}

export interface EngineState {
  t: string; clock: {t: string; start: string; end: string; playing: boolean; speed: number};
  beliefs: Belief[]; plan: DispatchTask[]; verify: VerifyTask[];
  pre_positions: Record<string, {probability: number; eta_minutes: number; source: string}>;
  log: DecisionEntry; provenance: Record<string, string>;
}

export interface ScenarioSummary { id: string; name: string; historical: boolean; active: boolean; replay: {t0: string; t1: string}; provenance: Record<string, string>; }
export interface LayerSummary { id: string; format: "geojson" | "json"; path: string; provenance: string; }
export interface TwinManifest { encoding: string; settlement_order: string[]; timestamps: string[]; frame_count: number; bytes_per_frame: number; }
export interface DistrictMeta {
  id: string; name: string; bbox: [number, number, number, number]; timezone: string;
  historical: boolean; replay: {t0: string; t1: string};
  provenance: Record<string, string>; counts: Record<string, number>;
  event_streams?: Record<string, unknown>;
}

export class SetuApi {
  constructor(readonly baseUrl = "http://localhost:8000") {}
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {headers: {"Content-Type": "application/json", ...init?.headers}, ...init});
    if (!response.ok) throw new Error(`SETU API ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }
  district() { return this.request<DistrictMeta>("/api/district"); }
  scenarios() { return this.request<ScenarioSummary[]>("/api/scenarios"); }
  selectScenario(id: string) { return this.request<{selected: string; reconnect_stream: boolean; state: EngineState}>("/api/scenario", {method: "POST", body: JSON.stringify({id})}); }
  layers() { return this.request<{layers: LayerSummary[]}>("/api/layers"); }
  layer<T = Record<string, unknown>>(id: string) { return this.request<T>(`/api/layers/${encodeURIComponent(id)}`); }
  timeline() { return this.request<TwinManifest>("/api/timeline"); }
  async twinFrame(at?: string) { const response = await fetch(`${this.baseUrl}/api/twin/states${at ? `?t=${encodeURIComponent(at)}` : ""}`); if (!response.ok) throw new Error(`SETU API ${response.status}`); return {values: new Uint8Array(await response.arrayBuffer()), frame: Number(response.headers.get("X-Setu-Frame") ?? 0)}; }
  settlements() { return this.request<Settlement[]>("/api/settlements"); }
  state(at?: string) { return this.request<EngineState>(`/api/state${at ? `?t=${encodeURIComponent(at)}` : ""}`); }
  receipt(settlementId: string, at?: string) { return this.request<Receipt>(`/api/settlement/${encodeURIComponent(settlementId)}/receipt${at ? `?t=${encodeURIComponent(at)}` : ""}`); }
  coverage() { return this.request<Coverage>("/api/coverage"); }
  metrics() { return this.request<Metrics>("/api/metrics"); }
  decisions(since = 0) { return this.request<DecisionEntry[]>(`/api/decisions?since=${since}`); }
  route(settlementId: string, assetKind: AssetKind) { return this.request<Record<string, unknown>>(`/api/routes/${encodeURIComponent(settlementId)}?asset_kind=${assetKind}`); }
  clock(action: "play" | "pause" | "seek" | "speed" | "reset", options: {t?: string; speed?: number} = {}) { return this.request<{state: EngineState}>("/api/clock", {method: "POST", body: JSON.stringify({action, ...options})}); }
  event(payload: Record<string, unknown>) { return this.request<{obs_id: string; evidence_emitted: number}>("/api/events", {method: "POST", body: JSON.stringify(payload)}); }
  verify(verificationId: string, result: string, actor: string) { return this.request<Record<string, unknown>>(`/api/verify/${encodeURIComponent(verificationId)}`, {method: "POST", body: JSON.stringify({result, actor})}); }
  disambiguation() { return this.request<DisambiguationItem[]>("/api/disambiguation"); }
  resolveLocation(obsId: string, settlementId: string, actor: string) { return this.request(`/api/disambiguation/${encodeURIComponent(obsId)}/resolve`, {method: "POST", body: JSON.stringify({settlement_id: settlementId, actor})}); }
  inject(attack: "false_reports" | "kill_sar" | "cut_edge" | "silence", params: Record<string, unknown> = {}) { return this.request<{applied: boolean; [key: string]: unknown}>("/api/inject", {method: "POST", body: JSON.stringify({attack, params})}); }
  stream(onState: (state: EngineState) => void) { const source = new EventSource(`${this.baseUrl}/api/stream`); source.addEventListener("state", event => onState(JSON.parse((event as MessageEvent).data))); return source; }
}
