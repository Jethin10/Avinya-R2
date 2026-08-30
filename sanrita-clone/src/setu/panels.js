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
function replayDateParts(iso) {
  if (!iso) return { day: "—", clock: "—" };
  const literal = String(iso).match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  if (literal) return { day: literal[1], clock: literal[2] };
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return { day: "—", clock: "—" };
  const normalized = parsed.toISOString();
  return { day: normalized.slice(0, 10), clock: normalized.slice(11, 16) };
}
const clock = (iso) => replayDateParts(iso).clock;
const day = (iso) => replayDateParts(iso).day;

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

function districtBox(title, note, children = [], className = "") {
  const node = el("section.setu-district-box", {}, [
    el("div.setu-district-box-head", {}, [
      el("span", { text: title }),
      note ? el("span", { text: note }) : null,
    ]),
    ...children.filter(Boolean),
  ]);
  if (className) node.classList.add(...className.split(/\s+/).filter(Boolean));
  return node;
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

function option(value, label) {
  return el("option", { value, text: label });
}

function consoleField(label, control, note = "") {
  return el("label.setu-console-field", {}, [
    el("span", { text: label }),
    control,
    note ? el("small", { text: note }) : null,
  ]);
}

/**
 * The live Engine's less-frequent controls belong in one deliberate surface, not scattered through
 * the five operational lenses. This console is also the demo index: each capability names what the
 * audience should look for, then hands the terrain back to the corresponding lens.
 */
function buildCommandConsole({ onScenario, onClock, onEvent, onOverride, onStoryLens, onOpenTwin, onInject }) {
  const backdrop = el("button.setu-console-backdrop", { type: "button", "aria-label": "Close command console" });
  const closeButton = el("button.setu-console-close", { type: "button", text: "Close" });
  const status = el("div.setu-console-status", { text: "Connecting to command engine…" });
  const feedback = el("div.setu-console-feedback", { text: "Choose a capability to begin." });
  const contextKicker = el("span.setu-console-context-kicker", { text: "NO DISTRICT SELECTED" });
  const contextTitle = el("strong.setu-console-context-title", { text: "National overview" });
  const contextMeta = el("p.setu-console-context-meta", {
    text: "Choose a state and district before entering the operational chain.",
  });
  const openTwinButton = el("button.setu-button.setu-console-open-twin", {
    type: "button", text: "Open district twin", disabled: true,
  });
  const liveLock = el("div.setu-console-live-lock", {
    text: "LIVE ENGINE ONLY · field mutation, stress tests and human overrides are intentionally locked in a historical replay.",
  });

  const scenario = el("select.setu-console-input", { "aria-label": "Scenario" });
  const openReplayButton = el("button.setu-button.setu-console-open-replay", {
    type: "button", text: "Open selected replay", disabled: true,
  });
  const speed = el("select.setu-console-input", { "aria-label": "Replay speed" }, [
    option("1", "1× real time"), option("30", "30×"), option("120", "120×"),
    option("300", "300× demo"), option("600", "600×"),
  ]);
  speed.value = "300";

  const settlement = el("select.setu-console-input", { "aria-label": "Observation settlement" });
  const report = el("textarea.setu-console-input.setu-console-textarea", {
    rows: "3", "aria-label": "Field report", placeholder: "What did the field team observe?",
  });
  const hazard = el("select.setu-console-input", { "aria-label": "Hazard" }, [
    option("landslide", "Landslide"), option("flood", "Flood"), option("earthquake", "Earthquake"), option("unknown", "Unknown"),
  ]);
  const severity = el("select.setu-console-input", { "aria-label": "Severity hint" }, [
    option("severe", "Severe"), option("moderate", "Moderate"), option("minor", "Minor"), option("unknown", "Unknown"),
  ]);
  const reportButton = el("button.setu-button.setu-console-primary", { type: "button", text: "Send live observation" });

  const decision = el("select.setu-console-input", { "aria-label": "Decision to override" });
  const reason = el("textarea.setu-console-input.setu-console-textarea", {
    rows: "2", "aria-label": "Override reason", placeholder: "Operational reason for the human override",
  });
  const overrideButton = el("button.setu-button", { type: "button", text: "Record human override" });

  const demoSteps = [
    ["fog", "01", "Reports vs risk", "See message volume, silence and unresolved locations."],
    ["belief", "02", "Belief", "Open the ranked multi-hazard settlement model."],
    ["response", "03", "Dispatch", "Follow asset-typed routes and cascade leads."],
    ["verify", "04", "Verify next", "Show the highest-value question and return path."],
    ["proof", "05", "Proof", "Finish on robustness, equity and the audit chain."],
  ];
  const storyButtons = new Map();
  const demoList = el("div.setu-demo-list", {}, demoSteps.map(([lens, index, title, copy]) => {
    const button = el("button.setu-demo-step", { type: "button", onclick: async () => {
      feedback.textContent = `Opening ${title.toLowerCase()}…`;
      try {
        if (!replayReady()) {
          const ready = await ensureReplayReady();
          if (!ready || ready.unavailable) return;
        }
        const result = await onStoryLens?.(lens);
        if (result?.unavailable) {
          feedback.textContent = result.reason || `${title} is unavailable in the current context.`;
          return;
        }
        feedback.textContent = result?.message
          || `${title} opened · the terrain, lens and dossier now read the same district state.`;
        setStoryStep(lens);
        setOpen(false);
      } catch (error) {
        feedback.textContent = `Could not open ${title.toLowerCase()} · ${error instanceof Error ? error.message : String(error)}`;
      }
    } }, [
      el("span", { text: index }),
      el("strong", { text: title }),
      el("small", { text: copy }),
    ]);
    storyButtons.set(lens, button);
    return button;
  }));

  const transport = actionStrip([
    { label: "Play", onClick: () => runReplay("Replay started", () => onClock?.("play")) },
    { label: "Pause", onClick: () => runReplay("Replay paused", () => onClock?.("pause")) },
    { label: "Reset", onClick: () => runReplay("Replay reset", () => onClock?.("reset")) },
  ]);
  const attacks = actionStrip([
    { label: "False reports", onClick: () => run("False-report attack injected", () => onInject?.("false_reports")) },
    { label: "Cut telecom", onClick: () => run("Telecom silence injected", () => onInject?.("silence")) },
    { label: "Drop satellite", onClick: () => run("Satellite channel disabled", () => onInject?.("kill_sar")) },
    { label: "Cut road edge", onClick: () => run("Road disruption injected", () => onInject?.("cut_edge")) },
  ]);

  const exports = el("div.setu-console-exports", {}, [
    el("a.setu-button", { href: "/export/dispatch.pdf", target: "_blank", rel: "noreferrer", text: "Dispatch PDF" }),
    el("a.setu-button", { href: "/export/alerts.cap", target: "_blank", rel: "noreferrer", text: "CAP alert XML" }),
  ]);

  const drawer = el("section.setu-command-console", {
    role: "dialog", "aria-modal": "true", "aria-label": "SETU command console", "aria-hidden": "true",
  }, [
    el("header.setu-console-head", {}, [
      el("div", {}, [
        el("div.setu-context-kicker", { text: "DEMO + LIVE OPERATIONS" }),
        el("h2", { text: "Command console" }),
        status,
      ]),
      closeButton,
    ]),
    el("div.setu-console-grid", {}, [
      el("section.setu-console-section.setu-console-story", {}, [
        el("h3", { text: "Show the operational story" }),
        el("p", { text: "A five-step judging path through one changing district twin." }),
        demoList,
      ]),
      el("section.setu-console-section.setu-console-context-section", {}, [
        el("h3", { text: "Current operational context" }),
        el("div.setu-console-context-card", {}, [contextKicker, contextTitle, contextMeta, openTwinButton]),
        consoleField(
          "Replay package",
          scenario,
          "District replays stay local. If this district has none, archived packages move SETU to their real source district.",
        ),
        openReplayButton,
        el("div.setu-console-subhead", { text: "REPLAY CLOCK" }),
        transport,
        consoleField("Speed", speed),
        el("div.setu-console-live-only", {}, [
          el("div.setu-console-subhead", { text: "LIVE RED-TEAM CONTROLS" }),
          attacks,
        ]),
      ]),
      el("section.setu-console-section.setu-console-live-section", {}, [
        el("h3", { text: "Ingest a field report" }),
        liveLock.cloneNode(true),
        consoleField("Settlement", settlement),
        consoleField("Observation", report),
        el("div.setu-console-inline", {}, [consoleField("Hazard", hazard), consoleField("Severity", severity)]),
        reportButton,
      ]),
      el("section.setu-console-section.setu-console-live-section", {}, [
        el("h3", { text: "Human authority" }),
        liveLock.cloneNode(true),
        consoleField("Decision", decision, "Overrides are appended; the model decision remains auditable."),
        consoleField("Reason", reason),
        overrideButton,
        el("div.setu-console-subhead", { text: "LIVE ENGINE EXPORTS" }),
        exports,
      ]),
    ]),
    feedback,
  ]);
  const shell = el("div.setu-console-shell", { hidden: true }, [backdrop, drawer]);

  let isLive = false;
  let allScenarios = [];
  let context = {
    kind: "nation",
    stateName: null,
    districtName: null,
    fullTwin: false,
    scenarioIds: [],
    activeScenario: null,
  };
  const replayControls = [transport, speed];
  const liveControls = [
    attacks, settlement, report, hazard, severity, reportButton,
    decision, reason, overrideButton,
  ];

  const replayReady = () => context.kind === "district" && Boolean(context.fullTwin);
  const replayCanOpen = () => !isLive && Boolean(scenario.value);

  function setStoryStep(lens) {
    storyButtons.forEach((button, id) => {
      const active = id === lens;
      button.dataset.active = String(active);
      button.setAttribute("aria-current", active ? "step" : "false");
    });
  }

  function syncAvailability() {
    const hasReplay = replayReady();
    const canOpenReplay = replayCanOpen();
    replayControls.forEach(group => {
      if (group instanceof HTMLSelectElement || group instanceof HTMLButtonElement) group.disabled = !hasReplay && !canOpenReplay;
      else group.querySelectorAll("button, select").forEach(node => { node.disabled = !hasReplay && !canOpenReplay; });
    });
    storyButtons.forEach(button => {
      button.disabled = !hasReplay && !canOpenReplay;
      button.title = hasReplay
        ? ""
        : (canOpenReplay ? "Loads the selected historical replay, then opens this story step." : "Open a historical replay package first.");
    });
    liveControls.forEach(group => {
      if (group instanceof HTMLSelectElement || group instanceof HTMLButtonElement || group instanceof HTMLTextAreaElement) {
        group.disabled = !isLive || !hasReplay;
      } else {
        group.querySelectorAll("button, select, textarea").forEach(node => { node.disabled = !isLive || !hasReplay; });
      }
    });
  }

  function renderStatus() {
    const sourceLabel = isLive ? "Live Engine" : "Historical replay";
    if (context.kind === "district" && context.districtName) {
      status.textContent = `${sourceLabel} · ${context.stateName || "State"} / ${context.districtName} · district twin active`;
      return;
    }
    if (context.districtName) {
      status.textContent = context.fullTwin
        ? `${sourceLabel} · ${context.stateName || "State"} / ${context.districtName} · full twin available`
        : `${sourceLabel} · ${context.stateName || "State"} / ${context.districtName} · regional evidence only`;
      return;
    }
    if (context.stateName) {
      status.textContent = `${sourceLabel} · ${context.stateName} overview · choose a district for command actions`;
      return;
    }
    status.textContent = `${sourceLabel} · national overview · choose a state and district for command actions`;
  }

  function renderContext() {
    const allowed = new Set(context.scenarioIds || []);
    const districtItems = allScenarios.filter(item => allowed.has(item.id));
    const archiveItems = isLive ? [] : allScenarios.filter(item => item.historical);
    const usingArchive = !districtItems.length && archiveItems.length > 0;
    const items = districtItems.length ? districtItems : archiveItems;
    if (context.districtName) {
      contextKicker.textContent = context.kind === "district"
        ? "DISTRICT TWIN ACTIVE"
        : (context.fullTwin ? "FULL TWIN AVAILABLE" : "REGIONAL EVIDENCE ONLY");
      contextTitle.textContent = `${context.stateName || "State"} / ${context.districtName}`;
      contextMeta.textContent = context.fullTwin
        ? (context.kind === "district"
          ? "Every story step now operates on this district package and its current replay frame."
          : "Open the district twin to run the five-lens operational story on village-level evidence, verification and dispatch.")
        : (!isLive && usingArchive
          ? `${context.districtName} has regional evidence only. Choose an archived replay below; SETU will move to that replay’s real district instead of borrowing its data here.`
          : "This district has state/regional evidence only. SETU will not borrow another district’s replay or fabricate village-level operations.");
    } else if (context.stateName) {
      contextKicker.textContent = "STATE OVERVIEW";
      contextTitle.textContent = context.stateName;
      contextMeta.textContent = !isLive && usingArchive
        ? "Choose an archived replay below to move directly to its recorded district. Regional state data remains separate."
        : "Select a district first. Command actions stay scoped to the place currently being inspected.";
    } else {
      contextKicker.textContent = "NO DISTRICT SELECTED";
      contextTitle.textContent = "National overview";
      contextMeta.textContent = !isLive && usingArchive
        ? "Choose an archived replay below. SETU will open the district that actually owns that historical package."
        : "Choose a state and district before entering the operational chain.";
    }

    if (items.length) {
      scenario.replaceChildren(...items.map(item => option(item.id, `${item.name}${item.historical ? " · historical" : " · synthetic"}`)));
      const desired = context.activeScenario && items.some(item => item.id === context.activeScenario)
        ? context.activeScenario
        : items[0].id;
      scenario.value = desired;
    } else {
      scenario.replaceChildren(option("", context.districtName ? "No district replay package" : "Select a district first"));
      scenario.value = "";
    }
    scenario.disabled = !items.length || (isLive && context.kind !== "district");
    openReplayButton.hidden = isLive || replayReady();
    openReplayButton.disabled = isLive || !scenario.value;
    openTwinButton.hidden = context.kind === "district";
    openTwinButton.disabled = context.kind !== "state" || !context.fullTwin;
    renderStatus();
    syncAvailability();
  }

  function setOpen(open) {
    shell.hidden = !open;
    drawer.setAttribute("aria-hidden", String(!open));
    document.documentElement.toggleAttribute("data-setu-console", open);
    if (open) {
      if (!isLive && !replayReady()) {
        feedback.textContent = "Choose a replay package below. SETU will move to its recorded district, then unlock the five-step story and replay clock.";
      }
      closeButton.focus();
    }
  }

  async function run(success, action) {
    if (!isLive) {
      feedback.textContent = "Historical replay is read-only. Start the live Engine to use this control.";
      return null;
    }
    feedback.textContent = "Command in progress…";
    try {
      const result = await action?.();
      feedback.textContent = result?.unavailable ? result.reason : success;
      return result;
    } catch (error) {
      feedback.textContent = `Command failed · ${error instanceof Error ? error.message : String(error)}`;
      return null;
    }
  }

  async function runRead(success, action) {
    feedback.textContent = "Updating district replay…";
    try {
      const result = await action?.();
      if (result?.unavailable) {
        feedback.textContent = result.reason || "That replay action is unavailable in the current context.";
        return result;
      }
      feedback.textContent = success;
      return result;
    } catch (error) {
      feedback.textContent = `Replay action failed · ${error instanceof Error ? error.message : String(error)}`;
      return null;
    }
  }

  async function ensureReplayReady() {
    if (replayReady()) return { ready: true };
    if (!replayCanOpen()) {
      const result = { unavailable: true, reason: "Choose a historical replay package first." };
      feedback.textContent = result.reason;
      return result;
    }
    const selectedLabel = scenario.options[scenario.selectedIndex]?.textContent || "historical replay";
    const result = await runRead(
      `Historical replay ready · ${selectedLabel}`,
      () => onScenario?.(scenario.value),
    );
    if (!result || result.unavailable) return result || { unavailable: true, reason: "Historical replay could not be opened." };
    renderContext();
    return result;
  }

  async function runReplay(success, action) {
    if (!replayReady()) {
      const ready = await ensureReplayReady();
      if (!ready || ready.unavailable) return ready;
    }
    return runRead(success, action);
  }

  closeButton.addEventListener("click", () => setOpen(false));
  backdrop.addEventListener("click", () => setOpen(false));
  drawer.addEventListener("keydown", event => { if (event.key === "Escape") setOpen(false); });
  scenario.addEventListener("change", () => {
    context.activeScenario = scenario.value || null;
    openReplayButton.disabled = isLive || !scenario.value;
    syncAvailability();
    if (replayReady()) {
      runRead("Scenario loaded · every lens now reads from this district replay", () => onScenario?.(scenario.value));
      return;
    }
    feedback.textContent = scenario.value
      ? "Replay selected · open it directly, or choose any story step and SETU will load it first."
      : "Choose a historical replay package first.";
  });
  openReplayButton.addEventListener("click", async () => {
    const result = await ensureReplayReady();
    if (result && !result.unavailable) {
      feedback.textContent = "Historical replay opened · story and clock controls are unlocked below.";
    }
  });
  speed.addEventListener("change", () => runReplay(`Replay speed · ${speed.value}×`, () => onClock?.("speed", { speed: Number(speed.value) })));
  openTwinButton.addEventListener("click", async () => {
    feedback.textContent = `Opening ${context.districtName || "district"} twin…`;
    try {
      const result = await onOpenTwin?.();
      if (result?.unavailable) {
        feedback.textContent = result.reason || "No district twin is available here.";
        return;
      }
      feedback.textContent = `${context.districtName || "District"} twin opened.`;
      setOpen(false);
    } catch (error) {
      feedback.textContent = `Could not open district twin · ${error instanceof Error ? error.message : String(error)}`;
    }
  });
  reportButton.addEventListener("click", () => run("Observation accepted · beliefs and plan recomputed", async () => {
    const text = report.value.trim();
    if (!settlement.value || !text) throw new Error("Choose a settlement and enter an observation");
    const result = await onEvent?.({
      kind: "report", channel: "field", source_id: "demo-field-team", provenance: "live",
      settlement_id: settlement.value, text, hazard: hazard.value,
      severity_hint: severity.value, is_firsthand: true,
    });
    report.value = "";
    return result;
  }));
  overrideButton.addEventListener("click", () => run("Human override appended to the audit ledger", async () => {
    const why = reason.value.trim();
    if (!decision.value || why.length < 3) throw new Error("Choose a decision and give a short operational reason");
    const result = await onOverride?.(Number(decision.value), why);
    reason.value = "";
    return result;
  }));
  exports.addEventListener("click", event => {
    if (isLive) return;
    event.preventDefault();
    feedback.textContent = "Live exports are unavailable in a historical replay.";
  });

  return {
    shell,
    open: () => setOpen(true),
    close: () => setOpen(false),
    setFeedback(text) { feedback.textContent = text; },
    setStoryStep,
    setLive(live) {
      isLive = Boolean(live);
      syncAvailability();
      drawer.dataset.live = String(isLive);
      exports.querySelectorAll("a").forEach(node => {
        node.setAttribute("aria-disabled", String(!isLive));
        node.tabIndex = isLive ? 0 : -1;
      });
      renderContext();
    },
    setScenarios(items, activeId) {
      allScenarios = items || [];
      if (activeId && !context.activeScenario) context.activeScenario = activeId;
      renderContext();
    },
    setContext(next) {
      context = { ...context, ...(next || {}) };
      renderContext();
    },
    setModel(model, activeScenario) {
      if (activeScenario) {
        context.activeScenario = activeScenario;
        renderContext();
      }
      const clockState = model?.snapshot?.clock || {};
      settlement.replaceChildren(...(model?.settlements || []).map(item => option(item.id, `${item.name} · ${item.block || "—"}`)));
      decision.replaceChildren(...(model?.decisions || []).slice().reverse().map(item => option(item.id, `#${item.id} · ${day(item.sim_t)} ${clock(item.sim_t)}`)));
      reportButton.disabled = !isLive || !(model?.settlements || []).length;
      overrideButton.disabled = !isLive || !(model?.decisions || []).length;
      if (context.kind === "district" && clockState.t) {
        const frame = model?.snapshot?.baked_frame;
        const frameText = !isLive && Number.isInteger(frame) ? ` · frame ${frame + 1}` : "";
        const playText = !isLive && typeof clockState.playing === "boolean"
          ? ` · ${clockState.playing ? "playing" : "paused"}`
          : "";
        status.textContent = `${isLive ? "Live Engine" : "Historical replay"} · ${context.stateName || "State"} / ${context.districtName || "District"} · ${day(clockState.t)} ${clock(clockState.t)}${frameText}${clockState.speed ? ` · ${clockState.speed}×` : ""}${playText}`;
      }
      setStoryStep(model?.lens || null);
    },
  };
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
  onStoryLens,
  onFogMode,
  onVerify,
  onResolveLocation,
  onSelectBlock,
  onSelectStateDistrict,
  onOpenStateDistrict,
  onClearStateDistrict,
  onScenario,
  onClock,
  onEvent,
  onOverride,
  onBack,
}) {
  const crumbs = el("div.setu-crumb-trail", { style: { display: "flex", gap: "8px", alignItems: "center" } });
  const sourceChip = el("button.setu-source", { type: "button", text: "connecting", "aria-label": "Open SETU command console" });
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
  const commandConsole = buildCommandConsole({
    onScenario,
    onClock,
    onEvent,
    onOverride,
    onStoryLens,
    onOpenTwin: onOpenStateDistrict,
    onInject,
  });
  sourceChip.addEventListener("click", commandConsole.open);
  chrome.append(breadcrumb, context, districtSummary.node, dossier, controls.node, tip, hint, commandConsole.shell);

  let names = new Map();
  let sourceDisclosure = "";

  const panels = {
    tip,
    controls,
    commandConsole,

    setSource(source) {
      sourceChip.textContent = source.mode === "engine" ? "live command engine" : "historical replay";
      sourceChip.title = source.disclosure || "";
      sourceDisclosure = source.disclosure || "";
      controls.setLive(source.mode === "engine");
      commandConsole.setLive(source.mode === "engine");
      panels.showSourceContext();
    },

    setScenarios(scenarios, activeId) {
      commandConsole.setScenarios(scenarios, activeId);
    },

    showSourceContext() {
      clear(context).append(
        el("div.setu-context-kicker", { text: "SETU SOURCE" }),
        el("p.setu-context-copy", { text: sourceDisclosure || "District command data is loading." }),
      );
    },

    showStateSituation(summary) {
      clear(context).append(
        el("div.setu-context-kicker", { text: summary.kicker || "STATE SITUATION" }),
        el("div.setu-context-title", { text: summary.title || "Operational picture" }),
        metricGrid(summary.metrics || []),
        summary.note ? el("p.setu-context-copy", { text: summary.note }) : null,
      );
      context.dataset.alert = summary.alert ? "true" : "false";
    },

    showStateSummary(stateName, summary) {
      districtSummary.title.textContent = stateName || "State";
      districtSummary.note.textContent = summary.alert ? "recent event replay" : "regional prioritisation";
      districtSummary.node.dataset.mode = "state";
      districtSummary.node.dataset.alert = summary.alert ? "true" : "false";
      clear(districtSummary.body);
      districtSummary.body.append(section(summary.alert ? "Priority flood districts" : "Priority districts", summary.alert ? "08 AUG BULLETIN" : "REGIONAL MODEL"));
      for (const item of summary.topDistricts || []) {
        districtSummary.body.append(row({
          name: item.name,
          meta: item.meta,
          value: item.value,
          bar: item.severity,
          colour: severityCss(item.severity),
          onClick: item.id ? () => onSelectStateDistrict?.(item.id) : null,
        }));
      }
      const priorityIds = new Set((summary.topDistricts || []).map(item => item.id));
      const fullTwins = (summary.fullTwins || []).filter(item => !priorityIds.has(item.id));
      if (fullTwins.length) {
        districtSummary.body.append(section("Full district twins", "village-level command package"));
        for (const item of fullTwins) {
          districtSummary.body.append(row({
            name: item.name,
            meta: item.meta,
            value: item.value,
            onClick: item.id ? () => onSelectStateDistrict?.(item.id) : null,
            className: "setu-row-active",
          }));
        }
      }
      if (summary.footer) districtSummary.body.append(el("p.setu-state-footnote", { text: summary.footer }));
      districtSummary.node.setAttribute("data-shown", "true");
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

    showDistrictSummary(summary, intelligence = null) {
      districtSummary.title.textContent = summary.name || "District";
      districtSummary.note.textContent = summary.live
        ? "full operational twin available"
        : `${summary.provenance || "unknown"} · regional estimate`;
      districtSummary.node.dataset.mode = "district";
      clear(districtSummary.body);
      districtSummary.node.dataset.alert = summary.alert_level === "red" ? "true" : "false";

      districtSummary.body.append(actionStrip([
        { label: "State overview", onClick: () => onClearStateDistrict?.() },
        ...(summary.live ? [{
          label: "Open village operations",
          onClick: () => onOpenStateDistrict?.(),
          disabled: Boolean(intelligence?.loading || intelligence?.error),
          title: "Enter the five-lens village command twin",
        }] : []),
      ], { className: "setu-state-actions" }));

      const loadedTwin = Boolean(summary.live && intelligence?.fullTwin && !intelligence.loading && !intelligence.error);
      districtSummary.body.append(metricGrid(loadedTwin ? [
        { label: "Threat", value: percent(intelligence.peakBelief), meta: intelligence.dominantFailure || "risk belief" },
        { label: "Population", value: number(intelligence.population), meta: `${number(intelligence.settlementCount)} settlements` },
        { label: "Severe", value: number(intelligence.severeSettlements), meta: "settlements ≥60%" },
        { label: "Dispatch", value: number(intelligence.dispatchCount), meta: `${number(intelligence.routedCount)} routed` },
        { label: "Verify", value: number(intelligence.verifyCount), meta: "open VoI questions" },
        { label: "Audit", value: intelligence.auditValid == null ? "—" : (intelligence.auditValid ? "VALID" : "FLAG"), meta: "decision chain" },
      ] : [
        { label: "Threat", value: percent(summary.severity), meta: summary.failure_mode || summary.hazard || "unclassified" },
        { label: "People affected", value: number(summary.affected_people), meta: summary.source_label || "district estimate" },
        { label: "Failure", value: summary.failure_mode || "—", meta: summary.hazard || "hazard" },
        { label: "Twin", value: summary.live ? (intelligence?.loading ? "READING" : "FULL") : "REGIONAL", meta: `${summary.scenarioCount || 0} package${summary.scenarioCount === 1 ? "" : "s"}` },
      ]));

      const deck = el("div.setu-district-control-grid");

      if (!summary.live) {
        deck.append(
          districtBox("Incident command", summary.source_label || summary.provenance || "regional source", [
            row({ name: "Incident status", meta: "current district event state", value: summary.status || "MONITOR" }),
            row({ name: "Threat belief", meta: "regional prioritisation only", value: percent(summary.severity), bar: summary.severity, colour: severityCss(summary.severity) }),
            row({ name: "Likely failure", meta: summary.hazard || "hazard family", value: summary.failure_mode || "UNCLASSIFIED" }),
          ], summary.alert_level === "red" ? "setu-district-box-alert" : ""),
          districtBox("Impact & geography", "people · footprint · exposed area", [
            row({ name: "People affected", meta: summary.source_label || "reported aggregate", value: number(summary.affected_people) }),
            row({ name: "District area", meta: "regional profile", value: summary.area_km2 == null ? "—" : `${number(summary.area_km2, 1)} km²` }),
            row({ name: "Severe settlements", meta: summary.settlements_estimated == null ? "no village estimate loaded" : `${summary.settlements_estimated} estimated`, value: summary.settlements_severe == null ? "—" : String(summary.settlements_severe) }),
          ]),
          districtBox("Access & response", "roads · river · field demand", [
            row({ name: "River / flood signal", meta: summary.response_note || "no district river feed", value: summary.river_status || "NOT LOADED" }),
            row({ name: "Response demand", meta: summary.asset_kind || "typed asset demand", value: summary.assets_requested == null ? "NOT LOADED" : String(summary.assets_requested) }),
            row({ name: "Route reachability", meta: "road graph + passability", value: "NOT LOADED" }),
          ]),
          districtBox("Communications & infrastructure", "control-room readiness", [
            row({ name: "Telecom / silence", meta: "tower health + no-report settlements", value: "NOT LOADED" }),
            row({ name: "Power status", meta: "feeder degradation signal", value: "NOT LOADED" }),
            row({ name: "Critical facilities", meta: "hospital · shelter · lifeline layer", value: "NOT LOADED" }),
            row({ name: "Relief capacity", meta: "camps · occupancy · supplies", value: "NOT LOADED" }),
          ]),
          districtBox("PS operational chain", "what this district can actually support", [
            row({ name: "M1 · Information fog", meta: "reports · silence · source trust", value: "DISTRICT ONLY" }),
            row({ name: "M2 · Belief engine", meta: "settlement failure mode + confidence", value: "NOT LOADED" }),
            row({ name: "M3 · Verify next", meta: "value-of-information queue", value: "NOT LOADED" }),
            row({ name: "M4 · Dispatch", meta: "typed assets + reachable routes", value: "NOT LOADED" }),
          ], "setu-district-box-wide"),
          districtBox("Resolution boundary", "data honesty", [
            el("div.setu-state-callout.setu-state-callout-muted", {}, [
              el("strong", { text: "SETU will not invent village evidence, infrastructure status, routes or dispatch for a district that only has regional data." }),
              summary.source_label ? el("p", { text: summary.source_label }) : null,
            ]),
          ], "setu-district-box-wide"),
        );
      } else if (intelligence?.loading) {
        deck.append(
          districtBox("Loading district package", "assembling command picture", [
            row({ name: "Physical prior", meta: "terrain · population · fragility", value: "READING" }),
            row({ name: "Information fog", meta: "reports · silence · trust", value: "READING" }),
            row({ name: "Belief + verification", meta: "risk · uncertainty · VoI", value: "READING" }),
            row({ name: "Dispatch + proof", meta: "assets · routes · audit", value: "READING" }),
          ], "setu-district-box-wide"),
        );
      } else if (intelligence?.error) {
        deck.append(districtBox("District package unavailable", "state evidence remains visible", [
          el("div.setu-state-callout", {}, [
            el("strong", { text: intelligence.error }),
            el("p", { text: "No missing operational values are substituted." }),
          ]),
        ], "setu-district-box-wide setu-district-box-alert"));
      } else if (loadedTwin) {
        const topVerify = intelligence.topVerify;
        const topPrePosition = intelligence.topPrePosition;
        deck.append(
          districtBox("Population & exposure", "who is in the hazard footprint", [
            row({ name: "People + settlements", meta: `${number(intelligence.blockCount)} administrative blocks`, value: `${number(intelligence.population)} · ${number(intelligence.settlementCount)}` }),
            row({ name: "Households", meta: "district package aggregation", value: number(intelligence.households) }),
            row({ name: "Elderly exposure", meta: "modelled from settlement demographics", value: number(intelligence.elderlyPopulation) }),
            intelligence.fatalities == null ? null : row({ name: "Official fatalities", meta: "archived event summary", value: number(intelligence.fatalities) }),
          ]),
          districtBox("Terrain & structural risk", "physical prior before reports", [
            row({ name: "Terrain baseline", meta: `elev ${number(intelligence.meanElevationM)} m · slope ${number(intelligence.meanSlopeDeg, 1)}°`, value: intelligence.meanHandM == null ? "HAND —" : `HAND ${number(intelligence.meanHandM, 1)} m` }),
            row({ name: "Structural fragility", meta: `${number(intelligence.highFragilitySettlements)} high-fragility settlements`, value: intelligence.meanKutchaShare == null ? "—" : `${percent(intelligence.meanKutchaShare)} kutcha` }),
            row({ name: "Disadvantaged share", meta: "SC/ST share proxy in settlement package", value: percent(intelligence.meanDisadvantagedShare) }),
            row({ name: "Normal road access", meta: "mean travel-time baseline", value: intelligence.meanRoadHoursNormal == null ? "—" : `${number(intelligence.meanRoadHoursNormal, 1)} h` }),
            intelligence.runoutKm == null ? null : row({ name: "Landslide runout", meta: "official event summary", value: `${number(intelligence.runoutKm, 1)} km` }),
            intelligence.cropLossHa == null ? null : row({ name: "Crop loss", meta: "official event summary", value: `${number(intelligence.cropLossHa, 1)} ha` }),
          ]),
          districtBox("M1 · Information fog", "what the EOC can and cannot hear", [
            row({ name: "Reports heard", meta: `${number(intelligence.distinctClaims)} distinct claims`, value: number(intelligence.reports) }),
            row({ name: "Evidence rows", meta: "weighted observations after deduplication", value: number(intelligence.evidenceRows) }),
            row({ name: "Silent settlements", meta: "no report received · silence remains a signal", value: `${number(intelligence.silentSettlements)} / ${number(intelligence.settlementCount)}` }),
            row({ name: "Unresolved locations", meta: "never guessed below geocoder threshold", value: number(intelligence.unresolvedLocations) }),
            row({ name: "Observability", meta: "mean district sensing / reporting visibility", value: percent(intelligence.meanObservability) }),
            row({ name: "Degraded channels", meta: intelligence.rankDisplacement == null ? "telecom + power robustness" : `top-10 rank displacement ${intelligence.rankDisplacement}`, value: intelligence.disabledChannels?.length ? intelligence.disabledChannels.join(", ").toUpperCase() : "NONE" }),
          ]),
          districtBox("M2 + M3 · Decide what to verify", "risk belief → value of information", [
            row({ name: "Peak settlement belief", meta: `${number(intelligence.severeSettlements)} settlements at ≥60%`, value: percent(intelligence.peakBelief), bar: intelligence.peakBelief, colour: severityCss(intelligence.peakBelief) }),
            row({ name: "Dominant failure", meta: "highest aggregate posterior risk", value: intelligence.dominantFailure }),
            row({ name: "Open verification queue", meta: topVerify ? `${topVerify.action} · ${topVerify.settlement_name}` : "no unresolved high-value question", value: number(intelligence.verifyCount) }),
            topVerify ? row({ name: "Highest-value question", meta: `VoI ${number(topVerify.voi_score, 2)} · resolves ${topVerify.resolves}`, value: minutes(topVerify.minutes), className: "setu-row-alert" }) : null,
          ]),
          districtBox("M4 · Dispatch & reachability", "typed assets · routes · impact", [
            row({ name: "Available asset inventory", meta: "district package resource pool", value: number(intelligence.assetInventoryCount) }),
            row({ name: "Dispatch orders", meta: intelligence.assetMix, value: number(intelligence.dispatchCount) }),
            row({ name: "Reachability", meta: `${number(intelligence.blockedCount)} routes need review`, value: `${number(intelligence.routedCount)} / ${number(intelligence.dispatchCount)} routed` }),
            row({ name: "Expected lives saved", meta: "modelled impact across current plan", value: number(intelligence.expectedLivesSaved) }),
          ]),
          districtBox("Damage & relief capacity", "what limits response on the ground", [
            intelligence.roadsDamagedKm == null ? null : row({ name: "Roads damaged", meta: "official event summary", value: `${number(intelligence.roadsDamagedKm, 1)} km` }),
            intelligence.bridgesDamaged == null ? null : row({ name: "Bridges damaged", meta: "official event summary", value: number(intelligence.bridgesDamaged) }),
            intelligence.reliefCamps == null ? null : row({ name: "Relief camps", meta: "official event summary", value: number(intelligence.reliefCamps) }),
            intelligence.campInmates == null ? null : row({ name: "Camp inmates", meta: "official event summary", value: number(intelligence.campInmates) }),
            intelligence.peakRainfallMm == null ? null : row({ name: "Peak recorded rainfall", meta: "Kalladi gauge · archived event summary", value: `${number(intelligence.peakRainfallMm, 1)} mm` }),
            intelligence.affectedWardCount == null ? null : row({ name: "Affected wards", meta: "official event summary", value: number(intelligence.affectedWardCount) }),
            intelligence.affectedSettlementCount == null ? null : row({ name: "Named affected settlements", meta: intelligence.affectedSettlementNames?.join(" · ") || "official event summary", value: number(intelligence.affectedSettlementCount) }),
            row({ name: "Critical facilities", meta: "hospital / shelter facility-level feed", value: "NO FACILITY LAYER" }),
          ]),
          districtBox("Cascade & pre-position", "move before access disappears", [
            row({ name: "Pre-position leads", meta: topPrePosition ? `${topPrePosition.settlement_name} · ${minutes(topPrePosition.eta_minutes)} lag · source ${topPrePosition.source}` : "no downstream lead above model threshold", value: number(intelligence.prePositionCount) }),
            row({ name: "Routing provenance", meta: intelligence.routingAttribution || "district routing graph", value: intelligence.officialEventTime ? `${day(intelligence.officialEventTime)} ${clock(intelligence.officialEventTime)}` : "READY" }),
          ]),
          districtBox("Proof, equity & resilience", "can the EOC defend the decision", [
            row({ name: "Audit chain", meta: `${number(intelligence.auditEntries)} decisions${intelligence.latestDecisionHash ? ` · ${short(intelligence.latestDecisionHash)}` : ""}`, value: intelligence.auditValid == null ? "—" : (intelligence.auditValid ? "VALID" : "FLAG"), className: intelligence.auditValid === false ? "setu-row-alert" : "" }),
            row({ name: "Equity allocation gap", meta: "disadvantaged mean priority − district mean", value: intelligence.equityGap == null ? "—" : Number(intelligence.equityGap).toFixed(3) }),
            row({ name: "Calibration ECE", meta: "lower is better · model diagnostic", value: intelligence.calibrationEce == null ? "—" : Number(intelligence.calibrationEce).toFixed(3) }),
            row({ name: "Source datasets", meta: "provenance-backed operational inputs", value: number(intelligence.sourceCount) }),
          ]),
          districtBox("Provenance / disclosure", intelligence.updatedAt ? `district state · ${day(intelligence.updatedAt)} ${clock(intelligence.updatedAt)}` : "district state", [
            el("p.setu-district-disclosure", { text: intelligence.disclosure || "See the district package provenance metadata." }),
          ], "setu-district-box-wide"),
        );
      }

      districtSummary.body.append(deck);
      districtSummary.node.setAttribute("data-shown", "true");
    },

    hideDistrictSummary() {
      districtSummary.node.setAttribute("data-shown", "false");
      districtSummary.node.dataset.alert = "false";
      districtSummary.node.dataset.mode = "";
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
      commandConsole.setModel(model, model.scenario);
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

  if ((model.overrides || []).length) {
    panel.body.append(section("Human authority", "append-only operator overrides"));
    model.overrides.slice().reverse().slice(0, 3).forEach(entry => panel.body.append(row({
      name: `Override #${entry.id} · decision #${entry.decision_id}`,
      meta: `${entry.actor} · ${entry.reason}`,
      value: String(entry.outcome || "acknowledged").toUpperCase(),
    })));
  }

  const calibration = model.metrics?.calibration || {};
  panel.body.append(section("Calibration", "measured confidence, not a marketing score"));
  panel.body.append(row({
    name: "Expected calibration error",
    meta: calibration.status || "held-out calibration status unavailable",
    value: calibration.ece == null ? "—" : Number(calibration.ece).toFixed(3),
  }));
  if (calibration.curve?.length) panel.body.append(row({
    name: "Reliability bins",
    meta: `${calibration.curve.reduce((sum, bin) => sum + Number(bin.count || 0), 0)} evaluated settlement-mode beliefs`,
    value: `${calibration.curve.length} BINS`,
  }));

  const dataPlane = model.dataPlane || {};
  const twin = dataPlane.twin;
  const intensities = twin?.values ? [...twin.values] : [];
  const peak = intensities.length ? Math.max(...intensities) / 255 : null;
  const provenance = [...new Set((dataPlane.layers || []).map(layer => layer.provenance).filter(Boolean))];
  panel.body.append(section("District data plane", "timeline · layers · compact twin state"));
  panel.body.append(row({
    name: "Time-aligned twin frame",
    meta: `${twin?.count ?? 0} settlement bytes · ${twin?.encoding || "unavailable"}`,
    value: twin ? `#${Number(twin.frame || 0) + 1} · ${percent(peak)}` : "—",
  }));
  panel.body.append(row({
    name: "Visualisation layers",
    meta: provenance.length ? provenance.join(" · ") : "layer provenance unavailable",
    value: number(dataPlane.layers?.length || 0),
  }));
  panel.body.append(row({
    name: "Replay timeline",
    meta: model.metrics?.disclosure || dataPlane.district?.provenance?.disclosure || "scenario disclosure unavailable",
    value: dataPlane.timeline?.frame_count == null ? "—" : `${dataPlane.timeline.frame_count} FRAMES`,
  }));

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
    attack("cut_edge", "Cut road", "Close one road edge and recompute asset routes"),
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
