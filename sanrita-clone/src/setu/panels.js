/**
 * SETU's operational story, rendered into San Rita's existing edge chrome.
 *
 * The district has five lenses rather than five simultaneous dashboards:
 * fog -> belief -> response -> verify -> proof. The center terrain never leaves; this module only
 * changes what the edge surfaces explain about the same engine snapshot.
 */

import { el, clear } from "./dom.js";
import { severityCss } from "./palette.js";

export const LENSES = [
  { id: "fog", label: "Fog" },
  { id: "belief", label: "Belief" },
  { id: "response", label: "Response" },
  { id: "verify", label: "Verify" },
  { id: "proof", label: "Proof" },
];

const percent = (value) => value == null ? "—" : `${(Math.max(0, Math.min(1, Number(value) || 0)) * 100).toFixed(0)}%`;
const minutes = (value) => (value == null ? "—" : `${Number(value).toFixed(0)}m`);
const number = (value, digits = 0) => value == null || !Number.isFinite(Number(value))
  ? "—"
  : Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits });
const short = (hash) => (hash ? `${hash.slice(0, 8)}…` : "—");
const clock = (iso) => (iso ? new Date(iso).toISOString().slice(11, 16) : "—");
const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : "—");

function panel(title, note) {
  const body = el("div.setu-rows");
  const noteNode = el("div.setu-panel-note", { text: note || "" });
  const titleNode = el("div.setu-panel-title", { text: title });
  const node = el("section.setu-card.setu-panel", {}, [
    el("div.setu-panel-head", {}, [titleNode, noteNode]),
    body,
  ]);
  return { node, body, note: noteNode, title: titleNode };
}

function row({ name, meta, value, bar, colour, onClick, className = "" }) {
  const children = [
    el("div.setu-row-name", {}, [
      el("span", { text: name }),
      meta ? el("div.setu-row-meta", { text: meta }) : null,
    ]),
    el("div.setu-row-value", { text: value ?? "" }),
  ];
  if (bar != null) {
    const fill = el("i", { style: { width: percent(bar) } });
    children.push(el("div.setu-meter", { style: colour ? { "--setu-fill": colour } : {} }, [fill]));
  }
  const node = el(onClick ? "button.setu-row" : "div.setu-row",
    onClick ? { type: "button", onclick: onClick } : {}, children);
  if (className) node.classList.add(...className.split(/\s+/).filter(Boolean));
  return node;
}

function section(label, note = "") {
  return el("div.setu-subsection-head", {}, [
    el("span", { text: label }),
    note ? el("span", { text: note }) : null,
  ]);
}

function metricGrid(items) {
  return el("div.setu-metric-grid", {}, items.map(item =>
    el("div.setu-metric", {}, [
      el("strong", { text: item.value }),
      el("span", { text: item.label }),
      item.meta ? el("small", { text: item.meta }) : null,
    ])));
}

function actionStrip(actions, { className = "" } = {}) {
  const node = el("div.setu-action-strip");
  if (className) node.classList.add(className);
  actions.forEach(action => {
    const button = el("button.setu-button.setu-button-compact", {
      type: "button",
      text: action.label,
      disabled: action.disabled,
      title: action.title || null,
      onclick: action.onClick,
    });
    if (action.active) button.setAttribute("aria-pressed", "true");
    node.append(button);
  });
  return node;
}

/** Collapse the engine's per-mode belief rows into one worst-case row per settlement. */
export function worstBySettlement(beliefs, names = new Map()) {
  const worst = new Map();
  for (const belief of beliefs || []) {
    const current = worst.get(belief.settlement_id);
    if (!current || belief.probability > current.probability) {
      worst.set(belief.settlement_id, {
        ...belief, name: names.get(belief.settlement_id) || belief.settlement_id,
      });
    }
  }
  return worst;
}

