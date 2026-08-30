import { el } from "./dom.js";
import { SIGNALS, metaFor, sourceFor } from "./evidence.js";

const CHECKS = [
  { id: "provenance", index: "01", label: "PROVENANCE CHAIN" },
  { id: "independence", index: "02", label: "INDEPENDENCE" },
  { id: "geotime", index: "03", label: "GEO + TIME" },
  { id: "modality", index: "04", label: "MODALITY SANITY" },
  { id: "corroboration", index: "05", label: "CORROBORATION" },
  { id: "reliability", index: "06", label: "SOURCE RELIABILITY" },
];

const SOURCE_VALIDATION = {
  field: {
    values: [96, 94, 91, 93, 92, 88],
    notes: [
      "Named field channel and direct callback chain preserved.",
      "First-hand observer is distinct from downstream relays.",
      "Named facility and catchment agree with the reported access loss.",
      "Voice content and responder context are internally coherent.",
      "Access blockage agrees with route and medical pressure signals.",
      "Prior confirmations keep this field channel strongly weighted.",
    ],
    outcome: "ADMIT",
    vote: "CAN CHANGE BELIEF + DISPATCH",
    tone: "admit",
  },
  satphone: {
    values: [78, 72, 44, 66, 37, 64],
    notes: [
      "Relay chain is known, but the call terminates before full capture.",
      "One caller is one observation, not independent corroboration.",
      "Ridge corridor is plausible; the exact road segment is unresolved.",
      "Fragment quality supports a road-loss claim, not its full scale.",
      "No second source yet confirms the same road segment.",
      "Channel is useful in outages, with moderate historical reliability.",
    ],
    outcome: "VERIFY",
    vote: "QUEUE A HIGH-VALUE CALLBACK",
    tone: "verify",
  },
  social: {
    values: [34, 18, 27, 68, 16, 42],
    notes: [
      "Original uploader is missing from the forwarded chain.",
      "Reposts share one origin, so volume is not independent evidence.",
      "Place tags disagree across copies of the same clip.",
      "The clip is readable, but visual clarity does not prove context.",
      "No independent field or machine channel confirms the severe claim.",
      "Public feeds remain a weak prior until their claims are corroborated.",
    ],
    outcome: "HOLD",
    vote: "NO VOTE ON DISPATCH",
    tone: "hold",
  },
  news: {
    values: [84, 49, 61, 87, 56, 72],
    notes: [
      "The newsroom relay is attributable and timestamped.",
      "The desk is downstream from unnamed original observers.",
      "District and shelter geography are consistent but not point-verified.",
      "Transcript is coherent for shelter pressure, not casualty counts.",
      "Field and facility channels partly support the wider pressure signal.",
      "Known desk history makes it useful context, not a direct witness.",
    ],
    outcome: "CONTEXT",
    vote: "CAN SHIFT CONTEXT, NOT PROVE DAMAGE",
    tone: "context",
  },
  telecom: {
    values: [99, 93, 86, 96, 67, 82],
    notes: [
      "Machine source, collection window and cell footprint are intact.",
      "Six adjacent sectors provide distinct measurements of one outage pattern.",
      "The outage footprint aligns across neighbouring settlements and time.",
      "Attach-rate collapse is a valid network-state observation.",
      "Silence agrees with missing human reports but does not identify damage type.",
      "Stable telemetry history gives the channel a strong reliability prior.",
    ],
    outcome: "CONTEXT",
    vote: "RAISE UNCERTAINTY + VERIFICATION VALUE",
    tone: "context",
  },
  remote: {
    values: [94, 97, 81, 91, 74, 84],
    notes: [
      "Tile, acquisition window and processing lineage stay attached.",
      "Orbital measurement is independent of the circulating human reports.",
      "Surface-change tile overlaps the claimed corridor within its footprint.",
      "Change signal is valid for terrain/access change, not casualty inference.",
      "It supports route-loss risk while the next field check is still pending.",
      "Remote sensing carries a strong prior when acquisition quality is usable.",
    ],
    outcome: "VERIFY",
    vote: "SUPPORT ROUTE CLAIM + REQUEST GROUND CHECK",
    tone: "verify",
  },
  weather: {
    values: [99, 96, 92, 96, 69, 87],
    notes: [
      "Gauge identity, timestamps and ingest path are intact.",
      "Sensor series is independent of human-report cascades.",
      "Gauge sector and exposure layer align with the active weather window.",
      "The signal is physically plausible and internally consistent.",
      "Rain supports hazard plausibility but does not confirm settlement damage.",
      "Long-running telemetry gives this source a strong prior.",
    ],
    outcome: "CONTEXT",
    vote: "SHIFT HAZARD PRIOR ONLY",
    tone: "context",
  },
};

