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
};

/**
 * A reload should always reopen the framed landing composition. The captured site drives that
 * opening with its own wheel-backed zoom store, so resetting `window.scrollY` alone is not enough:
 * hot reloads and restored pages can otherwise inherit the fully-entered map even at scrollY 0.
 *
 * Rewind through the same wheel input path the captured scene already owns. Synthetic wheel events
 * are ignored by our user-intent guard, while the first real wheel from the operator immediately
 * cancels the startup guard so normal scrolling is never fought.
 */
function resetLandingPosition() {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  let userHasScrolled = false;
  const noteUserScroll = (event) => {
    if (event.isTrusted) userHasScrolled = true;
  };
  window.addEventListener("wheel", noteUserScroll, { capture: true, passive: true });

  const resetNativeScroll = () => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  };

  const rewindCapturedZoom = () => {
    if (userHasScrolled) return;
    resetNativeScroll();
    const aside = document.querySelector(".c-home-wrapper aside");
    if (!aside) return;
    const entered = parseFloat(getComputedStyle(aside).getPropertyValue("--scroll-aside")) || 0;
    if (entered <= 0.5) return;
    window.dispatchEvent(new WheelEvent("wheel", {
      deltaY: -10000,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      bubbles: true,
      cancelable: true,
    }));
  };

  resetNativeScroll();
  window.addEventListener("pageshow", resetNativeScroll, { once: true });
  window.addEventListener("load", resetNativeScroll, { once: true });
  requestAnimationFrame(() => requestAnimationFrame(resetNativeScroll));

  // The captured preload transition finishes a few seconds after this module mounts. Start the
  // rewind after that transition has had time to install its wheel listener, then stop as soon as
  // the opening is back at zero (or immediately if the operator has already supplied real input).
  let rewindTimer = null;
  const stopRewind = () => {
    if (rewindTimer != null) window.clearInterval(rewindTimer);
    rewindTimer = null;
    window.removeEventListener("wheel", noteUserScroll, { capture: true });
  };
  window.setTimeout(() => {
    if (userHasScrolled) return stopRewind();
    rewindCapturedZoom();
    rewindTimer = window.setInterval(() => {
      if (userHasScrolled) return stopRewind();
      const aside = document.querySelector(".c-home-wrapper aside");
      if (!aside) return;
      const entered = parseFloat(getComputedStyle(aside).getPropertyValue("--scroll-aside")) || 0;
      if (entered <= 0.5) return stopRewind();
      rewindCapturedZoom();
    }, 120);
  }, 3800);
  window.setTimeout(stopRewind, 9000);
}

resetLandingPosition();