export function createPanels({
  chrome,
  onSelectVillage,
  onSelectDispatch,
  onCloseDetail,
  onScrub,
  onFlood,
  onInject,
  onSeismic,
  onLens,
  onFogMode,
  onVerify,
  onResolveLocation,
  onSelectBlock,
  onBack,
}) {
  const crumbs = el("div.setu-crumb-trail", { style: { display: "flex", gap: "8px", alignItems: "center" } });
  const sourceChip = el("div.setu-source", { text: "connecting" });
  const breadcrumb = el("nav.setu-card.setu-breadcrumb", { "aria-label": "SETU location" }, [crumbs, sourceChip]);

  const context = el("section.setu-card.setu-context");
  const tip = el("div.setu-card.setu-tip", { "data-shown": "false" });
  const hint = el("div.setu-card.setu-hint", { text: "Select a district to open its operational twin" });

  const dossierPanel = panel("Information fog", "what the EOC hears");
  const dossier = el("aside.setu-dossier", { "aria-label": "SETU operational dossier" }, [dossierPanel.node]);

  const districtSummary = panel("District", "select a district");
  districtSummary.node.classList.add("setu-state-summary");
  districtSummary.node.setAttribute("data-shown", "false");

  const controls = buildControls({ onScrub, onFlood, onInject, onSeismic, onLens });
  chrome.append(breadcrumb, context, districtSummary.node, dossier, controls.node, tip, hint);

  let names = new Map();
  let sourceDisclosure = "";

  const panels = {
    tip,
    controls,

    setSource(source) {
      sourceChip.textContent = source.mode === "engine" ? "live command engine" : "historical replay";
      sourceChip.title = source.disclosure || "";
      sourceDisclosure = source.disclosure || "";
      controls.setLive(source.mode === "engine");
      panels.showSourceContext();
    },

    showSourceContext() {
      clear(context).append(
        el("div.setu-context-kicker", { text: "SETU SOURCE" }),
        el("p.setu-context-copy", { text: sourceDisclosure || "District command data is loading." }),
      );
    },

    setTrail(trail) {
      clear(crumbs);
      trail.forEach((step, index) => {
        if (index) crumbs.append(el("span.setu-crumb-sep", { text: "/" }));
        crumbs.append(el("button.setu-crumb", {
          type: "button",
          "aria-current": index === trail.length - 1 ? "true" : null,
          disabled: index === trail.length - 1,
          text: step.label,
          onclick: () => (index === trail.length - 1 ? null : onBack?.(step, index)),
        }));
      });
    },

    setHint(text) {
      hint.textContent = text || "";
      hint.style.display = text ? "" : "none";
    },

    setNames(settlements) {
      names = new Map((settlements || []).map(settlement => [settlement.id, settlement.name]));
    },

    showDistrictSummary(summary) {
      districtSummary.title.textContent = summary.name || "District";
      districtSummary.note.textContent = summary.live
        ? "full operational twin available"
        : `${summary.provenance || "unknown"} · regional estimate`;
      clear(districtSummary.body);
      districtSummary.body.append(row({
        name: "Threat belief",
        meta: summary.live ? "district model available" : "regional prioritisation only",
        value: percent(summary.severity),
        bar: summary.severity,
        colour: severityCss(summary.severity),
      }));
      districtSummary.body.append(row({
        name: "Likely failure",
        meta: summary.hazard || (summary.live ? "resolved inside district twin" : "unclassified"),
        value: summary.failure_mode || (summary.live ? "MULTI-MODE" : "—"),
      }));
      if (summary.settlements_estimated != null) districtSummary.body.append(row({
        name: "Severe settlements", meta: `${summary.settlements_estimated} estimated`, value: String(summary.settlements_severe ?? "—"),
      }));
      if (summary.assets_requested != null || summary.asset_kind) districtSummary.body.append(row({
        name: "Response demand", meta: summary.asset_kind || "requested asset", value: summary.assets_requested == null ? "—" : String(summary.assets_requested),
      }));
      districtSummary.body.append(row({
        name: "Twin coverage",
        meta: summary.live ? `${summary.scenarioCount || 1} scenario model · opens the district command story` : "no village-level twin",
        value: summary.live ? "FULL" : "REGIONAL",
      }));
      districtSummary.node.setAttribute("data-shown", "true");
    },

    hideDistrictSummary() {
      districtSummary.node.setAttribute("data-shown", "false");
    },

    showTip(text, meta, at) {
      if (!text || !at) {
        tip.setAttribute("data-shown", "false");
        return;
      }
      clear(tip).append(el("b", { text }), meta ? el("span", { text: meta }) : "");
      tip.style.left = `${at[0]}px`;
      tip.style.top = `${at[1]}px`;
      tip.setAttribute("data-shown", "true");
    },

    renderDistrict(model) {
      controls.setLens(model.lens);
      if (model.detail?.receipt) {
        renderReceipt({ panel: dossierPanel, context, model, onCloseDetail });
        return;
      }
      if (model.lens === "fog") renderFog({ panel: dossierPanel, context, model, onSelectVillage, onFogMode, onResolveLocation });
      if (model.lens === "belief") renderBelief({ panel: dossierPanel, context, model, onSelectVillage, onSelectBlock });
      if (model.lens === "response") renderResponse({ panel: dossierPanel, context, model, onSelectDispatch });
      if (model.lens === "verify") renderVerify({ panel: dossierPanel, context, model, onVerify, onSelectVillage });
      if (model.lens === "proof") renderProof({ panel: dossierPanel, context, model });
    },
  };

  return panels;
}

