/**
 * The SETU layer, assembled.
 *
 * Three views, one WebGL context, and a strict rule about who owns what: this file owns navigation
 * and the flow of data, the scene modules own geometry, and the panels own DOM. Nothing here draws
 * and nothing there fetches.
 *
 * The journey is the one the site already implies. Its aside is a list of places; picking one flies
 * to that state and lays its districts out as a relief map; picking a district raises it out of the
 * state, drops the camera to ground level, and loads everything the engine knows about it. Coming
 * back up is the same three moves in reverse, which is why the breadcrumb is a real control and not
 * a label.
 */

import "./setu.css";
import * as client from "./client.js";
import { activate, el, mount, setScene } from "./dom.js";
import { createRail } from "./rail.js";
import { createStage } from "./stage.js";
import { buildStateScene } from "./scene-state.js";
import { buildDistrictScene } from "./scene-district.js";
import { createPanels, worstBySettlement } from "./panels.js";
import { situationForState, stateSituationOverride } from "./state-situations.js";
import { installEvidenceRouteBridge, isEvidenceRoute, mountEvidencePage } from "./evidence.js";
import { installValidatorRouteBridge, isValidatorRoute, mountValidatorPage } from "./validator.js";
import { installInferRouteBridge, isInferRoute, mountInferPage } from "./infer.js";
import { installActRouteBridge, isActRoute, mountActPage } from "./act.js";

const evidenceRoute = isEvidenceRoute();
const validatorRoute = isValidatorRoute();
const inferRoute = isInferRoute();
const actRoute = isActRoute();
const standaloneRoute = evidenceRoute || validatorRoute || inferRoute || actRoute;

const app = {
  atlas: null,
  standIns: null,
  scenarios: [],
  view: { kind: "nation" },
  scene: null,
  stage: null,
  panels: null,
  rail: null,
  /** Metres of water above nearest drainage, as the operator has set it. Zero unless asked. */
  flood: 0,
  seismicArmed: false,
  enteringDistrict: false,
  unsubscribe: null,
  lens: "fog",
  fogMode: "reports",
  settlements: [],
  current: null,
  detail: null,
  activeRouteId: null,
  overrides: [],
  dataPlane: null,
  stateSelection: null,
  stateInspectToken: 0,
  storyFocusId: null,
  storyStep: null,
  replayPlayback: {
    timer: null,
    playing: false,
    speed: 300,
    token: 0,
  },
};

/** A reload always starts at the framed landing composition. */
function resetLandingPosition() {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const resetNativeScroll = () => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  resetNativeScroll();
  window.addEventListener("pageshow", resetNativeScroll, { once: true });
  window.addEventListener("load", resetNativeScroll, { once: true });
  requestAnimationFrame(() => requestAnimationFrame(resetNativeScroll));
}

if (!standaloneRoute) resetLandingPosition();