const SIGNAL_OVERRIDES = {
  "sig-08": {
    values: [38, 8, 21, 64, 12, 42],
    notes: [
      "Twenty-three copies trace back to one unresolved original.",
      "Duplicate collapse leaves one independent source, not twenty-three.",
      "Mundakkai, Chooralmala and Meppadi tags conflict.",
      "Text is readable, but forwarding stripped useful capture context.",
      "No independent channel supports the shifted location claims.",
      "Public-feed prior remains weak until a claim earns corroboration.",
    ],
    outcome: "HOLD",
    vote: "COLLAPSE COPIES · NO NEW VOTE",
    tone: "hold",
  },
};

const SOURCE_PRIOR = {
  field: 88,
  satphone: 64,
  social: 42,
  news: 72,
  telecom: 82,
  remote: 84,
  weather: 87,
};

function validationFor(signal) {
  const base = SOURCE_VALIDATION[signal.source] || SOURCE_VALIDATION.social;
  return { ...base, ...(SIGNAL_OVERRIDES[signal.id] || {}) };
}

function percentFromMeta(signal) {
  const parsed = Number.parseInt(metaFor(signal).confidence, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function grade(value) {
  if (value >= 80) return "STRONG";
  if (value >= 60) return "USABLE";
  if (value >= 40) return "WEAK";
  return "FAIL";
}

function createCheckRow(check) {
  const value = el("strong.setu-validator-check-value", { text: "—" });
  const note = el("p.setu-validator-check-note", { text: "Waiting for evidence object." });
  const fill = el("i.setu-validator-check-fill");
  const state = el("span.setu-validator-check-state", { text: "PENDING" });
  const node = el("div.setu-validator-check", { "data-check": check.id, "data-state": "idle" }, [
    el("span.setu-validator-check-index", { text: check.index }),
    el("div.setu-validator-check-copy", {}, [
      el("span.setu-validator-check-label", { text: check.label }),
      note,
    ]),
    el("div.setu-validator-check-meter", { "aria-hidden": "true" }, [fill]),
    value,
    state,
  ]);
  return { node, value, note, fill, state };
}

function createValidationMachine(onSelect) {
  const rows = CHECKS.map(createCheckRow);
  const signalId = el("span.setu-validator-signal-id");
  const sourceName = el("span.setu-validator-source-name");
  const claim = el("h2.setu-validator-claim");
  const origin = el("p.setu-validator-origin");
  const outcome = el("strong.setu-validator-gate-outcome", { text: "WAIT" });
  const vote = el("p.setu-validator-gate-vote", { text: "Evidence has not reached the decision gate." });
  const action = el("p.setu-validator-action", { text: "Select a signal to see the next operational step." });
  const confidence = el("strong.setu-validator-metric-value", { text: "—" });
  const prior = el("strong.setu-validator-metric-value", { text: "—" });
  const provenance = el("span.setu-validator-provenance-note");
  const traceSummary = el("strong.setu-validator-trace-summary", { text: "6 checks" });
  const announcer = el("p.setu-validator-announcer", {
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
  });
  const selector = el("div.setu-validator-selector", {
    role: "radiogroup",
    "aria-label": "Evidence signals",
  });
  let timers = [];

  for (const signal of SIGNALS) {
    const source = sourceFor(signal.source);
    const validation = validationFor(signal);
    const selectorButton = el("button.setu-validator-selector-item", {
      type: "button",
      role: "radio",
      "data-signal": signal.id,
      "aria-checked": "false",
      "aria-controls": "setu-validator-current",
      "aria-label": `${signal.time} ${source.name}: ${signal.summary}. ${validation.outcome}.`,
      tabindex: "-1",
      onclick: () => onSelect?.(signal),
      onkeydown: (event) => {
        const buttons = [...selector.querySelectorAll("button")];
        const current = buttons.indexOf(event.currentTarget);
        let next = current;
        if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (current + 1) % buttons.length;
        else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (current - 1 + buttons.length) % buttons.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = buttons.length - 1;
        else return;
        event.preventDefault();
        const nextSignal = SIGNALS.find((item) => item.id === buttons[next]?.dataset.signal);
        if (nextSignal) onSelect?.(nextSignal);
        buttons[next]?.focus();
      },
    }, [
      el("span.setu-validator-selector-mark", { text: source.code, "aria-hidden": "true" }),
      el("span.setu-validator-selector-copy", {}, [
        el("strong", { text: source.name }),
        el("small", { text: `${signal.time} · ${validation.outcome}` }),
      ]),
      el("span.setu-validator-selector-confidence", { text: metaFor(signal).confidence }),
    ]);
    selector.append(selectorButton);
  }

  const review = el("div.setu-validator-review", {
    id: "setu-validator-current",
    "aria-busy": "false",
  }, [
    el("div.setu-validator-selected", {}, [
      el("span.setu-validator-selected-label", { text: "CLAIM UNDER REVIEW" }),
      claim,
      origin,
    ]),
    el("div.setu-validator-trace-head", {}, [
      el("span", { text: "VALIDATION TRACE" }),
      traceSummary,
    ]),
    el("div.setu-validator-trace", {}, rows.map((row) => row.node)),
  ]);

  const node = el("section.setu-validator-machine", {
    "data-tone": "verify",
    "aria-label": "Source validation workbench",
  }, [
    el("div.setu-validator-machine-head", {}, [
      el("span", { text: "CLAIM VALIDATION WORKBENCH" }),
      el("div", {}, [signalId, sourceName]),
    ]),
    el("div.setu-validator-machine-grid", {}, [
      el("aside.setu-validator-selector-wrap", { "aria-label": "Evidence signal queue" }, [
        el("div.setu-validator-panel-head", {}, [
          el("span", { text: "SIGNAL QUEUE" }),
          el("strong", { text: `${SIGNALS.length} OBJECTS` }),
        ]),
        selector,
      ]),
      review,
      el("aside.setu-validator-gate", { "aria-label": "Validation decision" }, [
        el("div.setu-validator-gate-copy", {}, [
          el("span", { text: "DECISION GATE" }),
          outcome,
          vote,
        ]),
        el("div.setu-validator-action-wrap", {}, [
          el("span", { text: "DO NOW" }),
          action,
        ]),
        el("div.setu-validator-gate-metrics", {}, [
          el("div", {}, [el("span", { text: "CLAIM CONFIDENCE" }), confidence]),
          el("div", {}, [el("span", { text: "SOURCE PRIOR" }), prior]),
        ]),
        provenance,
      ]),
    ]),
    announcer,
  ]);

  const clearTimers = () => {
    timers.forEach((timer) => window.clearTimeout(timer));
    timers = [];
  };

  return {
    node,
    setSignal(signal) {
      clearTimers();
      node.dataset.resolved = "false";
      review.setAttribute("aria-busy", "true");
      const source = sourceFor(signal.source);
      const meta = metaFor(signal);
      const validation = validationFor(signal);
      node.dataset.tone = validation.tone;
      signalId.textContent = `${signal.id.toUpperCase()} · ${signal.time} IST`;
      sourceName.textContent = `${source.name.toUpperCase()} · ${source.kind.toUpperCase()}`;
      claim.textContent = signal.summary;
      origin.textContent = `${meta.origin} · ${meta.location}`;
      confidence.textContent = `${percentFromMeta(signal)}%`;
      prior.textContent = `${SOURCE_PRIOR[signal.source] ?? validation.values[5]}%`;
      provenance.textContent = "Provenance can establish origin and history. It does not, by itself, make the claim true.";
      outcome.textContent = validation.outcome;
      vote.textContent = validation.vote;
      action.textContent = signal.handling;
      const strongChecks = validation.values.filter((value) => value >= 80).length;
      const flaggedChecks = validation.values.filter((value) => value < 60).length;
      traceSummary.textContent = `${strongChecks} strong · ${flaggedChecks} flagged`;
      selector.querySelectorAll("button").forEach((button) => {
        const active = button.dataset.signal === signal.id;
        button.setAttribute("aria-checked", String(active));
        button.setAttribute("tabindex", active ? "0" : "-1");
      });

      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      rows.forEach((row, index) => {
        row.node.dataset.state = "idle";
        row.value.textContent = "—";
        row.note.textContent = "Waiting for this check.";
        row.fill.style.width = "0%";
        row.state.textContent = "PENDING";
        timers.push(window.setTimeout(() => {
          const value = validation.values[index];
          row.node.dataset.state = value >= 60 ? "pass" : "flag";
          row.value.textContent = `${value}%`;
          row.note.textContent = validation.notes[index];
          row.fill.style.width = `${value}%`;
          row.state.textContent = grade(value);
        }, reduceMotion ? 0 : 60 + index * 70));
      });
      const settleDelay = reduceMotion ? 0 : 60 + (CHECKS.length - 1) * 70 + 30;
      timers.push(window.setTimeout(() => {
        review.setAttribute("aria-busy", "false");
        node.dataset.resolved = "true";
        announcer.textContent = `${source.name} selected. Outcome ${validation.outcome}. Confidence ${percentFromMeta(signal)} percent.`;
      }, settleDelay));
    },
    destroy() {
      clearTimers();
    },
  };
}

function createPrinciple(index, title, copy, mark) {
  return el("article.setu-validator-principle", {}, [
    el("div.setu-validator-principle-visual", { "data-mark": mark, "aria-hidden": "true" }, [
      el("i"), el("i"), el("i"),
    ]),
    el("span", { text: `${index} · ${title}` }),
    el("strong", { text: copy[0] }),
    el("p", { text: copy[1] }),
  ]);
}

export function isValidatorRoute(pathname = window.location.pathname) {
  return /\/(?:[a-z]{2}\/)?(?:projects|validator)\/?$/i.test(pathname);
}

export function mountValidatorPage() {
  const existing = document.querySelector(".setu-validator-root");
  if (existing) return existing;

  document.documentElement.setAttribute("data-setu", "on");
  document.documentElement.setAttribute("data-setu-page", "validator");
  document.title = "SETU | Source Validator";

  let selected = SIGNALS[1] || SIGNALS[0];

  let machine;
  const setSelected = (signal) => {
    selected = signal;
    machine?.setSignal(signal);
  };

  machine = createValidationMachine(setSelected);

  const root = el("div.setu-validator-root", {}, [
    el("a.setu-validator-skip", { href: "#setu-validator-main", text: "Skip to validation workbench" }),
    el("header.setu-validator-topbar", {}, [
      el("a.setu-validator-brand", { href: "/", text: "SETU" }),
      el("div.setu-validator-context", {}, [
        el("span", { text: "WAYANAD · FIRST 24H" }),
        el("span", { text: "SYNTHETIC REPLAY · 8 SIGNALS" }),
      ]),
      el("nav.setu-validator-toplinks", { "aria-label": "Validation workflow" }, [
        el("a", { href: "/about", text: "← EVIDENCE" }),
        el("a", { href: "/infer", text: "INFER →" }),
      ]),
    ]),
    el("main.setu-validator-page", { id: "setu-validator-main" }, [
      el("section.setu-validator-hero", {}, [
        el("div.setu-validator-hero-intro", {}, [
          el("div.setu-validator-hero-copy", {}, [
            el("h1", {}, ["SOURCE", el("br"), "VALIDATOR"]),
            el("p", { text: "SETU validates the claim, not the reputation around it. Every evidence object is tested for origin, independence, place, time, signal quality and corroboration before it can influence response." }),
          ]),
          el("div.setu-validator-hero-note", {}, [
            el("span", { text: "CLAIM-LEVEL VALIDATION" }),
            el("strong", { text: "Origin is a receipt. Corroboration earns the vote." }),
            el("p", { text: "Choose any signal. The decision, confidence and next operational step update together." }),
          ]),
        ]),
        machine.node,
      ]),
      el("section.setu-validator-story", {}, [
        el("div.setu-validator-story-copy", {}, [
          el("h2", { text: "VALIDATE THE CLAIM, NOT THE CHANNEL." }),
          el("p", { text: "Validation is claim-level, not just account-level. A genuine source can be mistaken, a clean video can be mislocated, and twenty reposts can still be one observation." }),
        ]),
        el("div.setu-validator-principles", {}, [
          createPrinciple("01", "ORIGIN", ["Provenance is a receipt, not a truth stamp.", "Origin and edit history make evidence auditable. They do not prove that what the evidence claims actually happened."], "origin"),
          createPrinciple("02", "INDEPENDENCE", ["Twenty copies can still count as one.", "SETU collapses common-origin reposts so amplification never masquerades as corroboration."], "independent"),
          createPrinciple("03", "ADMISSION", ["Every channel gets a different right to vote.", "Weather may move a hazard prior. A named callback can alter dispatch. An unresolved viral claim stays out."], "gate"),
        ]),
      ]),
    ]),
    el("footer.setu-validator-footer", {}, [
      el("p", { text: "Validation produces a weighted, traceable input. It does not erase uncertainty." }),
      el("p", { text: "Demo logic mirrors SETU’s provenance, duplicate-collapse, reliability and Bayesian evidence-fusion model. Evidence objects are synthetic." }),
      el("a", { href: "/infer", text: "NEXT · INFER RISK BELIEF" }),
    ]),
  ]);

  document.body.append(root);
  setSelected(selected);
  window.addEventListener("pagehide", () => {
    machine.destroy();
  }, { once: true });
  return root;
}

export function installValidatorRouteBridge() {
  if (window.__setuValidatorRouteBridge) return;
  window.__setuValidatorRouteBridge = true;

  const reconcile = () => {
    if (isValidatorRoute()) {
      mountValidatorPage();
      return;
    }
    if (document.querySelector(".setu-validator-root")) window.location.reload();
  };

  document.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    try {
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || !isValidatorRoute(url.pathname)) return;
      event.preventDefault();
      window.location.assign("/projects");
    } catch {
      // Ignore malformed or non-standard hrefs owned by the captured shell.
    }
  }, true);

  window.addEventListener("popstate", reconcile);
}