function renderContext(context, kicker, title, items, note = "") {
  clear(context).append(
    el("div.setu-context-kicker", { text: kicker }),
    el("div.setu-context-title", { text: title }),
    metricGrid(items),
    note ? el("p.setu-context-copy", { text: note }) : null,
  );
}

function reportRanking(model) {
  return [...(model.coverage?.settlements || [])].sort((a, b) => (b.messages || 0) - (a.messages || 0));
}

function riskRanking(model) {
  return [...model.worst].sort((a, b) => b.probability - a.probability);
}

function renderFog({ panel, context, model, onSelectVillage, onFogMode, onResolveLocation }) {
  const totals = model.coverage?.totals || {};
  const reports = reportRanking(model);
  const risks = riskRanking(model);
  const silentCount = model.silent.size;
  const messages = totals.messages_ingested ?? totals.messages ?? totals.observations ?? 0;
  const distinct = totals.distinct_claims ?? 0;
  const redundancy = distinct > 0 ? `${(messages / distinct).toFixed(1)}×` : "—";
  renderContext(context, "01 · INFORMATION FOG", "What arrived is not ground truth", [
    { value: number(messages), label: "RAW MESSAGES" },
    { value: number(distinct), label: "DISTINCT CLAIMS" },
    { value: number(totals.unresolved_locations ?? 0), label: "UNRESOLVED" },
    { value: `${silentCount} / ${model.settlements.length}`, label: "VILLAGES SILENT" },
    { value: redundancy, label: "REDUNDANCY" },
  ], "Collapse noise, locate claims, and notice where nothing arrived at all.");

  panel.title.textContent = model.fogMode === "reports" ? "What the EOC hears" : "What SETU believes";
  panel.note.textContent = model.fogMode === "reports" ? "ranked by report volume" : "same moment · fused priority";
  clear(panel.body).append(actionStrip([
    { label: "Reports", active: model.fogMode === "reports", onClick: () => onFogMode?.("reports") },
    { label: "SETU", active: model.fogMode === "setu", onClick: () => onFogMode?.("setu") },
  ], { className: "setu-compare-strip" }));

  if (model.fogMode === "reports") {
    reports.slice(0, 10).forEach((entry, index) => panel.body.append(row({
      name: `${String(index + 1).padStart(2, "0")} ${model.names.get(entry.settlement_id) || entry.settlement_id}`,
      meta: `${number(entry.claims || 0)} claims · ${number(entry.independent_sources || 0)} independent sources`,
      value: `${number(entry.messages || 0)} msg`,
      onClick: () => onSelectVillage?.(entry.settlement_id),
    })));
  } else {
    const reportRank = new Map(reports.map((entry, index) => [entry.settlement_id, index + 1]));
    risks.slice(0, 10).forEach((entry, index) => {
      const oldRank = reportRank.get(entry.settlement_id);
      const delta = oldRank == null ? null : oldRank - (index + 1);
      const silent = model.silent.has(entry.settlement_id);
      panel.body.append(row({
        name: `${String(index + 1).padStart(2, "0")} ${entry.name}`,
        meta: `${entry.failure_mode.toLowerCase()} · confidence ${percent(entry.confidence)}${silent ? " · no reports" : ""}`,
        value: `${percent(entry.probability)}${typeof delta === "number" && delta !== 0 ? ` · ${delta > 0 ? "↑" : "↓"}${Math.abs(delta)}` : ""}`,
        bar: entry.probability,
        colour: severityCss(entry.probability),
        onClick: () => onSelectVillage?.(entry.settlement_id),
      }));
    });
  }

  panel.body.append(section("Signal collapse", `${number(messages)} messages → ${number(distinct)} claims`));
  panel.body.append(row({ name: "Located messages", meta: "could be tied to a settlement", value: number(totals.messages_located ?? 0) }));
  panel.body.append(row({ name: "Evidence rows", meta: "machine + human channels after ingestion", value: number(totals.evidence_rows ?? 0) }));

  const open = (model.disambiguation || []).filter(item => item.state === "open").slice(0, 3);
  if (open.length) {
    panel.body.append(section("Unresolved locations", "operator refuses to guess"));
    open.forEach(item => {
      const text = String(item.payload?.text_en ?? item.payload?.text_orig ?? "Unlocated incoming report").slice(0, 92);
      const surface = String(item.payload?.geo_surface ?? "").toLowerCase().trim();
      panel.body.append(row({ name: `“${text}”`, meta: `${surface || "unknown place"} · confidence ${Number(item.payload?.geo_confidence ?? 0).toFixed(2)}`, value: "" }));
      const candidates = surface
        ? model.settlements.filter(s => s.name.toLowerCase().includes(surface)
          || (s.name_variants || []).some(v => v.toLowerCase().includes(surface))).slice(0, 3)
        : [];
      if (candidates.length) panel.body.append(actionStrip(candidates.map(candidate => ({
        label: candidate.name,
        onClick: () => onResolveLocation?.(item.obs_id, candidate.id),
      }))));
    });
  } else if ((totals.unresolved_locations ?? 0) > 0) {
    panel.body.append(row({
      name: `${totals.unresolved_locations} unresolved locations`,
      meta: model.live ? "waiting for operator resolution" : "payloads were not included in this historical bake",
      value: model.live ? "OPEN" : "REPLAY",
    }));
  }
}