async function selectState(state) {
  try {
    await showState(state);
  } catch (error) {
    console.error(`[setu] failed to open state ${state?.id ?? "unknown"}:`, error);
    app.panels?.setHint(`Could not open ${state?.name ?? "state"}: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  return app.standIns?.districts?.[`${state.id}/${district.id}`]
    ?? app.standIns?.districts?.[district.id]
    ?? null;
}

function districtSummary(state, entry) {
  const standIn = standInFor(state, entry.district);
  return {
    name: entry.district.name,
    live: Boolean(entry.district.scenarios?.length),
    scenarioCount: entry.district.scenarios?.length ?? 0,
    severity: entry.row?.severity ?? standIn?.severity ?? 0,
    failure_mode: standIn?.failure_mode ?? entry.row?.failure_mode ?? null,
    hazard: standIn?.hazard ?? null,
    asset_kind: standIn?.asset_kind ?? null,
    assets_requested: standIn?.assets_requested ?? null,
    settlements_estimated: standIn?.settlements_estimated ?? null,
    settlements_severe: standIn?.settlements_severe ?? null,
    area_km2: standIn?.area_km2 ?? null,
    provenance: standIn?.provenance ?? (entry.row?.live ? "engine" : "unknown"),
  };
}

/* --- views ------------------------------------------------------------------------------------ */

async function showState(state) {
  app.enteringDistrict = false;
  app.view = { kind: "state", state };
  app.rail.setActive(state.id);
  app.panels.showSourceContext();
  app.panels.setTrail([{ label: "India", kind: "nation" }, { label: state.name, kind: "state" }]);
  app.panels.hideDistrictSummary();
  app.panels.setHint("Select a district · full twins open village-level operations");
  setScene("state");

  const scene = buildStateScene({
    state,
    severityFor: (district) => severityFor({ ...district, stateId: state.id }),
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
    onPick: (entry) => enterDistrict(state, entry),
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
    app.panels.setHint(`${entry.district.name} · regional estimate only. No district twin is available yet, so SETU does not invent village-level evidence.`);
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
  await client.selectScenario(scenarioId);
  const [settlements, index] = await Promise.all([
    client.settlements(scenarioId),
    client.layerIndex(scenarioId).catch(() => ({ layers: [] })),
  ]);
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
  app.settlements = settlements;
  app.detail = null;
  app.activeRouteId = null;
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
    routes: snapshot.routes,
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

  const [coverage, decisions, metrics, disambiguation] = await Promise.all([
    client.coverage(scenario).catch(() => null),
    client.decisions(scenario).catch(() => []),
    client.metrics(scenario).catch(() => null),
    client.disambiguation().catch(() => []),
  ]);
  const silent = new Set(coverage?.without_reports || []);
  const routes = snapshot.routes || {};

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
    selectedId: app.detail?.settlementId || null,
    activeRouteId: app.activeRouteId,
    prePositions: app.current.snapshot.pre_positions || {},
  });
}

function setLens(lens) {
  if (!["fog", "belief", "response", "verify", "proof"].includes(lens)) return;
  app.lens = lens;
  app.detail = null;
  app.activeRouteId = null;
  app.rail?.setLens?.(lens);
  renderCurrent();
  if (app.view.kind !== "district") return;
  const shot = lens === "response" || lens === "proof" ? app.scene?.plan : app.scene?.overview;
  if (shot) app.stage.rig.flyTo({ ...shot, duration: 1100 });
}

function setFogMode(mode) {
  if (mode !== "reports" && mode !== "setu") return;
  app.fogMode = mode;
  renderCurrent();
}

function selectDispatch(task) {
  if (!task) return;
  app.activeRouteId = task.route_id || null;
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
  app.unsubscribe?.();
  app.unsubscribe = null;
  app.view = { kind: "nation" };
  app.rail.setActive(null);
  app.stage.show(null);
  app.stage.stop();
  app.scene = null;
  app.enteringDistrict = false;
  app.current = null;
  app.detail = null;
  app.activeRouteId = null;
  setScene("nation");
  app.panels.hideDistrictSummary();
  app.panels.showSourceContext();
  app.panels.setTrail([{ label: "India", kind: "nation" }]);
  app.panels.setHint("Select a state to enter the response atlas");
}

async function goBack(step) {
  if (step.kind === "nation") return showNation();
  if (step.kind === "state" && app.view.state) {
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
  if (!result) {
    app.panels.setHint("Historical replay cannot be stress-tested. Connect the live command engine to inject failures.");
    return;
  }
  app.panels.setHint(
    `${attack.replace("_", " ")} · rank churn ${result.rank_churn ?? "—"} · ${result.note ?? "the model has been told"}`,
  );
  if (result.state) await renderDistrict(result.state);
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
    onFogMode: (mode) => setFogMode(mode),
    onVerify: (id, result, settlementId) => runVerification(id, result, settlementId),
    onResolveLocation: (obsId, settlementId) => resolveLocation(obsId, settlementId),
    onSelectBlock: (block) => selectBlock(block),
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

  const [atlas, standIns] = await Promise.all([client.atlas(), client.standIns()]);
  app.atlas = atlas;
  app.standIns = standIns;
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

boot().catch((error) => {
  // A layer that cannot reach its own data says so in the place the numbers would have been, rather
  // than leaving the site looking like it merely forgot to render them.
  const { chrome } = mount();
  chrome.append(el("div.setu-card.setu-disclosure", {
    text: `SETU could not start: ${error.message}. The operational shell is still available.`,
  }));
  console.error("[setu]", error);
});
