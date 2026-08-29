/** Framework-agnostic frontend client for the SETU Engine API. */
export type FailureMode = "INUNDATION" | "COLLAPSE" | "CASUALTY" | "LANDSLIDE" | "WIND";
export type Provenance = "archived" | "synthetic" | "live";

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
  asset_kind: "boat" | "excavator" | "medical"; failure_mode: FailureMode;
  seq: number; eta_minutes: number; expected_lives_saved: number;
  expected_harm: number; access_mode: string; state: string;
}

export interface EngineState {
  t: string; clock: {t: string; start: string; end: string; playing: boolean; speed: number};
  beliefs: Belief[]; plan: DispatchTask[]; verify: Array<Record<string, unknown>>;
  pre_positions: Record<string, unknown>; log: Record<string, unknown>; provenance: Record<string, string>;
}

export interface ScenarioSummary { id: string; name: string; historical: boolean; active: boolean; replay: {t0: string; t1: string}; provenance: Record<string, string>; }
export interface LayerSummary { id: string; format: "geojson" | "json"; path: string; provenance: string; }
export interface TwinManifest { encoding: string; settlement_order: string[]; timestamps: string[]; frame_count: number; bytes_per_frame: number; }

export class SetuApi {
  constructor(readonly baseUrl = "http://localhost:8000") {}
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {headers: {"Content-Type": "application/json", ...init?.headers}, ...init});
    if (!response.ok) throw new Error(`SETU API ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }
  district() { return this.request<Record<string, unknown>>("/api/district"); }
  scenarios() { return this.request<ScenarioSummary[]>("/api/scenarios"); }
  selectScenario(id: string) { return this.request<{selected: string; reconnect_stream: boolean; state: EngineState}>("/api/scenario", {method: "POST", body: JSON.stringify({id})}); }
  layers() { return this.request<{layers: LayerSummary[]}>("/api/layers"); }
  layer<T = Record<string, unknown>>(id: string) { return this.request<T>(`/api/layers/${encodeURIComponent(id)}`); }
  timeline() { return this.request<TwinManifest>("/api/timeline"); }
  async twinFrame(at?: string) { const response = await fetch(`${this.baseUrl}/api/twin/states${at ? `?t=${encodeURIComponent(at)}` : ""}`); if (!response.ok) throw new Error(`SETU API ${response.status}`); return {values: new Uint8Array(await response.arrayBuffer()), frame: Number(response.headers.get("X-Setu-Frame") ?? 0)}; }
  settlements() { return this.request<Array<Record<string, unknown>>>("/api/settlements"); }
  state(at?: string) { return this.request<EngineState>(`/api/state${at ? `?t=${encodeURIComponent(at)}` : ""}`); }
  receipt(settlementId: string, at?: string) { return this.request<Record<string, unknown>>(`/api/settlement/${encodeURIComponent(settlementId)}/receipt${at ? `?t=${encodeURIComponent(at)}` : ""}`); }
  route(settlementId: string, assetKind: "boat" | "excavator" | "medical") { return this.request<Record<string, unknown>>(`/api/routes/${encodeURIComponent(settlementId)}?asset_kind=${assetKind}`); }
  clock(action: "play" | "pause" | "seek" | "speed" | "reset", options: {t?: string; speed?: number} = {}) { return this.request<{state: EngineState}>("/api/clock", {method: "POST", body: JSON.stringify({action, ...options})}); }
  event(payload: Record<string, unknown>) { return this.request("/api/events", {method: "POST", body: JSON.stringify(payload)}); }
  disambiguation() { return this.request<Array<Record<string, unknown>>>("/api/disambiguation"); }
  resolveLocation(obsId: string, settlementId: string, actor: string) { return this.request(`/api/disambiguation/${encodeURIComponent(obsId)}/resolve`, {method: "POST", body: JSON.stringify({settlement_id: settlementId, actor})}); }
  inject(attack: "false_reports" | "kill_sar" | "cut_edge" | "silence", params: Record<string, unknown> = {}) { return this.request("/api/inject", {method: "POST", body: JSON.stringify({attack, params})}); }
  stream(onState: (state: EngineState) => void) { const source = new EventSource(`${this.baseUrl}/api/stream`); source.addEventListener("state", event => onState(JSON.parse((event as MessageEvent).data))); return source; }
}