function blockStats(model) {
  const blocks = new Map();
  model.settlements.forEach(settlement => {
    const held = blocks.get(settlement.block) || { block: settlement.block, settlements: 0, critical: 0, silent: 0, assets: 0 };
    held.settlements += 1;
    const risk = model.worstMap.get(settlement.id)?.probability ?? 0;
    if (risk >= 0.6) held.critical += 1;
    if (model.silent.has(settlement.id)) held.silent += 1;
    blocks.set(settlement.block, held);
  });
  (model.snapshot.plan || []).forEach(task => {
    const settlement = model.settlementMap.get(task.settlement_id);
    const held = settlement ? blocks.get(settlement.block) : null;
    if (held) held.assets += 1;
  });
  return [...blocks.values()].sort((a, b) => b.critical - a.critical);
}

function renderBelief({ panel, context, model, onSelectVillage, onSelectBlock }) {
  const blocks = blockStats(model);
  renderContext(context, "02 · RISK BELIEF", "Every settlement has a belief", blocks.map(block => ({
    value: `${block.critical} / ${block.settlements}`,
    label: block.block.toUpperCase(),
    meta: `${block.silent} silent · ${block.assets} assets`,
  })), "Failure mode matters as much as severity: collapse, inundation, landslide and casualty require different responses.");
  context.querySelectorAll(".setu-metric").forEach((node, index) => {
    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.addEventListener("click", () => onSelectBlock?.(blocks[index]?.block));
    node.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") onSelectBlock?.(blocks[index]?.block);
    });
  });

  panel.title.textContent = "Risk belief";
  panel.note.textContent = `${model.worst.length} villages · highest current risk`;
  clear(panel.body);
  riskRanking(model).slice(0, 14).forEach((entry, index) => panel.body.append(row({
    name: `${String(index + 1).padStart(2, "0")} ${entry.name}`,
    meta: `${entry.failure_mode.toLowerCase()} · confidence ${percent(entry.confidence)}${model.silent.has(entry.settlement_id) ? " · silent" : ""}`,
    value: percent(entry.probability),
    bar: entry.probability,
    colour: severityCss(entry.probability),
    onClick: () => onSelectVillage?.(entry.settlement_id),
  })));
}