async function selectState(state) {
  try {
    await showState(state);
  } catch (error) {
    console.error(`[setu] failed to open state ${state?.id ?? "unknown"}:`, error);
    app.panels?.setHint(`Could not open ${state?.name ?? "state"}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function selectStateDistrict(districtId) {
  if (app.view.kind !== "state" || !districtId) return;
  const entry = app.scene?.districts?.find(row => row.district.id === districtId);
  if (entry) inspectStateDistrict(app.view.state, entry);
}

/**
 * What to draw a district at, and whether that number is the engine's.
 *
 * The distinction is the whole reason this function exists rather than a field lookup: a stand-in
 * severity and an engine belief are both a number between zero and one, they render identically, and
 * only one of them means anything. The ``live`` flag travels with the value everywhere it goes.
 */
function severityFor(district) {
  const scenario = district.scenarios?.[0];
  if (scenario) {
    return {
      severity: app.liveSeverity?.get(district.id) ?? 0.18,
      live: true,
      scenario,
      failure_mode: null,
      note: app.liveSeverity?.has(district.id)
        ? "live risk belief" : "live district · open to compute",
    };
  }
  const row = app.standIns?.districts?.[`${district.stateId}/${district.id}`]
    ?? app.standIns?.districts?.[district.id];
  return {
    severity: row?.severity ?? 0.12,
    live: false,
    failure_mode: row?.failure_mode ?? null,
    note: row ? "scenario estimate" : "no risk estimate for this district",
  };
}

function standInFor(state, district) {
  const base = app.standIns?.districts?.[`${state.id}/${district.id}`]
    ?? app.standIns?.districts?.[district.id]
    ?? null;
  const override = stateSituationOverride(state.id, district.id);
  return base || override ? { ...(base || {}), ...(override || {}) } : null;
}

function districtSummary(state, entry) {
  const standIn = standInFor(state, entry.district);
  const sourcedEvent = Boolean(standIn?.suppress_synthetic);
  const scenarioId = entry.district.scenarios?.[0] || null;
  const scenario = app.scenarios.find(item => item.id === scenarioId) || null;
  return {
    id: entry.district.id,
    name: entry.district.name,
    stateName: state.name,
    stateId: state.id,
    scenarioId,
    scenarioName: scenario?.name || null,
    historical: scenario?.historical ?? null,
    live: Boolean(scenarioId),
    scenarioCount: entry.district.scenarios?.length ?? 0,
    severity: entry.row?.severity ?? standIn?.severity ?? 0,
    failure_mode: standIn?.failure_mode ?? entry.row?.failure_mode ?? null,
    hazard: standIn?.hazard ?? null,
    asset_kind: sourcedEvent ? null : (standIn?.asset_kind ?? null),
    assets_requested: sourcedEvent ? null : (standIn?.assets_requested ?? null),
    settlements_estimated: sourcedEvent ? null : (standIn?.settlements_estimated ?? null),
    settlements_severe: sourcedEvent ? null : (standIn?.settlements_severe ?? null),
    area_km2: standIn?.area_km2 ?? null,
    affected_people: standIn?.affected_people ?? null,
    alert_level: standIn?.alert_level ?? null,
    status: standIn?.status ?? null,
    river_status: standIn?.river_status ?? null,
    response_note: standIn?.response_note ?? null,
    source_label: standIn?.source_label ?? null,
    last_updated: standIn?.last_updated ?? standIn?.as_of ?? null,
    fatalities: standIn?.fatalities ?? null,
    injuries: standIn?.injuries ?? standIn?.injured ?? null,
    missing: standIn?.missing ?? null,
    trapped: standIn?.trapped ?? standIn?.need_rescue ?? null,
    evacuated: standIn?.evacuated ?? null,
    sheltered: standIn?.sheltered ?? standIn?.people_in_shelters ?? null,
    relief_camps: standIn?.relief_camps ?? null,
    roads_damaged_km: standIn?.roads_damaged_km ?? null,
    bridges_damaged: standIn?.bridges_damaged ?? null,
    telecom_status: standIn?.telecom_status ?? null,
    power_status: standIn?.power_status ?? null,
    critical_facilities: standIn?.critical_facilities ?? null,
    incident_objective: standIn?.incident_objective ?? null,
    verification_status: standIn?.verification_status ?? null,
    decision_log_entries: standIn?.decision_log_entries ?? null,
    provenance: standIn?.provenance ?? (entry.row?.live ? "engine" : "unknown"),
  };
}

function dominantFailure(rows) {
  const totals = new Map();
  for (const item of rows || []) {
    const mode = item.failure_mode || "UNCLASSIFIED";
    totals.set(mode, (totals.get(mode) || 0) + Number(item.probability || 0));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "UNCLASSIFIED";
}

function assetMix(plan) {
  const totals = new Map();
  for (const task of plan || []) {
    const kind = task.asset_kind || "untyped";
    totals.set(kind, (totals.get(kind) || 0) + 1);
  }
  return [...totals.entries()].map(([kind, count]) => `${count} ${kind}`).join(" · ") || "none dispatched";
}

/**
 * Collapse the Engine's existing read surfaces into the one district inspection dossier shown while
 * the state remains on screen. This is deliberately a projection, not a second model: every number
 * below comes from the same beliefs, coverage, VoI queue, dispatch plan and audit metrics used by the
 * full command twin.
 */
function districtIntelligence({ summary, snapshot, settlements, coverage, metrics, decisions, districtMeta }) {
  const mean = (values) => {
    const usable = values.map(Number).filter(Number.isFinite);
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
  };
  const normaliseShare = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 1 ? numeric / 100 : numeric;
  };
  const names = new Map((settlements || []).map(item => [item.id, item.name]));
  const worst = [...worstBySettlement(snapshot?.beliefs || [], names).values()];
  const peak = worst.reduce((best, item) => !best || item.probability > best.probability ? item : best, null);
  const severe = worst.filter(item => Number(item.probability || 0) >= 0.6);
  const plan = snapshot?.plan || [];
  const openVerify = (snapshot?.verify || []).filter(item => item.state !== "resolved")
    .sort((a, b) => Number(b.voi_score || 0) - Number(a.voi_score || 0));
  const prePositions = Object.entries(snapshot?.pre_positions || {}).sort(
    (a, b) => Number(b[1]?.probability || 0) - Number(a[1]?.probability || 0),
  );
  const population = (settlements || []).reduce((sum, item) => sum + Number(item.population || 0), 0);
  const households = (settlements || []).reduce((sum, item) => sum + Number(item.households || 0), 0);
  const elderlyPopulation = (settlements || []).reduce(
    (sum, item) => sum + Number(item.population || 0) * Number(item.elderly_frac || 0),
    0,
  );
  const blocks = new Set((settlements || []).map(item => item.block).filter(Boolean));
  const officialSummary = districtMeta?.official_summary || {};
  const rainfallValues = Object.values(officialSummary.kalladi_rainfall_mm || {}).map(Number).filter(Number.isFinite);
  const observabilityRows = (settlements || []).map(item => Number(item.observability)).filter(Number.isFinite);
  const meanObservability = observabilityRows.length
    ? observabilityRows.reduce((sum, value) => sum + value, 0) / observabilityRows.length
    : null;
  const routed = plan.filter(task => task.route_id || task.route).length;
  const blocked = plan.filter(task => task.state === "needs_route_review" || task.access_mode === "blocked").length;
  const expectedLivesSaved = plan.reduce((sum, task) => sum + Number(task.expected_lives_saved || 0), 0);
  const topVerify = openVerify[0] || null;
  const topPrePosition = prePositions[0] || null;
  const totals = coverage?.totals || {};
  const silentSettlements = coverage?.without_reports?.length
    ?? coverage?.settlements?.filter(item => Number(item.messages || 0) === 0).length
    ?? totals.settlements_without_reports
    ?? null;
  const audit = metrics?.audit || {};
  const equity = metrics?.equity || {};
  const robustness = metrics?.robustness || {};
  const calibration = metrics?.calibration || {};
  const latestDecision = (decisions || [])[decisions.length - 1] || snapshot?.log || null;

  return {
    loading: false,
    fullTwin: true,
    settlementCount: settlements?.length ?? worst.length,
    population,
    households,
    elderlyPopulation,
    blockCount: blocks.size,
    meanObservability,
    meanElevationM: mean((settlements || []).map(item => item.elevation_m ?? item.terrain?.elevation_m?.mean)),
    meanSlopeDeg: mean((settlements || []).map(item => item.slope_deg ?? item.terrain?.slope_deg?.mean)),
    meanHandM: mean((settlements || []).map(item => item.hand_m ?? item.terrain?.hand_m?.mean)),
    meanRoadHoursNormal: mean((settlements || []).map(item => item.road_hours_normal)),
    meanKutchaShare: mean((settlements || []).map(item => normaliseShare(item.pct_kutcha)).filter(value => value != null)),
    meanDisadvantagedShare: mean((settlements || []).map(item => normaliseShare(item.pct_sc_st)).filter(value => value != null)),
    highFragilitySettlements: (settlements || []).filter(item => item.fragility_class === "high").length,
    sourceCount: districtMeta?.sources?.length ?? null,
    assetInventoryCount: districtMeta?.counts?.assets ?? null,
    affectedPeopleOfficial: officialSummary.affected_people ?? officialSummary.people_affected ?? null,
    fatalities: officialSummary.fatalities ?? null,
    injuries: officialSummary.injuries ?? officialSummary.injured ?? null,
    missing: officialSummary.missing ?? null,
    trapped: officialSummary.trapped ?? officialSummary.need_rescue ?? null,
    evacuated: officialSummary.evacuated ?? null,
    sheltered: officialSummary.sheltered
      ?? officialSummary.people_in_shelters
      ?? officialSummary.camp_inmates
      ?? null,
    displaced: officialSummary.displaced ?? officialSummary.people_displaced ?? null,
    cropLossHa: officialSummary.crop_loss_ha ?? null,
    reliefCamps: officialSummary.relief_camps ?? null,
    campInmates: officialSummary.camp_inmates ?? null,
    roadsDamagedKm: officialSummary.roads_damaged_km ?? null,
    bridgesDamaged: officialSummary.bridges_damaged ?? null,
    telecomStatus: officialSummary.telecom_status ?? officialSummary.communications_status ?? null,
    powerStatus: officialSummary.power_status ?? null,
    criticalFacilities: officialSummary.critical_facilities ?? officialSummary.facilities_affected ?? null,
    runoutKm: officialSummary.runout_km ?? null,
    affectedWardCount: Array.isArray(officialSummary.affected_wards) ? officialSummary.affected_wards.length : null,
    affectedSettlementCount: Array.isArray(officialSummary.affected_settlements) ? officialSummary.affected_settlements.length : null,
    affectedSettlementNames: Array.isArray(officialSummary.affected_settlements) ? officialSummary.affected_settlements : [],
    peakRainfallMm: rainfallValues.length ? Math.max(...rainfallValues) : null,
    routingAttribution: districtMeta?.routing?.attribution ?? null,
    officialEventTime: districtMeta?.official_summary?.event_time ?? null,
    peakBelief: peak?.probability ?? summary.severity,
    dominantFailure: dominantFailure(snapshot?.beliefs || []),
    severeSettlements: severe.length,
    reports: totals.messages_ingested ?? null,
    distinctClaims: totals.distinct_claims ?? null,
    evidenceRows: totals.evidence_rows ?? null,
    unresolvedLocations: totals.unresolved_locations ?? null,
    silentSettlements,
    dispatchCount: plan.length,
    assetMix: assetMix(plan),
    routedCount: routed,
    blockedCount: blocked,
    expectedLivesSaved,
    verifyCount: openVerify.length,
    topVerify: topVerify ? {
      ...topVerify,
      settlement_name: names.get(topVerify.settlement_id) || topVerify.settlement_id,
    } : null,
    prePositionCount: prePositions.length,
    topPrePosition: topPrePosition ? {
      settlement_id: topPrePosition[0],
      settlement_name: names.get(topPrePosition[0]) || topPrePosition[0],
      ...topPrePosition[1],
    } : null,
    auditValid: audit.hash_chain_valid ?? null,
    auditEntries: audit.entries ?? decisions?.length ?? null,
    latestDecisionHash: latestDecision?.entry_hash || latestDecision?.belief_hash || null,
    equityGap: equity.gap ?? null,
    calibrationEce: calibration.ece ?? null,
    disabledChannels: robustness.disabled_channels || [],
    rankDisplacement: robustness.top10_rank_displacement ?? null,
    disclosure: metrics?.disclosure
      || districtMeta?.provenance?.disclosure
      || snapshot?.provenance?.disclosure
      || summary.source_label
      || summary.provenance,
    updatedAt: snapshot?.clock?.t || snapshot?.t || null,
  };
}

/** Live state nests assessed geometry on each dispatch task; baked snapshots keep a route table. */
function routesFrom(snapshot) {
  const routes = { ...(snapshot?.routes || {}) };
  for (const task of snapshot?.plan || []) {
    const route = task.route;
    const id = task.route_id || route?.route_id;
    if (route && id) routes[id] = route;
  }
  return routes;
}

/* --- views ------------------------------------------------------------------------------------ */

function stateHint(state) {
  return state.id === "assam"
    ? "Assam flood replay · blue traces = NRSC/Bhuvan 08 Aug inundation · red rings = highest-impact ASDMA districts · click a district for details"
    : "Select any district · regional estimates open here; full twins expose the complete fog → belief → verify → dispatch chain";
}

/** Keep the command console scoped to the place that is visibly selected on the map. */
function syncCommandContext({ kind, state = null, district = null, activeScenario = null } = {}) {
  const scenarioIds = district?.scenarios || [];
  app.panels?.commandConsole?.setContext({
    kind: kind || app.view.kind,
    stateName: state?.name || null,
    districtName: district?.name || null,
    fullTwin: Boolean(scenarioIds.length),
    scenarioIds,
    activeScenario: activeScenario || scenarioIds[0] || null,
  });
}

async function inspectStateDistrict(state, entry) {
  if (app.view.kind !== "state" || app.view.state !== state || !entry) return;
  const token = ++app.stateInspectToken;
  const summary = districtSummary(state, entry);
  app.stateSelection = { state, entry, summary, intelligence: null };
  syncCommandContext({ kind: "state", state, district: entry.district, activeScenario: summary.scenarioId });
  app.panels.showTip(null);
  app.panels.showDistrictSummary(summary, summary.live ? { loading: true, fullTwin: true } : null);
  app.panels.setTrail([
    { label: "India", kind: "nation" },
    { label: state.name, kind: "state" },
    { label: entry.district.name, kind: "state-district" },
  ]);

  // Keep the state scene resident, but move the camera onto the selected district. The user should
  // feel the map physically re-centre around the thing they clicked while the rest of the state
  // remains available as flattened context.
  app.enteringDistrict = true;
  try {
    const rise = app.scene?.riseTo?.(entry);
    const shot = app.scene?.focus?.(entry, { close: false });
    const fly = shot ? app.stage.rig.flyTo({ ...shot, duration: 1050 }) : null;
    await Promise.all([rise, fly].filter(Boolean));
    app.stage.wakeFor(1250);
  } finally {
    app.enteringDistrict = false;
  }

  if (!summary.live) {
    const regional = standInFor(state, entry.district);
    app.panels.setHint(regional?.source_label
      ? `${entry.district.name} · ${regional.source_label}. Regional event evidence only; village-level observations are deliberately not invented.`
      : `${entry.district.name} · regional model only. Village-level evidence, VoI and dispatch remain unavailable until a district package is loaded.`);
    return;
  }

  const scenarioId = summary.scenarioId;
  app.panels.setHint(`Reading ${entry.district.name} · reports, silence, beliefs, verification, routes and audit proof…`);
  try {
    // A live Engine owns one active district package. Selecting it here changes the read target but
    // deliberately does not replace the state scene; the operator is still comparing districts.
    await client.selectScenario(scenarioId);
    const [snapshot, settlements, coverage, metrics, decisions, districtMeta] = await Promise.all([
      client.state(scenarioId),
      client.settlements(scenarioId),
      client.coverage(scenarioId).catch(() => null),
      client.metrics(scenarioId).catch(() => null),
      client.decisions(scenarioId).catch(() => []),
      client.district(scenarioId).catch(() => null),
    ]);
    if (token !== app.stateInspectToken || app.view.kind !== "state" || app.stateSelection?.entry !== entry) return;
    const intelligence = districtIntelligence({
      summary, snapshot, settlements, coverage, metrics, decisions, districtMeta,
    });
    app.stateSelection.intelligence = intelligence;
    app.panels.showDistrictSummary(summary, intelligence);
    const sourceKind = summary.historical ? "historical replay" : (client.live() ? "live engine" : "recorded scenario");
    app.panels.setHint(
      `${entry.district.name} · ${sourceKind} · ${intelligence.settlementCount} settlements · ${intelligence.dispatchCount} dispatch orders · ${intelligence.verifyCount} verification questions`,
    );
  } catch (error) {
    if (token !== app.stateInspectToken || app.view.kind !== "state" || app.stateSelection?.entry !== entry) return;
    app.panels.showDistrictSummary(summary, {
      loading: false,
      fullTwin: true,
      error: error instanceof Error ? error.message : String(error),
    });
    app.panels.setHint(`${entry.district.name} · district package could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function clearStateDistrictSelection() {
  if (app.view.kind !== "state") return;
  ++app.stateInspectToken;
  app.stateSelection = null;
  syncCommandContext({ kind: "state", state: app.view.state });
  const settle = app.scene?.settle?.();
  const overview = app.scene?.overview ? app.stage.rig.flyTo({ ...app.scene.overview, duration: 900 }) : null;
  await Promise.all([settle, overview].filter(Boolean));
  app.stage.wakeFor(1000);
  const state = app.view.state;
  const situation = situationForState(state, district => standInFor(state, district));
  app.panels.showStateSituation(situation);
  app.panels.showStateSummary(state.name, situation);
  app.panels.setTrail([{ label: "India", kind: "nation" }, { label: state.name, kind: "state" }]);
  app.panels.setHint(stateHint(state));
}

async function openSelectedDistrictTwin() {
  if (app.view.kind !== "state" || !app.stateSelection?.summary?.scenarioId) return null;
  const { state, entry } = app.stateSelection;
  return enterDistrict(state, entry);
}

async function showState(state) {
  cancelHistoricalReplay();
  app.enteringDistrict = false;
  ++app.stateInspectToken;
  app.stateSelection = null;
  app.storyFocusId = null;
  app.storyStep = null;
  app.view = { kind: "state", state };
  app.panels.setLandingChrome(false);
  syncCommandContext({ kind: "state", state });
  app.rail.setActive(state.id);
  const situation = situationForState(state, district => standInFor(state, district));
  app.panels.showStateSituation(situation);
  app.panels.setTrail([{ label: "India", kind: "nation" }, { label: state.name, kind: "state" }]);
  app.panels.showStateSummary(state.name, situation);
  app.panels.setHint(stateHint(state));
  setScene("state");

  const scene = buildStateScene({
    state,
    severityFor: (district) => {
      const regional = standInFor(state, district);
      if (district.scenarios?.length) return severityFor({ ...district, stateId: state.id });
      return {
        severity: regional?.severity ?? 0.12,
        live: false,
        failure_mode: regional?.failure_mode ?? null,
        hazard: regional?.hazard ?? null,
        note: regional?.response_note || (regional ? "regional scenario estimate" : "no risk estimate for this district"),
        flood_active: regional?.flood_active ?? false,
        alert_level: regional?.alert_level ?? null,
        affected_people: regional?.affected_people ?? null,
      };
    },
    onHover: (entry) => {
      if (!entry) return app.panels.showTip(null);
      const [x, y, z] = [entry.anchor[0], entry.height * 1.1, entry.anchor[1]];
      const at = app.stage.toScreen([x, y, z]);
      const row = entry.row;
      const meta = row.live
        ? row.note
        : `${row.failure_mode ? row.failure_mode.toLowerCase() : "unclassified"} · ${row.note}`;
      return app.panels.showTip(entry.district.name, meta, at);
    },
    onPick: (entry) => inspectStateDistrict(state, entry),
  });
  app.scene = app.stage.show(scene);
  app.stage.rig.state.minDistance = 48;
  app.stage.rig.state.maxDistance = scene.overview.distance * 2.4;
  app.stage.rig.place({ ...scene.overview, distance: scene.overview.distance * 1.9, polar: 1.1 });
  app.stage.rig.flyTo({ ...scene.overview, duration: 2200 });
  app.stage.start();
  hydrateLiveDistricts(state, scene);
}

/**
 * Fill in the engine's own numbers for the districts that have them, after the state is on screen.
 *
 * Deferred rather than blocking the transition, because it is a network round trip per live district
 * and the flight into the state should not wait on it. Until it lands, those districts are drawn at
 * a neutral height and the tip says the number has not been computed - which is true.
 */
async function hydrateLiveDistricts(state, scene) {
  const live = state.districts.filter((district) => district.scenarios?.length);
  if (!live.length) return;
  app.liveSeverity = app.liveSeverity || new Map();
  for (const district of live) {
    try {
      const snapshot = await client.state(district.scenarios[0]);
      const worst = [...worstBySettlement(snapshot.beliefs).values()];
      const peak = worst.reduce((into, row) => Math.max(into, row.probability), 0);
      app.liveSeverity.set(district.id, peak);
      if (app.scene === scene) {
        // Grow into the new height rather than snapping: the number arrived late, and a jump would
        // read as a glitch instead of as an answer.
        const entry = scene.setSeverity(district.id, peak);
        if (entry) {
          entry.row.note = "live risk belief";
          app.stage.wakeFor(850);
        }
      }
    } catch {
      // A live district we cannot reach stays neutral and keeps its "not computed" label.
    }
  }
}

/**
 * Enter a district: rise, fly, load.
 *
 * The rise happens in the state scene and finishes before the district scene is built, so the two
 * are one continuous move rather than a dissolve. A district with no engine behind it stops here -
 * it says so, and the camera stays in the state, because building a terrain for it would mean
 * inventing one.
 */
async function enterDistrict(state, entry) {
  const scenarioId = entry.district.scenarios?.[0];
  app.panels.showDistrictSummary(districtSummary(state, entry));
  app.panels.showTip(null);

  if (!scenarioId) {
    const shot = app.scene.focus?.(entry, { close: false });
    if (shot) await app.stage.rig.flyTo({ ...shot, duration: 900 });
    const regional = standInFor(state, entry.district);
    app.panels.setHint(regional?.source_label
      ? `${entry.district.name} · ${regional.source_label}. District-scale replay only; SETU does not invent village-level flood depth or evidence.`
      : `${entry.district.name} · regional estimate only. No district twin is available yet, so SETU does not invent village-level evidence.`);
    return;
  }

  if (app.enteringDistrict) return;
  app.enteringDistrict = true;
  const stateScene = app.scene;
  try {
    app.panels.setHint(`Opening ${entry.district.name} · loading risk, dispatch, verification, silence and evidence…`);
    app.stage.wakeFor(950);
    await stateScene.riseTo(entry);
    if (app.scene !== stateScene || app.view.kind !== "state") return;
    const shot = stateScene.focus?.(entry, { close: true });
    if (shot) await app.stage.rig.flyTo({ ...shot, duration: 1250 });
    if (app.scene !== stateScene || app.view.kind !== "state") return;

    app.panels.setTrail([
      { label: "India", kind: "nation" },
      { label: state.name, kind: "state" },
      { label: entry.district.name, kind: "district" },
    ]);
    app.panels.setHint("Loading operational district twin…");
    await loadDistrict(scenarioId, state, entry.district);
  } finally {
    app.enteringDistrict = false;
  }
}

async function loadDistrict(scenarioId, state, district) {
  cancelHistoricalReplay();
  await client.selectScenario(scenarioId);
  app.frames = null;
  app.panels?.setScenarios?.(app.scenarios, scenarioId);
  const [settlements, index, districtMeta, timeline] = await Promise.all([
    client.settlements(scenarioId),
    client.layerIndex(scenarioId).catch(() => ({ layers: [] })),
    client.district(scenarioId).catch(() => null),
    client.timeline(scenarioId).catch(() => null),
  ]);
  app.dataPlane = { district: districtMeta, layers: index.layers || [], timeline, twin: null };
  const has = (id) => index.layers.some((layer) => layer.id === id);
  // A layer that fails to load is a degraded district, not a broken one - but it is never silent:
  // the scene will honestly say "terrain absent", and the console says which fetch went wrong.
  const optional = (layerId) => (has(layerId)
    ? client.layer(scenarioId, layerId).catch((error) => {
      console.warn(`[setu] ${layerId} layer unavailable for ${scenarioId}:`, error.message);
      return null;
    })
    : null);
  const [heightmap, buildings, snapshot] = await Promise.all([
    optional("heightmap"),
    optional("buildings"),
    client.state(scenarioId),
  ]);

  app.view = { kind: "district", state, district, scenario: scenarioId };
  syncCommandContext({ kind: "district", state, district, activeScenario: scenarioId });
  app.settlements = settlements;
  app.detail = null;
  app.activeRouteId = null;
  app.storyFocusId = null;
  app.storyStep = null;
  app.panels.setNames(settlements);
  app.rail.setDistrict(
    district.name,
    [...new Set(settlements.map((settlement) => settlement.block).filter(Boolean))],
    app.lens,
  );
  setScene("district");

  const scene = buildDistrictScene({
    settlements,
    heightmap,
    buildings,
    routes: routesFrom(snapshot),
    onHoverVillage: (entry) => {
      if (!entry) return app.panels.showTip(null);
      const severity = app.severity?.get(entry.settlement.id) ?? 0;
      return app.panels.showTip(
        entry.settlement.name,
        `${(severity * 100).toFixed(0)}% · ${entry.settlement.block || "—"}`,
        app.stage.toScreen([entry.at[0], entry.at[1] + 4, entry.at[2]]),
      );
    },
  });
  app.scene = app.stage.show(scene);
  scene.setFlood(app.flood);
  app.panels.controls.setFloodStage(app.flood);

  // Arrive high and outside, then drop in. Same curve as everything else on the site.
  app.stage.rig.place({ azimuth: scene.overview.azimuth - 0.7, polar: 1.0, distance: scene.span * 2.1, target: [0, 0, 0] });
  // The render loop must be running before the arrival flight is awaited. `flyTo` only settles from
  // inside `rig.update`, which the stage calls from its own scheduler - and the nation view stops
  // that scheduler. Opening a replay straight from the command console therefore used to await a
  // promise nothing could ever resolve, stranding the district before its first snapshot was ever
  // rendered. `start()` is idempotent, so entering from a state view is unchanged.
  app.stage.start();
  await app.stage.rig.flyTo({ ...scene.overview, duration: 2600 });
  app.stage.rig.state.minDistance = 8;
  app.stage.rig.state.maxDistance = scene.span * 2.4;

  app.panels.setHint(
    `${scene.counts.settlements} villages · ${scene.counts.buildings.toLocaleString()} footprints · terrain ${scene.counts.terrain}`,
  );
  await renderDistrict(snapshot);
  listen();
}

/* --- the engine's own numbers ------------------------------------------------------------------ */

/**
 * One snapshot through every panel and into the geometry.
 *
 * Called on arrival, on every scrub, after every injection, and on every frame the Engine pushes -
 * which is why it is one function and not five: there is exactly one description of how a snapshot
 * becomes an interface, and a scrub and a live push are the same event with different clocks.
 */
async function renderDistrict(snapshot) {
  const scenario = app.view.scenario;
  const names = new Map(app.settlements.map((settlement) => [settlement.id, settlement.name]));
  const settlementMap = new Map(app.settlements.map((settlement) => [settlement.id, settlement]));
  const worstMap = worstBySettlement(snapshot.beliefs, names);
  const worst = [...worstMap.values()];
  app.severity = new Map(worst.map((entry) => [entry.settlement_id, entry.probability]));

  const moment = snapshot.clock?.t || snapshot.t || null;
  const [coverage, decisions, metrics, disambiguation, twin] = await Promise.all([
    client.coverage(scenario).catch(() => null),
    client.decisions(scenario).catch(() => []),
    client.metrics(scenario).catch(() => null),
    client.disambiguation().catch(() => []),
    client.twinFrame(scenario, moment).catch(() => null),
  ]);
  if (app.dataPlane) app.dataPlane.twin = twin;
  const silent = new Set(coverage?.without_reports || []);
  const routes = routesFrom(snapshot);

  app.current = {
    lens: app.lens,
    fogMode: app.fogMode,
    live: client.live(),
    snapshot,
    settlements: app.settlements,
    settlementMap,
    names,
    worst,
    worstMap,
    severity: app.severity,
    silent,
    coverage,
    decisions,
    metrics,
    disambiguation,
    routes,
    activeRouteId: app.activeRouteId,
    detail: app.detail,
    scenario,
    overrides: app.overrides,
    dataPlane: app.dataPlane,
  };

  applySceneLens();
  app.panels.renderDistrict(app.current);
  app.stage.invalidate();

  const clock = snapshot.clock || {};
  app.window = { start: clock.start, end: clock.end };
  app.panels.controls.setWindow(clock.start, clock.end, clock.t);
  if (snapshot.baked_frame != null) {
    // Say which snapshot is on screen, because the scrubber moves continuously and the bake does
    // not: an operator who drags a smooth slider and gets a step function deserves to know why.
    app.frames = app.frames ?? (await client.replay(scenario)).frames.length;
    app.panels.setHint(
      `Historical frame ${snapshot.baked_frame + 1} of ${app.frames} · nearest recorded state`,
    );
  }
}

function renderCurrent() {
  if (!app.current || app.view.kind !== "district") return;
  app.current = {
    ...app.current,
    lens: app.lens,
    fogMode: app.fogMode,
    activeRouteId: app.activeRouteId,
    detail: app.detail,
  };
  applySceneLens();
  app.panels.renderDistrict(app.current);
  app.stage.invalidate();
}

function applySceneLens() {
  if (!app.current || !app.scene?.setLens) return;
  const coverageMessages = new Map(
    (app.current.coverage?.settlements || []).map((entry) => [entry.settlement_id, Number(entry.messages || 0)]),
  );
  const dispatchIds = new Set((app.current.snapshot.plan || []).map((task) => task.settlement_id));
  const verifyIds = new Set((app.current.snapshot.verify || [])
    .filter((task) => task.state !== "resolved")
    .map((task) => task.settlement_id));
  app.scene.setLens({
    lens: app.lens,
    fogMode: app.fogMode,
    severityBySettlement: app.current.severity,
    silent: app.current.silent,
    messages: coverageMessages,
    dispatchIds,
    verifyIds,
    selectedId: app.detail?.settlementId || app.storyFocusId || null,
    activeRouteId: app.activeRouteId,
    prePositions: app.current.snapshot.pre_positions || {},
  });
}

function standardShotForLens(lens) {
  if (!app.scene) return null;
  if (lens === "response") return app.scene.plan || app.scene.overview;
  if (lens === "proof" && app.scene.overview) {
    return {
      ...app.scene.overview,
      azimuth: Math.PI / 3.1,
      polar: 0.62,
      distance: app.scene.span * 0.86,
    };
  }
  if (lens === "belief" && app.scene.overview) {
    return {
      ...app.scene.overview,
      azimuth: -Math.PI / 3.8,
      polar: 0.56,
      distance: app.scene.span * 0.64,
    };
  }
  return app.scene.overview;
}

function framePeakBelief(frame) {
  return (frame?.state?.beliefs || []).reduce(
    (peak, row) => Math.max(peak, Number(row.probability || 0)),
    0,
  );
}

function frameTopVoi(frame) {
  return (frame?.state?.verify || []).reduce(
    (peak, row) => Math.max(peak, Number(row.voi_score || 0)),
    0,
  );
}

function replayMomentLabel(iso) {
  if (!iso) return "";
  const literal = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (literal) return `${literal[1]} ${literal[2]}`;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "";
  return value.toISOString().replace("T", " ").slice(0, 16);
}

/**
 * Five authored checkpoints for a recorded run.
 *
 * The story used to be five camera cuts over whichever frame happened to be on screen. That made a
 * historical replay feel arbitrary: "belief" could open before the belief actually changed and
 * "dispatch" could land on a frame with the same plan as the opening. These anchors are deterministic
 * and data-aware. They still keep a beginning/middle/end rhythm when a particular replay does not
 * contain a clean transition, but they prefer the first meaningful escalation the data actually has.
 */
function historicalStoryFrames(baked) {
  const frames = baked?.frames || [];
  const last = frames.length - 1;
  if (last <= 0) return { fog: 0, belief: 0, response: 0, verify: 0, proof: 0 };

  const fallback = fraction => Math.round(last * fraction);
  const startPeak = framePeakBelief(frames[0]);
  const maxVoi = Math.max(...frames.map(frameTopVoi), 0);
  const initialPlanCount = frames[0]?.state?.plan?.length || 0;

  const firstBeliefEscalation = frames.findIndex((frame, index) => (
    index > 0 && framePeakBelief(frame) >= Math.max(0.72, startPeak + 0.12)
  ));
  const firstPlanExpansion = frames.findIndex((frame, index) => (
    index > 0 && (frame?.state?.plan?.length || 0) > initialPlanCount
  ));
  const firstHighVoi = frames.findIndex((frame, index) => (
    index > 0 && maxVoi > 0 && frameTopVoi(frame) >= maxVoi * 0.95
  ));

  const fog = 0;
  const proof = last;
  const room = Math.max(0, last - 1);
  const belief = Math.min(room, Math.max(1, firstBeliefEscalation >= 0 ? firstBeliefEscalation : fallback(0.25)));
  const response = Math.min(room, Math.max(
    belief + 1,
    firstPlanExpansion >= 0 ? firstPlanExpansion : fallback(0.5),
  ));
  const verify = Math.min(room, Math.max(
    response + 1,
    firstHighVoi >= 0 ? firstHighVoi : fallback(0.75),
  ));

  return { fog, belief, response, verify, proof };
}

async function seekHistoricalStoryFrame(lens) {
  if (client.live() || app.view.kind !== "district") return null;
  const baked = await client.replay(app.view.scenario);
  if (!baked.frames?.length) return null;
  cancelHistoricalReplay();
  const anchors = historicalStoryFrames(baked);
  const index = Math.max(0, Math.min(baked.frames.length - 1, Number(anchors[lens] ?? 0)));
  const snapshot = await renderHistoricalFrame(baked, index, false);
  return snapshot ? {
    index,
    total: baked.frames.length,
    t: snapshot.clock?.t || baked.frames[index]?.t || null,
  } : null;
}

function storySubject(lens) {
  if (!app.current) return null;
  const worst = [...(app.current.worst || [])]
    .sort((a, b) => Number(b.probability || 0) - Number(a.probability || 0));
  const nameOf = id => app.current.names?.get(id) || id;

  if (lens === "fog") {
    const row = worst.find(item => app.current.silent?.has(item.settlement_id)) || null;
    return row ? {
      settlementId: row.settlement_id,
      label: `${nameOf(row.settlement_id)} · highest-risk silent settlement`,
    } : null;
  }
  if (lens === "belief") {
    const row = worst[0] || null;
    return row ? {
      settlementId: row.settlement_id,
      label: `${nameOf(row.settlement_id)} · peak ${Math.round(Number(row.probability || 0) * 100)}% belief`,
    } : null;
  }
  if (lens === "response") {
    const task = [...(app.current.snapshot?.plan || [])]
      .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0))[0] || null;
    return task ? {
      settlementId: task.settlement_id,
      routeId: task.route_id || task.route?.route_id || null,
      label: `${task.settlement_name || nameOf(task.settlement_id)} · lead ${task.asset_kind || "dispatch"}`,
    } : null;
  }
  if (lens === "verify") {
    const question = [...(app.current.snapshot?.verify || [])]
      .filter(item => item.state !== "resolved")
      .sort((a, b) => Number(b.voi_score || 0) - Number(a.voi_score || 0))[0] || null;
    return question ? {
      settlementId: question.settlement_id,
      label: `${nameOf(question.settlement_id)} · highest-value verification`,
    } : null;
  }
  return null;
}

function storyShotForLens(lens, subject) {
  if (!app.scene) return null;
  if (lens === "proof") return app.scene.overview || standardShotForLens(lens);
  if (subject?.settlementId) {
    const focused = app.scene.focus?.(subject.settlementId);
    if (focused) {
      const authored = {
        fog: { distance: 64, polar: 0.48, azimuth: -Math.PI / 3.2 },
        belief: { distance: 44, polar: 0.38, azimuth: -Math.PI / 3.0 },
        response: { distance: 62, polar: 0.72, azimuth: -Math.PI / 2.85 },
        verify: { distance: 42, polar: 0.58, azimuth: -Math.PI / 2.7 },
      }[lens] || {};
      return {
        ...focused,
        ...authored,
      };
    }
  }
  return standardShotForLens(lens);
}

function setLens(lens) {
  if (!["fog", "belief", "response", "verify", "proof"].includes(lens)) return;
  const subject = storySubject(lens);
  app.lens = lens;
  app.detail = null;
  app.activeRouteId = lens === "response" ? (subject?.routeId || null) : null;
  app.storyFocusId = subject?.settlementId || null;
  app.storyStep = null;
  app.rail?.setLens?.(lens);
  renderCurrent();
  if (app.view.kind !== "district") return;
  const shot = storyShotForLens(lens, subject);
  if (shot) app.stage.rig.flyTo({ ...shot, duration: 1100 });
  if (subject?.label) app.panels.setHint(`${lens === "response" ? "Dispatch" : lens[0].toUpperCase() + lens.slice(1)} · ${subject.label}`);
}

async function openStoryLens(lens) {
  if (!["fog", "belief", "response", "verify", "proof"].includes(lens)) {
    return { unavailable: true, reason: "That operational story step does not exist." };
  }

  if (app.view.kind === "state") {
    if (!app.stateSelection?.summary?.scenarioId) {
      return {
        unavailable: true,
        reason: app.stateSelection
          ? "This district has regional evidence only; no village replay exists to drive the five-step story."
          : "Select a district with a full twin before opening the operational story.",
      };
    }
    await openSelectedDistrictTwin();
  }

  if (app.view.kind !== "district" || !app.current) {
    return { unavailable: true, reason: "Open a district twin before entering the operational story." };
  }

  const steps = ["fog", "belief", "response", "verify", "proof"];
  const index = steps.indexOf(lens);
  const checkpoint = await seekHistoricalStoryFrame(lens);
  const subject = storySubject(lens);
  app.lens = lens;
  app.detail = null;
  app.storyStep = lens;
  app.storyFocusId = subject?.settlementId || null;
  app.activeRouteId = lens === "response" ? (subject?.routeId || null) : null;
  if (lens === "fog") app.fogMode = "reports";
  app.rail?.setLens?.(lens);
  renderCurrent();

  const shot = storyShotForLens(lens, subject);
  if (shot) await app.stage.rig.flyTo({ ...shot, duration: 1250 });
  app.stage.wakeFor(1350);

  const names = ["Reports vs risk", "Belief", "Dispatch", "Verify next", "Proof"];
  const subjectText = subject?.label || (lens === "proof" ? "district-wide audit and equity result" : "district overview");
  const replayText = checkpoint
    ? ` · replay ${checkpoint.index + 1}/${checkpoint.total}${checkpoint.t ? ` · ${replayMomentLabel(checkpoint.t)}` : ""}`
    : "";
  const message = `Step ${index + 1} of 5 · ${names[index]}${replayText} · ${subjectText}`;
  app.panels.setHint(message);
  return { lens, subject, checkpoint, message };
}

function setFogMode(mode) {
  if (mode !== "reports" && mode !== "setu") return;
  app.fogMode = mode;
  renderCurrent();
}

function selectDispatch(task) {
  if (!task) return;
  app.activeRouteId = task.route_id || task.route?.route_id || null;
  app.detail = null;
  if (task.settlement_id) {
    const shot = app.scene?.focus?.(task.settlement_id);
    if (shot) app.stage.rig.flyTo({ ...shot, distance: 42, polar: 0.72, duration: 900 });
  }
  renderCurrent();
}

function selectBlock(block) {
  if (!block || app.view.kind !== "district") return;
  const shot = app.scene?.focusBlock?.(block);
  if (shot) app.stage.rig.flyTo({ ...shot, duration: 1000 });
}

async function clearDetail() {
  app.detail = null;
  renderCurrent();
}

async function runVerification(id, result, settlementId) {
  if (!id || !client.live()) {
    app.panels.setHint("Historical replay is read-only. Connect the live command engine to submit verification.");
    return;
  }
  await client.verify(id, result, "district-operator");
  app.detail = null;
  if (settlementId) {
    const shot = app.scene?.focus?.(settlementId);
    if (shot) app.stage.rig.flyTo({ ...shot, duration: 800 });
  }
  await renderDistrict(await client.state(app.view.scenario));
}

async function resolveLocation(obsId, settlementId) {
  if (!obsId || !settlementId || !client.live()) {
    app.panels.setHint("Location resolution is unavailable in historical replay.");
    return;
  }
  await client.resolveLocation(obsId, settlementId, "district-operator");
  await renderDistrict(await client.state(app.view.scenario));
}

/** Follow the Engine's own stream while a district is open. A no-op against a bake. */
function listen() {
  app.unsubscribe?.();
  app.unsubscribe = client.subscribe((snapshot) => {
    if (app.view.kind !== "district") return;
    renderDistrict(snapshot);
  });
}

/* --- coming back up ---------------------------------------------------------------------------- */

/**
 * The nation view is the site's own landing scene.
 *
 * There is no third map. Zooming out from a state hands the screen back to the GLB terrain the site
 * already ships, because that is what the site's front page *is* - replacing it with a chloropleth
 * of India would be the frankenstein seam this layer exists to avoid.
 */
function showNation() {
  cancelHistoricalReplay();
  app.unsubscribe?.();
  app.unsubscribe = null;
  ++app.stateInspectToken;
  app.stateSelection = null;
  app.view = { kind: "nation" };
  app.rail.setActive(null);
  app.stage.show(null);
  app.stage.stop();
  app.scene = null;
  app.enteringDistrict = false;
  app.current = null;
  app.detail = null;
  app.activeRouteId = null;
  app.storyFocusId = null;
  app.storyStep = null;
  syncCommandContext({ kind: "nation" });
  setScene("nation");
  app.panels.hideDistrictSummary();
  app.panels.showSourceContext();
  app.panels.setLandingChrome(true);
  app.panels.setTrail([{ label: "India", kind: "nation" }]);
  app.panels.setHint("Select a state to enter the response atlas");
}

async function goBack(step) {
  if (step.kind === "nation") return showNation();
  if (step.kind === "state" && app.view.state) {
    if (app.view.kind === "state" && app.stateSelection) return clearStateDistrictSelection();
    app.unsubscribe?.();
    app.unsubscribe = null;
    return showState(app.view.state);
  }
  return null;
}

/* --- pointer ----------------------------------------------------------------------------------- */

/**
 * Hover and click, handed straight to whichever scene is resident.
 *
 * The rig owns the drag; this owns the click. ``endPointer`` is what separates them: a pointer that
 * moved less than six pixels was a pick, and anything more was an orbit, so an operator dragging the
 * camera across a district never accidentally enters one.
 */
function bindPointer() {
  const element = app.stage.renderer.domElement;
  let hoverFrame = null;
  let hoverEvent = null;

  element.addEventListener("pointermove", (event) => {
    if (!app.scene?.hover) return;
    if (event.buttons) {
      hoverEvent = null;
      app.panels.showTip(null);
      return;
    }
    // Raycasting every raw pointer event is especially expensive on states with dozens of detailed
    // district meshes. Coalesce input to at most one hit-test per animation frame; visually it is
    // identical, but a fast mouse can no longer queue hundreds of triangle tests per second.
    hoverEvent = event;
    if (hoverFrame != null) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = null;
      if (!hoverEvent || !app.scene?.hover) return;
      app.scene.hover(hoverEvent, element, app.stage.camera);
      app.stage.invalidate();
      hoverEvent = null;
    });
  });

  element.addEventListener("pointerup", async (event) => {
    const wasClick = app.stage.rig.endPointer(event);
    if (!wasClick || !app.scene) return;
    if (app.enteringDistrict) return;

    // An armed epicentre takes the click before anything else does: the operator asked to place a
    // point on the ground, and a village happening to sit under the cursor is not what they meant.
    if (app.seismicArmed && app.view.kind === "district") {
      const ground = app.stage.groundAt(event, 0);
      if (ground) await shakeAt(ground);
      return;
    }

    const entry = app.scene.click?.(event, element, app.stage.camera);
    if (!entry) return;
    if (app.view.kind === "district") selectVillage(entry.settlement.id);
  });
}

