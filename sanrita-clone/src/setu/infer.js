import { el } from "./dom.js";

const SETTLEMENTS = [
  { id: "mundakkai", name: "Mundakkai", mode: "LANDSLIDE", prior: 18 },
  { id: "chooralmala", name: "Chooralmala", mode: "LANDSLIDE", prior: 16 },
  { id: "attamala", name: "Attamala", mode: "ISOLATION", prior: 14 },
  { id: "meppadi", name: "Meppadi", mode: "CASUALTY", prior: 12 },
];

const INFER_STEPS = [
  {
    id: "weather",
    time: "02:44",
    code: "WX",
    source: "RAINFALL + DRAINAGE",
    state: "CONTEXT",
    claim: "Rain remains elevated while drainage exposure rises.",
    vote: "HAZARD PRIOR",
    weight: "+0.42",
    reliability: "0.87",
    reason: "Weather can make a landslide more plausible. It cannot prove damage by itself.",
    beliefs: { mundakkai: 31, chooralmala: 27, attamala: 19, meppadi: 16 },
    delta: { mundakkai: 13, chooralmala: 11, attamala: 5, meppadi: 4 },
    cascade: "Slope exposure raises the watch on the ridge corridor, but no settlement is dispatched yet.",
    cascadeValue: "+5 pp",
  },
  {
    id: "telecom",
    time: "03:01",
    code: "TC",
    source: "TELECOM SILENCE",
    state: "CONTEXT",
    claim: "Attach-rate drops across six adjacent cell sectors.",
    vote: "UNCERTAINTY + VOI",
    weight: "+0.71",
    reliability: "0.82",
    reason: "Silence is evidence that visibility collapsed. It raises isolation risk and the value of verification.",
    beliefs: { mundakkai: 49, chooralmala: 41, attamala: 32, meppadi: 19 },
    delta: { mundakkai: 18, chooralmala: 14, attamala: 13, meppadi: 3 },
    cascade: "The western cluster goes quiet together. Attamala inherits isolation risk from the same corridor.",
    cascadeValue: "+13 pp",
  },
  {
    id: "field",
    time: "03:18",
    code: "FT",
    source: "NAMED PHC CALLBACK",
    state: "ADMITTED",
    claim: "Casualty load is rising and the approach road is blocked.",
    vote: "BELIEF + DISPATCH",
    weight: "+1.86",
    reliability: "0.88",
    reason: "A direct callback corroborates both harm and access loss, so the posterior moves sharply.",
    beliefs: { mundakkai: 82, chooralmala: 64, attamala: 44, meppadi: 26 },
    delta: { mundakkai: 33, chooralmala: 23, attamala: 12, meppadi: 7 },
    cascade: "Once the access claim is admitted, downstream isolation becomes a response problem rather than a map annotation.",
    cascadeValue: "+12 pp",
  },
  {
    id: "remote",
    time: "03:42",
    code: "RS",
    source: "SURFACE-CHANGE PASS",
    state: "CORROBORATED",
    claim: "Surface change overlaps the blocked ridge corridor.",
    vote: "ROUTE + BELIEF",
    weight: "+1.24",
    reliability: "0.84",
    reason: "Independent remote sensing supports the route-loss claim without inventing casualty information.",
    beliefs: { mundakkai: 91, chooralmala: 79, attamala: 61, meppadi: 34 },
    delta: { mundakkai: 9, chooralmala: 15, attamala: 17, meppadi: 8 },
    cascade: "The blocked corridor now has two independent channels behind it. Attamala crosses the pre-position threshold.",
    cascadeValue: "+17 pp",
  },
];

function formatProbability(value) {
  return `${Math.round(Number(value) || 0)}%`;
}