function routeFor(model, task) {
  return task.route || model.routes?.[task.route_id]
    || Object.values(model.routes || {}).find(route => route.route_id === task.route_id) || null;
}

function renderResponse({ panel, context, model, onSelectDispatch }) {
  const plan = model.snapshot.plan || [];
  const lives = plan.reduce((sum, task) => sum + Number(task.expected_lives_saved || 0), 0);
  const degraded = plan.filter(task => {
    const route = routeFor(model, task);
    return route?.status && route.status !== "open";
  }).length;
  const pre = Object.entries(model.snapshot.pre_positions || {})
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.probability - a.probability);
  renderContext(context, "03 · RESPONSE PLAN", "Turn belief into movement", [
    { value: number(plan.length), label: "ACTIVE TASKS" },
    { value: number(lives), label: "EXPECTED LIVES SAVED" },
    { value: number(degraded), label: "ROUTES DEGRADED" },
    { value: number(pre.length), label: "CASCADE LEADS" },
  ], "The queue is ordered by expected lives saved, not by who sent the most messages.");

  panel.title.textContent = "Resource dispatch";
  panel.note.textContent = plan.length ? `${plan.length} assignments · route-aware` : "no active tasks";
  clear(panel.body);
  plan.forEach(task => {
    const route = routeFor(model, task);
    panel.body.append(row({
      name: `${String(task.seq).padStart(2, "0")} ${task.settlement_name || model.names.get(task.settlement_id) || task.settlement_id}`,
      meta: `${task.asset_id || task.asset_kind} · ${task.failure_mode.toLowerCase()} · ${route?.status || task.access_mode || "route unknown"}`,
      value: `${minutes(task.eta_minutes)} · +${number(task.expected_lives_saved)} lives`,
      className: model.activeRouteId && model.activeRouteId === (task.route_id || route?.route_id) ? "setu-row-active" : "",
      onClick: () => onSelectDispatch?.(task),
    }));
  });
  if (!plan.length) panel.body.append(row({ name: "No resources dispatched yet", value: "" }));

  if (pre.length) {
    panel.body.append(section("Ahead of the event", "cascade pre-position candidates"));
    pre.slice(0, 5).forEach(candidate => panel.body.append(row({
      name: model.names.get(candidate.id) || candidate.id,
      meta: `cascade from ${model.names.get(candidate.source) || candidate.source} · lead ${minutes(candidate.eta_minutes)}`,
      value: percent(candidate.probability),
      onClick: () => onSelectDispatch?.({ settlement_id: candidate.id, route_id: null, preposition: true }),
    })));
  }
}