/** Drop an epicentre where the operator clicked and let the Engine tell us what falls down. */
async function shakeAt([x, z]) {
  const [lon, lat] = app.scene.lonLatAt([x, z]);
  app.scene.epicentre.userData.place(lon, lat, 24);
  app.stage.invalidate();
  app.panels.setHint("Injecting earthquake scenario…");
  const result = await client.seismic({ lon, lat, magnitude: 6.2, depth_km: 10, inject: true });
  app.seismicArmed = false;
  app.panels.controls.releaseSeismic();
  if (!result) {
    app.panels.setHint("This district is in replay mode. The epicentre is shown as a marker only.");
    return;
  }
  const felt = result.settlements?.filter((row) => row.mmi >= 5).length ?? 0;
  app.panels.setHint(
    `M6.2 at ${lat.toFixed(3)}, ${lon.toFixed(3)} · ${felt} villages at MMI 5+ · ${result.reports_injected ?? 0} reports injected · ${result.provenance}`,
  );
  if (result.state) await renderDistrict(result.state);
}

/** Fly to a village and name it. The same gesture as entering a district, one level further in. */
async function selectVillage(settlementId) {
  const shot = app.scene?.focus?.(settlementId);
  if (shot) app.stage.rig.flyTo({ ...shot, duration: 1400 });
  if (app.view.kind !== "district" || !app.current) return;
  try {
    const moment = app.current.snapshot?.clock?.t || app.current.snapshot?.t || null;
    const receipt = await client.receipt(app.view.scenario, settlementId, moment);
    app.detail = { settlementId, receipt };
    renderCurrent();
  } catch (error) {
    app.panels.setHint(`Evidence receipt unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/* --- boot --------------------------------------------------------------------------------------- */

/** Where the scrubber's fraction lands, as an instant inside the replay window. */
function momentAt(fraction) {
  if (!app.window?.start || !app.window?.end) return null;
  const start = new Date(app.window.start).getTime();
  const end = new Date(app.window.end).getTime();
  return new Date(start + (end - start) * fraction).toISOString();
}

async function scrubTo(fraction) {
  if (app.view.kind !== "district") return;
  const moment = momentAt(fraction);
  if (!moment) return;
  if (client.live()) await client.clock("seek", { t: moment });
  const snapshot = await client.state(app.view.scenario, moment);
  await renderDistrict(snapshot);
}

async function runInjection(attack) {
  if (app.view.kind !== "district") return;
  app.panels.setHint(`Injecting ${attack.replace("_", " ")}…`);
  const result = await client.inject(attack);
  if (!result || result.unavailable) {
    app.panels.setHint("Historical replay cannot be stress-tested. Connect the live command engine to inject failures.");
    return;
  }
  app.panels.setHint(
    `${attack.replaceAll("_", " ")} applied · beliefs, routes and proof metrics recomputed`,
  );
  if (result.state) await renderDistrict(result.state);
}

function locationForScenario(scenarioId) {
  for (const state of app.atlas?.states || []) {
    const district = (state.districts || []).find(item => item.scenarios?.includes(scenarioId));
    if (district) return { state, district };
  }
  return null;
}

async function switchScenario(scenarioId) {
  if (!scenarioId) return null;
  const selected = app.scenarios.find(item => item.id === scenarioId);
  const location = locationForScenario(scenarioId);
  if (!location) {
    return { unavailable: true, reason: `${selected?.name || scenarioId} is not attached to a district in the current atlas.` };
  }
  app.panels.setHint(`Loading ${selected?.name || scenarioId}…`);
  app.unsubscribe?.();
  app.unsubscribe = null;
  cancelHistoricalReplay();
  ++app.stateInspectToken;
  app.stateSelection = null;
  await loadDistrict(scenarioId, location.state, location.district);
  app.panels.setTrail([
    { label: "India", kind: "nation" },
    { label: location.state.name, kind: "state" },
    { label: location.district.name, kind: "district" },
  ]);
  app.panels.commandConsole.setFeedback(`${selected?.name || scenarioId} loaded · the five lenses now read from this run.`);
  return { selected: scenarioId, state: location.state.id, district: location.district.id };
}

function cancelHistoricalReplay() {
  app.replayPlayback.playing = false;
  app.replayPlayback.token += 1;
  if (app.replayPlayback.timer != null) window.clearTimeout(app.replayPlayback.timer);
  app.replayPlayback.timer = null;
}

function replayFrameDelay(speed) {
  // Every baked state gets enough screen time to be read. Higher speeds shorten the authored dwell
  // rather than silently skipping frames, which keeps the replay causal instead of frenetic.
  return Math.min(6000, Math.max(850, 4000 / Math.sqrt(Math.max(1, speed) / 30)));
}

async function renderHistoricalFrame(baked, index, playing) {
  const scenario = app.view.scenario;
  const frame = baked.frames[index];
  if (!frame || app.view.kind !== "district" || app.view.scenario !== scenario) return null;
  const snapshot = {
    ...frame.state,
    baked_frame: index,
    routes: baked.routes,
    clock: {
      ...(frame.state.clock || {}),
      t: frame.t,
      playing,
      speed: app.replayPlayback.speed,
    },
  };
  await renderDistrict(snapshot);
  return snapshot;
}

function scheduleHistoricalFrame(baked, token) {
  if (!app.replayPlayback.playing || token !== app.replayPlayback.token) return;
  app.replayPlayback.timer = window.setTimeout(async () => {
    if (!app.replayPlayback.playing || token !== app.replayPlayback.token || app.view.kind !== "district") return;
    const current = Number(app.current?.snapshot?.baked_frame ?? 0);
    const next = current + 1;
    if (next >= baked.frames.length) {
      app.replayPlayback.playing = false;
      app.replayPlayback.timer = null;
      await renderHistoricalFrame(baked, current, false);
      app.panels.setHint(`Replay complete · ${baked.frames.length} recorded states shown in order`);
      return;
    }
    await renderHistoricalFrame(baked, next, true);
    scheduleHistoricalFrame(baked, token);
  }, replayFrameDelay(app.replayPlayback.speed));
}

async function runClock(action, extra = {}) {
  if (app.view.kind !== "district") return null;
  if (client.live()) {
    const result = await client.clock(action, extra);
    if (!result || result.unavailable) return result;
    if (result.state) await renderDistrict(result.state);
    return result;
  }

  const baked = await client.replay(app.view.scenario);
  if (!baked.frames?.length) return { unavailable: true, reason: "This district has no recorded replay frames." };

  if (action === "speed") {
    app.replayPlayback.speed = Math.max(1, Number(extra.speed) || 300);
    const wasPlaying = app.replayPlayback.playing;
    const current = Number(app.current?.snapshot?.baked_frame ?? 0);
    app.replayPlayback.token += 1;
    if (app.replayPlayback.timer != null) window.clearTimeout(app.replayPlayback.timer);
    app.replayPlayback.timer = null;
    await renderHistoricalFrame(baked, current, wasPlaying);
    if (wasPlaying) scheduleHistoricalFrame(baked, app.replayPlayback.token);
    return { speed: app.replayPlayback.speed, playing: wasPlaying };
  }

  if (action === "pause") {
    const current = Number(app.current?.snapshot?.baked_frame ?? 0);
    cancelHistoricalReplay();
    const state = await renderHistoricalFrame(baked, current, false);
    return { state, playing: false };
  }

  if (action === "reset") {
    cancelHistoricalReplay();
    const state = await renderHistoricalFrame(baked, 0, false);
    return { state, playing: false, frame: 0 };
  }

  if (action === "play") {
    cancelHistoricalReplay();
    let current = Number(app.current?.snapshot?.baked_frame ?? 0);
    if (current >= baked.frames.length - 1) current = 0;
    app.replayPlayback.playing = true;
    app.replayPlayback.token += 1;
    const token = app.replayPlayback.token;
    const state = await renderHistoricalFrame(baked, current, true);
    scheduleHistoricalFrame(baked, token);
    return { state, playing: true, frame: current };
  }

  return { unavailable: true, reason: `Unknown replay action: ${action}` };
}

async function submitEvent(payload) {
  if (app.view.kind !== "district") return null;
  const result = await client.event(payload);
  if (!result || result.unavailable) return result;
  app.lens = "fog";
  app.rail?.setLens?.("fog");
  await renderDistrict(await client.state(app.view.scenario));
  app.panels.setHint(`Observation accepted · ${result.evidence_emitted ?? 0} evidence rows emitted`);
  return result;
}

async function recordOverride(decisionId, reason) {
  if (app.view.kind !== "district") return null;
  const result = await client.override(decisionId, reason, "district-operator");
  if (!result || result.unavailable) return result;
  app.overrides = [...app.overrides, result].slice(-12);
  app.lens = "proof";
  app.rail?.setLens?.("proof");
  await renderDistrict(await client.state(app.view.scenario));
  app.panels.setHint(`Human override #${result.id} recorded against decision #${result.decision_id}`);
  return result;
}

/**
 * Wait for React to finish with the document before adding anything to it.
 *
 * The captured page hydrates the whole document, and a hydration mismatch makes React re-render from
 * the root - which replaces the body, and with it anything that was appended to it. Mounting before
 * that settles is how the layer silently vanished on the first browser run, so the layer waits for
 * ``load`` and one more frame, and ``harden`` below covers the case where React does it again later.
 */
function hydrated() {
  return new Promise((resolve) => {
    const settle = () => requestAnimationFrame(() => setTimeout(resolve, 250));
    if (document.readyState === "complete") settle();
    else window.addEventListener("load", settle, { once: true });
  });
}

/**
 * The captured page streams its desktop aside after the initial document in some cold loads. A
 * fixed delay cannot make that deterministic: on a fast machine 250 ms is wasteful, and on a busy
 * laptop it can still be too early. Wait for the actual mount point instead. The observer is alive
 * only during boot and disconnects as soon as the rail can be attached, so it adds no steady-state
 * mutation cost.
 */
function railWhenReady(states) {
  const attach = () => createRail({
    states,
    onSelectState: selectState,
    onSelectLens: setLens,
    onSelectBlock: selectBlock,
  });
  const immediate = attach();
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const rail = attach();
      if (!rail) return;
      observer.disconnect();
      resolve(rail);
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

/**
 * Put the layer back if the site's own framework throws it away.
 *
 * Observing ``document`` itself rather than a node inside it is deliberate: a hydration recovery can
 * replace ``documentElement`` outright, at which point every observer bound to the old tree is dead
 * and only the document-level one still fires. Everything reapply does is idempotent, so it is safe
 * to call from four different triggers.
 */
function harden() {
  let bodyWatch = null;

  const reapply = () => {
    if (!document.documentElement.hasAttribute("data-setu")) activate(app.source?.mode);
    if (app.view?.kind) setScene(app.view.kind);
    if (app.root && !app.root.isConnected) document.body.append(app.root);
    // The rail lives inside React's own nav. If that node was replaced, the rail's MutationObserver
    // is watching a detached parent and has to be rebuilt against the new one.
    if (!app.rail?.rail?.isConnected) {
      app.rail?.dispose?.();
      const restored = createRail({
        states: app.atlas.states,
        onSelectState: selectState,
        onSelectLens: setLens,
        onSelectBlock: selectBlock,
      });
      if (restored) {
        app.rail = restored;
        if (app.view?.kind === "state") app.rail.setActive(app.view.state.id);
        if (app.view?.kind === "district") {
          app.rail.setDistrict(
            app.view.district.name,
            [...new Set(app.settlements.map((settlement) => settlement.block).filter(Boolean))],
            app.lens,
          );
        }
      }
    }
    if (document.body && bodyWatch?.target !== document.body) {
      bodyWatch?.observer.disconnect();
      const observer = new MutationObserver(reapply);
      observer.observe(document.body, { childList: true });
      bodyWatch = { target: document.body, observer };
    }
  };

  // Hydration recovery sometimes replaces the aside *inside* the existing client shell rather than
  // replacing documentElement/body. Watch structural changes deeply enough to catch that case, but
  // return immediately for the normal panel mutations while both SETU mount points are connected.
  const structuralWatch = new MutationObserver(() => {
    if (app.root?.isConnected && app.rail?.rail?.isConnected
      && document.documentElement.hasAttribute("data-setu")) return;
    reapply();
  });
  structuralWatch.observe(document, { childList: true, subtree: true });
  window.addEventListener("load", reapply);
  for (const delay of [800, 2500, 6000]) setTimeout(reapply, delay);
  reapply();
}

async function boot() {
  const source = await client.probe();
  await hydrated();
  const { root, chrome, stage } = mount();
  app.source = source;
  app.root = root;
  activate(source.mode);

  app.stage = createStage(stage);
  app.panels = createPanels({
    chrome,
    onBack: (step) => goBack(step),
    onSelectVillage: (id) => selectVillage(id),
    onSelectDispatch: (task) => selectDispatch(task),
    onCloseDetail: () => clearDetail(),
    onLens: (lens) => setLens(lens),
    onStoryLens: (lens) => openStoryLens(lens),
    onFogMode: (mode) => setFogMode(mode),
    onVerify: (id, result, settlementId) => runVerification(id, result, settlementId),
    onResolveLocation: (obsId, settlementId) => resolveLocation(obsId, settlementId),
    onSelectBlock: (block) => selectBlock(block),
    onSelectStateDistrict: (districtId) => selectStateDistrict(districtId),
    onOpenStateDistrict: () => openSelectedDistrictTwin(),
    onClearStateDistrict: () => clearStateDistrictSelection(),
    onScenario: (scenarioId) => switchScenario(scenarioId),
    onClock: (action, extra) => runClock(action, extra),
    onEvent: (payload) => submitEvent(payload),
    onOverride: (decisionId, reason) => recordOverride(decisionId, reason),
    onScrub: (fraction) => scrubTo(fraction),
    onFlood: (metres) => {
      app.flood = metres;
      app.scene?.setFlood?.(metres);
      app.stage.invalidate();
    },
    onInject: (attack) => runInjection(attack),
    onSeismic: (armed) => {
      app.seismicArmed = armed;
      app.panels.setHint(armed
        ? "Click the terrain to place the epicentre."
        : `${app.view.district?.name ?? "District"} · epicentre disarmed`);
    },
  });
  app.panels.setSource(source);

  const [atlas, standIns, scenarios] = await Promise.all([client.atlas(), client.standIns(), client.scenarios()]);
  app.atlas = atlas;
  app.standIns = standIns;
  app.scenarios = scenarios;
  app.panels.setScenarios(scenarios, scenarios.find(item => item.active)?.id);
  app.rail = await railWhenReady(atlas.states);

  showNation();
  bindPointer();
  harden();

  // A console handle. The flow above is driven by pointers, and every part of it is also reachable
  // by name - which is what makes the layer testable from outside a browser's input queue, and what
  // lets a demo be driven from the console when a projector eats the mouse.
  window.setu = {
    app,
    client,
    showNation,
    showState,
    scrubTo,
    runInjection,
    runClock,
    submitEvent,
    recordOverride,
    switchScenario,
    setLens,
    selectVillage,
    /** Fly to a state, then enter one of its districts, both by id. */
    async open(stateId, districtId) {
      const state = app.atlas.states.find((row) => row.id === stateId);
      if (!state) throw new Error(`No state ${stateId} in the atlas`);
      await showState(state);
      if (!districtId) return state;
      const entry = app.scene.districts.find((row) => row.district.id === districtId);
      if (!entry) throw new Error(`No district ${districtId} in ${stateId}`);
      await enterDistrict(state, entry);
      return entry;
    },
  };
}

installEvidenceRouteBridge();
installValidatorRouteBridge();
installInferRouteBridge();
installActRouteBridge();

if (evidenceRoute) {
  mountEvidencePage();
} else if (validatorRoute) {
  mountValidatorPage();
} else if (inferRoute) {
  mountInferPage();
} else if (actRoute) {
  mountActPage();
} else {
  boot().catch((error) => {
    // A layer that cannot reach its own data says so in the place the numbers would have been, rather
    // than leaving the site looking like it merely forgot to render them.
    const { chrome } = mount();
    chrome.append(el("div.setu-card.setu-disclosure", {
      text: `SETU could not start: ${error.message}. The operational shell is still available.`,
    }));
    console.error("[setu]", error);
  });
}