function animateNumber(node, from, to) {
  if (!node) return;
  const start = Number(from) || 0;
  const end = Number(to) || 0;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    node.textContent = formatProbability(end);
    return;
  }
  const begun = performance.now();
  const duration = 420;
  const tick = (now) => {
    const t = Math.min(1, (now - begun) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    node.textContent = formatProbability(start + (end - start) * eased);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function moveRankedRows(container, rows, beliefs) {
  const first = new Map(rows.map(({ node, id }) => [id, node.getBoundingClientRect().top]));
  const ordered = [...rows].sort((a, b) => beliefs[b.id] - beliefs[a.id]);
  for (const row of ordered) container.append(row.node);
  for (const { node, id } of ordered) {
    const previous = first.get(id);
    const next = node.getBoundingClientRect().top;
    const delta = previous - next;
    if (!delta) continue;
    node.style.transition = "none";
    node.style.transform = `translateY(${delta}px)`;
    requestAnimationFrame(() => {
      node.style.transition = "transform 520ms cubic-bezier(0.16, 1, 0.3, 1)";
      node.style.transform = "translateY(0)";
    });
  }
}

function createBeliefNode(settlement) {
  const value = el("strong.setu-infer-node-value", { text: formatProbability(settlement.prior) });
  const delta = el("span.setu-infer-node-delta", { text: "+0 pp" });
  const node = el("button.setu-infer-belief-node", {
    type: "button",
    "data-settlement": settlement.id,
    "data-risk": "low",
  }, [
    el("span.setu-infer-node-mode", { text: settlement.mode }),
    value,
    el("span.setu-infer-node-name", { text: settlement.name }),
    delta,
  ]);
  return { id: settlement.id, node, value, delta, current: settlement.prior };
}

function createRankRow(settlement) {
  const probability = el("strong.setu-infer-rank-probability", { text: formatProbability(settlement.prior) });
  const movement = el("span.setu-infer-rank-delta", { text: "+0 pp" });
  const bar = el("i.setu-infer-rank-fill");
  const node = el("div.setu-infer-rank-row", { "data-settlement": settlement.id }, [
    el("span.setu-infer-rank-index", { text: "—" }),
    el("div.setu-infer-rank-name", {}, [
      el("strong", { text: settlement.name }),
      el("span", { text: settlement.mode }),
    ]),
    el("div.setu-infer-rank-meter", { "aria-hidden": "true" }, [bar]),
    movement,
    probability,
  ]);
  return { id: settlement.id, node, probability, movement, bar, current: settlement.prior };
}

function createStepButton(step, onSelect) {
  return el("button.setu-infer-step", {
    type: "button",
    "data-step": step.id,
    "aria-pressed": "false",
    onclick: () => onSelect(step, true),
  }, [
    el("span", { text: step.time }),
    el("strong", { text: step.code }),
    el("div", {}, [
      el("b", { text: step.source }),
      el("small", { text: step.claim }),
    ]),
    el("em", { text: step.state }),
  ]);
}

function createPrinciple(index, title, strong, copy, mark) {
  return el("article.setu-infer-principle", {}, [
    el("div.setu-infer-principle-visual", { "data-mark": mark, "aria-hidden": "true" }, [el("i"), el("i"), el("i")]),
    el("span", { text: `${index} · ${title}` }),
    el("strong", { text: strong }),
    el("p", { text: copy }),
  ]);
}

export function isInferRoute(pathname = window.location.pathname) {
  return /\/(?:[a-z]{2}\/)?(?:infer|inference|playground)\/?$/i.test(pathname);
}

export function mountInferPage() {
  const existing = document.querySelector(".setu-infer-root");
  if (existing) return existing;

  document.documentElement.setAttribute("data-setu", "on");
  document.documentElement.setAttribute("data-setu-page", "infer");
  document.title = "SETU | Risk Inference";

  let selected = INFER_STEPS[0];
  let userSelected = false;
  let autoTimer = null;

  const sourceCode = el("strong.setu-infer-source-code", { text: selected.code });
  const sourceState = el("span.setu-infer-source-state", { text: selected.state });
  const sourceName = el("span.setu-infer-source-name", { text: selected.source });
  const sourceClaim = el("p.setu-infer-source-claim", { text: selected.claim });
  const vote = el("strong.setu-infer-vote", { text: selected.vote });
  const weight = el("strong.setu-infer-weight", { text: selected.weight });
  const reliability = el("strong.setu-infer-reliability", { text: selected.reliability });
  const reason = el("p.setu-infer-reason", { text: selected.reason });
  const cascadeCopy = el("p.setu-infer-cascade-copy", { text: selected.cascade });
  const cascadeValue = el("strong.setu-infer-cascade-value", { text: selected.cascadeValue });
  const stepRail = el("div.setu-infer-step-rail");
  const rankList = el("div.setu-infer-rank-list");
  const activeMoment = el("span.setu-infer-active-moment", { text: `${selected.time} IST` });

  const beliefNodes = SETTLEMENTS.map(createBeliefNode);
  const rankRows = SETTLEMENTS.map(createRankRow);
  for (const row of rankRows) rankList.append(row.node);

  const setSelected = (step, manual = false) => {
    if (!step) return;
    if (manual) userSelected = true;
    selected = step;
    activeMoment.textContent = `${step.time} IST`;
    sourceCode.textContent = step.code;
    sourceState.textContent = step.state;
    sourceState.dataset.state = step.state.toLowerCase();
    sourceName.textContent = step.source;
    sourceClaim.textContent = step.claim;
    vote.textContent = step.vote;
    weight.textContent = step.weight;
    reliability.textContent = step.reliability;
    reason.textContent = step.reason;
    cascadeCopy.textContent = step.cascade;
    cascadeValue.textContent = step.cascadeValue;

    stepRail.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.step === step.id));
    });

    for (const item of beliefNodes) {
      const next = step.beliefs[item.id];
      animateNumber(item.value, item.current, next);
      item.current = next;
      item.delta.textContent = `${step.delta[item.id] >= 0 ? "+" : ""}${step.delta[item.id]} pp`;
      item.node.style.setProperty("--belief", `${next}%`);
      item.node.dataset.risk = next >= 75 ? "critical" : next >= 50 ? "high" : next >= 30 ? "watch" : "low";
    }

    moveRankedRows(rankList, rankRows, step.beliefs);
    const ordered = [...rankRows].sort((a, b) => step.beliefs[b.id] - step.beliefs[a.id]);
    ordered.forEach((item, index) => {
      const next = step.beliefs[item.id];
      animateNumber(item.probability, item.current, next);
      item.current = next;
      item.movement.textContent = `${step.delta[item.id] >= 0 ? "+" : ""}${step.delta[item.id]} pp`;
      item.bar.style.width = `${next}%`;
      item.node.dataset.risk = next >= 75 ? "critical" : next >= 50 ? "high" : next >= 30 ? "watch" : "low";
      item.node.querySelector(".setu-infer-rank-index").textContent = String(index + 1).padStart(2, "0");
    });
  };

  for (const step of INFER_STEPS) stepRail.append(createStepButton(step, setSelected));

  const root = el("div.setu-infer-root.setu-module-root", { "data-module": "inference" }, [
    el("main.setu-infer-page.setu-module-page", {}, [
      el("header.setu-infer-topbar.setu-module-topbar", {}, [
        el("a.setu-infer-brand", { href: "/", text: "SETU" }),
        el("div.setu-infer-context", {}, [
          el("span", { text: "WAYANAD · FIRST 24H" }),
          el("span", { text: "03 · INFERENCE" }),
        ]),
        el("div.setu-infer-toplinks", {}, [
          el("a", { href: "/validation", text: "← VALIDATION" }),
          el("a", { href: "/action", text: "ACTION →" }),
        ]),
      ]),
      el("section.setu-infer-hero", {}, [
        el("div.setu-infer-hero-copy", {}, [
          el("h1", { text: "INFERENCE" }),
          el("p", { text: "Validated evidence does not become a verdict. SETU moves a probability, preserves the uncertainty, and shows exactly why the ranking changed." }),
        ]),
        el("section.setu-infer-machine", {}, [
          el("div.setu-infer-machine-head", {}, [
            el("span", { text: "LIVE BELIEF UPDATE" }),
            activeMoment,
          ]),
          el("div.setu-infer-machine-flow", {}, [
            el("div.setu-infer-source-card", {}, [
              el("div.setu-infer-source-head", {}, [sourceCode, sourceState]),
              sourceName,
              sourceClaim,
              el("div.setu-infer-source-metrics", {}, [
                el("div", {}, [el("span", { text: "LOG-LR WEIGHT" }), weight]),
                el("div", {}, [el("span", { text: "SOURCE REL." }), reliability]),
              ]),
              el("div.setu-infer-vote-wrap", {}, [el("span", { text: "ALLOWED TO MOVE" }), vote]),
            ]),
            el("div.setu-infer-arrow", { "aria-hidden": "true" }, [el("i"), el("span", { text: "UPDATE" })]),
            el("div.setu-infer-belief-field", {}, [
              el("i.setu-infer-link.setu-infer-link-a"),
              el("i.setu-infer-link.setu-infer-link-b"),
              el("i.setu-infer-link.setu-infer-link-c"),
              ...beliefNodes.map((item) => item.node),
              el("div.setu-infer-cascade-note", {}, [
                el("span", { text: "CASCADE" }),
                cascadeValue,
                cascadeCopy,
              ]),
            ]),
          ]),
          el("div.setu-infer-machine-foot", {}, [
            el("span", { text: "WHY THIS MOVED" }),
            reason,
          ]),
        ]),
      ]),
      el("section.setu-infer-story", {}, [
        el("div.setu-infer-story-copy", {}, [
          el("h2", { text: "A CLAIM DOESN’T BECOME THE TRUTH. IT MOVES A DISTRIBUTION." }),
          el("p", { text: "Every update has a prior, a likelihood and a source weight. Nearby risk only propagates through explicit cascade edges, so the system can explain both what changed and what did not." }),
        ]),
        el("div.setu-infer-principles", {}, [
          createPrinciple("01", "PRIOR", "Start from what was already plausible.", "Hazard, exposure and settlement vulnerability define the baseline before a new report arrives.", "prior"),
          createPrinciple("02", "POSTERIOR", "Evidence moves probability, not labels.", "A strong callback can move the distribution sharply. A weak repost may move it almost not at all.", "posterior"),
          createPrinciple("03", "CASCADE", "Risk can travel without pretending damage did.", "Blocked access or upstream failure can raise downstream risk with a time lag while the downstream settlement remains unconfirmed.", "cascade"),
        ]),
      ]),
      el("section.setu-infer-workspace", {}, [
        el("div.setu-infer-workspace-head", {}, [
          el("div", {}, [
            el("span.setu-infer-section-label", { text: "VALIDATED INPUT → BELIEF" }),
            el("h2", { text: "WATCH THE RANKING MOVE" }),
          ]),
          el("p", { text: "SELECT AN EVIDENCE MOMENT · THE POSTERIOR RECOMPUTES" }),
        ]),
        el("div.setu-infer-workspace-grid", {}, [
          el("div.setu-infer-timeline", {}, [
            el("div.setu-infer-timeline-head", {}, [
              el("span", { text: "EVIDENCE TIMELINE" }),
              el("span", { text: "CUMULATIVE TRACE" }),
            ]),
            stepRail,
          ]),
          el("div.setu-infer-ranking", {}, [
            el("div.setu-infer-ranking-head", {}, [
              el("span", { text: "RANK" }),
              el("span", { text: "SETTLEMENT / FAILURE MODE" }),
              el("span", { text: "BELIEF" }),
              el("span", { text: "MOVE" }),
              el("span", { text: "P(SEVERE)" }),
            ]),
            rankList,
          ]),
        ]),
      ]),
      el("footer.setu-infer-footer", {}, [
        el("p", { text: "Inference is a ranked, explainable belief state. It is not an autonomous order to act." }),
        el("p", { text: "This page is a lightweight synthetic demo trace of SETU’s Bayesian belief fusion and time-lagged cascade model." }),
        el("a", { href: "/action", text: "NEXT · ACTION" }),
      ]),
    ]),
  ]);

  document.body.append(root);
  setSelected(selected);
  autoTimer = window.setInterval(() => {
    if (userSelected || document.hidden) return;
    const index = INFER_STEPS.findIndex((step) => step.id === selected.id);
    setSelected(INFER_STEPS[(index + 1) % INFER_STEPS.length]);
  }, 6200);

  window.addEventListener("pagehide", () => {
    if (autoTimer) window.clearInterval(autoTimer);
  }, { once: true });

  return root;
}

export function installInferRouteBridge() {
  if (window.__setuInferRouteBridge) return;
  window.__setuInferRouteBridge = true;

  const reconcile = () => {
    if (isInferRoute()) {
      mountInferPage();
      if (window.location.pathname !== "/inference") {
        history.replaceState(history.state, "", "/inference");
      }
      return;
    }
    if (document.querySelector(".setu-infer-root")) window.location.reload();
  };

  document.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    try {
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || !isInferRoute(url.pathname)) return;
      if (!anchor.closest(".setu-module-root")) return;
      event.preventDefault();
      window.location.assign("/inference");
    } catch {
      // Ignore malformed hrefs owned by the captured shell.
    }
  }, true);

  window.__setuRouteReconcilers ??= new Set();
  window.__setuRouteReconcilers.add(reconcile);
  if (!window.__setuRouteHistoryBridge) {
    window.__setuRouteHistoryBridge = true;
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method].bind(history);
      history[method] = (...args) => {
        const result = original(...args);
        queueMicrotask(() => window.__setuRouteReconcilers?.forEach((handler) => handler()));
        return result;
      };
    }
  }
  window.addEventListener("popstate", reconcile);
}