function renderVerify({ panel, context, model, onVerify, onSelectVillage }) {
  const tasks = (model.snapshot.verify || []).filter(task => task.state !== "resolved").sort((a, b) => b.voi_score - a.voi_score);
  const top = tasks[0];
  renderContext(context, "04 · VERIFY NEXT", "Spend scarce verification where it changes a decision", [
    { value: number(tasks.length), label: "OPEN QUESTIONS" },
    { value: top ? number(top.voi_score, 2) : "—", label: "HIGHEST VOI" },
    { value: top ? minutes(top.minutes) : "—", label: "FASTEST HIGH-VALUE CHECK" },
  ], model.live ? "Verification returns re-enter the same belief engine and can reorder dispatch." : "This replay is read-only. Connect the live command engine to submit a verification return.");

  panel.title.textContent = "Verify next";
  panel.note.textContent = tasks.length ? "highest value of information first" : "queue clear";
  clear(panel.body);
  if (!top) {
    panel.body.append(row({ name: "No verification would change the current plan", value: "" }));
    return;
  }

  const settlement = model.names.get(top.settlement_id) || top.settlement_id;
  panel.body.append(el("div.setu-featured-question", {}, [
    el("div.setu-featured-question__name", { text: settlement }),
    el("div.setu-featured-question__action", { text: top.action }),
    el("div.setu-featured-question__meta", { text: `${minutes(top.minutes)} · resolves ${top.resolves}` }),
    el("div.setu-featured-question__voi", { text: `VOI ${number(top.voi_score, 2)}` }),
    actionStrip([
      { label: "Severe", disabled: !model.live, onClick: () => onVerify?.(top.id, "confirmed_severe", top.settlement_id) },
      { label: "Intact", disabled: !model.live, onClick: () => onVerify?.(top.id, "confirmed_intact", top.settlement_id) },
      { label: "Unclear", disabled: !model.live, onClick: () => onVerify?.(top.id, "inconclusive", top.settlement_id) },
    ]),
  ]));

  if (tasks.length > 1) panel.body.append(section("Queue", `${tasks.length - 1} more questions`));
  tasks.slice(1, 7).forEach(task => panel.body.append(row({
    name: model.names.get(task.settlement_id) || task.settlement_id,
    meta: `${task.action} · ${minutes(task.minutes)} · ${task.resolves}`,
    value: `VOI ${number(task.voi_score, 1)}`,
    onClick: () => onSelectVillage?.(task.settlement_id),
  })));
}

function renderProof({ panel, context, model }) {
  const operational = model.metrics?.operational || {};
  const equity = model.metrics?.equity || {};
  const robustness = model.metrics?.robustness || {};
  const audit = model.metrics?.audit || {};
  renderContext(context, "05 · PROOF", "A decision should be defensible", [
    { value: percent(operational.top_k_recall), label: "TOP-K RECALL" },
    { value: percent(operational.silent_zone_recall), label: "SILENT-ZONE RECALL" },
    { value: percent(operational.asset_type_accuracy), label: "ASSET-TYPE ACCURACY" },
    { value: equity.gap == null ? "—" : `${equity.gap >= 0 ? "+" : ""}${Number(equity.gap).toFixed(3)}`, label: "EQUITY GAP" },
  ], model.metrics?.disclosure || "Validation and provenance stay visible with the operational output.");

  panel.title.textContent = "Proof";
  panel.note.textContent = "audit · robustness · equity";
  clear(panel.body);

  panel.body.append(section("Decision ledger", audit.hash_chain_valid === false ? "integrity failure" : "tamper-evident"));
  panel.body.append(row({
    name: audit.hash_chain_valid === false ? "Ledger integrity failed" : "Ledger verified",
    meta: audit.hash_chain_valid === false ? "a decision link no longer matches" : "every recorded decision is cryptographically linked",
    value: `${number(audit.entries ?? model.decisions.length)} entries`,
    className: audit.hash_chain_valid === false ? "setu-row-alert" : "",
  }));
  (model.decisions || []).slice(-4).reverse().forEach(entry => panel.body.append(row({
    name: `#${entry.id} ${short(entry.entry_hash)}`,
    meta: `${day(entry.sim_t)} ${clock(entry.sim_t)} · belief ${short(entry.belief_hash)}`,
    value: "",
  })));

  panel.body.append(section("Robustness", "what happened under attack"));
  panel.body.append(row({ name: "Injected events", meta: "false reports / outages / scenario attacks", value: number(robustness.injected_events ?? 0) }));
  panel.body.append(row({ name: "Top-10 displacement", meta: "rank movement after the latest attack", value: number(robustness.top10_rank_displacement ?? 0) }));
  panel.body.append(row({ name: "Disabled channels", meta: "sensor feeds currently unavailable", value: robustness.disabled_channels?.length ? robustness.disabled_channels.join(", ") : "NONE" }));

  panel.body.append(section("Equity check", "low-observability settlements remain visible"));
  panel.body.append(row({ name: "District mean priority", value: equity.district_mean_priority == null ? "—" : Number(equity.district_mean_priority).toFixed(3) }));
  panel.body.append(row({ name: "Disadvantaged mean priority", meta: "SC/ST + kutcha share", value: equity.disadvantaged_mean_priority == null ? "—" : Number(equity.disadvantaged_mean_priority).toFixed(3) }));
  panel.body.append(row({
    name: "Priority gap",
    meta: equity.gap >= 0 ? "at or above district mean" : "below district mean · review required",
    value: equity.gap == null ? "—" : `${equity.gap >= 0 ? "+" : ""}${Number(equity.gap).toFixed(3)}`,
    className: equity.gap < 0 ? "setu-row-alert" : "",
  }));
}

function renderReceipt({ panel, context, model, onCloseDetail }) {
  const receipt = model.detail.receipt;
  const settlement = receipt.settlement || {};
  const posterior = [...(receipt.posterior || [])].sort((a, b) => b.probability - a.probability);
  const dominant = posterior[0];
  renderContext(context, "EVIDENCE RECEIPT", settlement.name || "Selected settlement", [
    { value: dominant ? percent(dominant.probability) : "—", label: dominant?.failure_mode || "TOP FAILURE" },
    { value: dominant ? percent(dominant.confidence) : "—", label: "CONFIDENCE" },
    { value: number(settlement.population), label: "POPULATION" },
    { value: settlement.observability == null ? "—" : Number(settlement.observability).toFixed(2), label: "OBSERVABILITY" },
  ], receipt.unavailable || "Every counted and contradicting evidence row remains visible below.");

  panel.title.textContent = "Evidence receipt";
  panel.note.textContent = `${settlement.block || "—"} · ${receipt.t ? `${day(receipt.t)} ${clock(receipt.t)}` : "current snapshot"}`;
  clear(panel.body).append(actionStrip([{ label: "← Back", onClick: () => onCloseDetail?.() }]));

  panel.body.append(section("Failure modes", "posterior belief"));
  posterior.forEach(belief => panel.body.append(row({
    name: belief.failure_mode,
    meta: `confidence ${percent(belief.confidence)}`,
    value: percent(belief.probability),
    bar: belief.probability,
    colour: severityCss(belief.probability),
  })));

  if (receipt.unavailable) {
    panel.body.append(section("Evidence rows", "not included in this replay bundle"));
    panel.body.append(row({ name: "Recorded posterior only", meta: receipt.unavailable, value: "REPLAY" }));
    return;
  }

  const priorByMode = new Map((receipt.prior || []).map(item => [item.failure_mode, item]));
  if (dominant) {
    const prior = priorByMode.get(dominant.failure_mode);
    panel.body.append(section("Belief movement", dominant.failure_mode));
    panel.body.append(row({ name: "Prior", meta: "before incoming evidence", value: prior ? percent(prior.probability) : "—" }));
    panel.body.append(row({ name: "Posterior", meta: "after counted evidence", value: percent(dominant.probability), bar: dominant.probability, colour: severityCss(dominant.probability) }));
  }

  panel.body.append(section("Evidence ledger", `${(receipt.evidence || []).length} rows`));
  [...(receipt.evidence || [])]
    .sort((a, b) => Date.parse(a.ts || 0) - Date.parse(b.ts || 0))
    .slice(-14)
    .forEach(evidence => panel.body.append(row({
      name: evidence.channel.replace(/_/g, " "),
      meta: `${clock(evidence.ts)} · ${evidence.failure_mode.toLowerCase()} · ${evidence.correlation_group}${evidence.raw_ref ? ` · ${evidence.raw_ref}` : ""}${evidence.superseded ? " · superseded" : ""}`,
      value: `${Number(evidence.log_lr) >= 0 ? "+" : ""}${Number(evidence.log_lr).toFixed(2)}`,
      className: `${evidence.log_lr < 0 ? "setu-evidence-against" : ""} ${evidence.superseded ? "setu-evidence-superseded" : ""}`,
    })));
}

/* --- controls --------------------------------------------------------------------------------- */

function buildControls({ onScrub, onFlood, onInject, onSeismic, onLens }) {
  const time = el("input.setu-slider", { type: "range", min: "0", max: "1000", value: "0", "aria-label": "Replay position" });
  const timeOut = el("output", { text: "—" });
  const flood = el("input.setu-slider", { type: "range", min: "0", max: "12", step: "0.25", value: "0", "aria-label": "Flood stage in metres" });
  const floodOut = el("output", { text: "0.0 m" });

  const lensButtons = new Map();
  const lensGroup = el("div.setu-button-group.setu-lens-group");
  LENSES.forEach(item => {
    const button = el("button.setu-button", { type: "button", text: item.label, onclick: () => onLens?.(item.id) });
    lensButtons.set(item.id, button);
    lensGroup.append(button);
  });

  const engineOnly = [];
  const stressActions = el("div.setu-stress-actions", { hidden: true });
  const attack = (id, label, title) => {
    const button = el("button.setu-button", { type: "button", text: label, title, onclick: () => onInject?.(id) });
    engineOnly.push(button);
    return button;
  };
  const seismicButton = el("button.setu-button", { type: "button", text: "Inject earthquake", title: "Arm the scenario, then click the terrain to place an epicentre" });
  seismicButton.setAttribute("aria-pressed", "false");
  seismicButton.addEventListener("click", () => {
    const armed = seismicButton.getAttribute("aria-pressed") !== "true";
    seismicButton.setAttribute("aria-pressed", String(armed));
    onSeismic?.(armed);
  });
  engineOnly.push(seismicButton);
  stressActions.append(
    attack("false_reports", "False reports", "Inject two hundred forwarded severe reports"),
    attack("silence", "Cut telecom", "Drop telecom telemetry to zero"),
    attack("kill_sar", "Drop satellite", "Disable the satellite channel"),
    seismicButton,
  );
  const stressToggle = el("button.setu-button.setu-stress-toggle", { type: "button", text: "Stress test" });
  stressToggle.setAttribute("aria-expanded", "false");
  stressToggle.addEventListener("click", () => {
    const open = stressToggle.getAttribute("aria-expanded") !== "true";
    stressToggle.setAttribute("aria-expanded", String(open));
    stressActions.hidden = !open;
  });
  const engineNote = el("div.setu-panel-note.setu-engine-note", { text: "" });

  const node = el("div.setu-card.setu-controls", {}, [
    el("div.setu-control-row", {}, [el("label", { text: "Replay" }), time, timeOut]),
    el("div.setu-control-row", {}, [el("label", { text: "Lens" }), lensGroup]),
    el("div.setu-control-row", {}, [el("label", { text: "Flood stage" }), flood, floodOut]),
    el("div.setu-control-row.setu-stress-row", {}, [el("label", { text: "Scenario" }), stressToggle]),
    stressActions,
    engineNote,
  ]);

  time.addEventListener("input", () => onScrub?.(Number(time.value) / 1000));
  flood.addEventListener("input", () => {
    floodOut.textContent = `${Number(flood.value).toFixed(1)} m`;
    onFlood?.(Number(flood.value));
  });

  return {
    node,
    setWindow(start, end, current) {
      if (!start || !end) return;
      const span = new Date(end).getTime() - new Date(start).getTime();
      const at = new Date(current || start).getTime() - new Date(start).getTime();
      if (span > 0) time.value = String(Math.round((at / span) * 1000));
      timeOut.textContent = `${day(current || start)} ${clock(current || start)}`;
    },
    setFloodStage(metres) {
      flood.value = String(metres);
      floodOut.textContent = `${Number(metres).toFixed(1)} m`;
    },
    setLens(lens) {
      lensButtons.forEach((button, id) => button.setAttribute("aria-pressed", String(id === lens)));
    },
    setLive(isLive) {
      engineOnly.forEach(button => { button.disabled = !isLive; });
      engineNote.textContent = isLive
        ? "Stress tests and verification returns act on the live command engine."
        : "Historical replay · verification and stress tests are read-only.";
    },
    releaseSeismic() {
      seismicButton.setAttribute("aria-pressed", "false");
    },
  };
}
