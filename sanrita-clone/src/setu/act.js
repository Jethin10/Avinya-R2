import { el } from "./dom.js";

const ACT_TASKS = [
  {
    id: "mundakkai",
    rank: 1,
    place: "Mundakkai",
    mode: "LANDSLIDE + CASUALTY",
    action: "MEDICAL + RESCUE",
    asset: "AMB-02 · RESCUE-1",
    expectedHarm: 92,
    severe: 91,
    passable: 61,
    eta: "18 MIN",
    progress: 68,
    route: "MEPPADI → CHOORALMALA → MUNDAKKAI",
    saved: "8.4",
    reason: "High posterior, direct casualty corroboration and a narrowing access window dominate the queue.",
    constraint: "Bridge approach degraded · high-clearance final 1.8 km",
    state: "DISPATCH",
  },
  {
    id: "chooralmala",
    rank: 2,
    place: "Chooralmala",
    mode: "LANDSLIDE + ISOLATION",
    action: "SEARCH + ACCESS",
    asset: "RESCUE-2 · JCB-1",
    expectedHarm: 77,
    severe: 79,
    passable: 54,
    eta: "26 MIN",
    progress: 46,
    route: "KALPETTA → MEPPADI → CHOORALMALA",
    saved: "5.9",
    reason: "Risk is high, but the plan reserves medical capacity for Mundakkai and pairs access clearance here.",
    constraint: "One route edge below 0.6 passability",
    state: "DISPATCH",
  },
  {
    id: "attamala",
    rank: 3,
    place: "Attamala",
    mode: "ISOLATION",
    action: "PRE-POSITION",
    asset: "4×4-3 · MED KIT",
    expectedHarm: 51,
    severe: 61,
    passable: 73,
    eta: "31 MIN",
    progress: 34,
    route: "MEPPADI → RIDGE HOLD → ATTAMALA",
    saved: "3.1",
    reason: "Cascade risk crossed the pre-position threshold before direct severe damage was confirmed.",
    constraint: "Hold outside predicted failure footprint",
    state: "PRE-POSITION",
  },
  {
    id: "meppadi",
    rank: 4,
    place: "Meppadi PHC",
    mode: "MEDICAL PRESSURE",
    action: "STAGE CAPACITY",
    asset: "AMB-04 · TRIAGE KIT",
    expectedHarm: 34,
    severe: 34,
    passable: 92,
    eta: "12 MIN",
    progress: 82,
    route: "KALPETTA → MEPPADI PHC",
    saved: "2.2",
    reason: "Lower settlement risk, but the facility is the receiving node for two higher-priority missions.",
    constraint: "Keep one ambulance uncommitted for surge",
    state: "STAGE",
  },
];

const ASSETS = [
  { code: "AMB-02", type: "AMBULANCE", state: "ASSIGNED", detail: "Mundakkai · 18 min" },
  { code: "RESCUE-1", type: "RESCUE", state: "ASSIGNED", detail: "Mundakkai · paired" },
  { code: "JCB-1", type: "CLEARANCE", state: "ASSIGNED", detail: "Chooralmala · route edge" },
  { code: "4×4-3", type: "HIGH CLEARANCE", state: "PRE-POSITION", detail: "Attamala ridge hold" },
  { code: "AMB-04", type: "AMBULANCE", state: "STAGED", detail: "Meppadi PHC" },
  { code: "AMB-05", type: "AMBULANCE", state: "RESERVE", detail: "Uncommitted surge capacity" },
];

const VERIFICATIONS = [
  {
    id: "road",
    score: 0.84,
    question: "Is the Chooralmala bridge approach still passable to an ambulance?",
    action: "CALL ROAD CREW",
    resolves: "route + asset type",
  },
  {
    id: "phc",
    score: 0.72,
    question: "Has Mundakkai casualty load exceeded local transport capacity?",
    action: "CALL PHC",
    resolves: "medical priority",
  },
  {
    id: "ridge",
    score: 0.57,
    question: "Is the Attamala ridge route losing access faster than forecast?",
    action: "FIELD CHECK",
    resolves: "pre-position timing",
  },
];

function createTaskRow(task, onSelect) {
  const node = el("button.setu-act-task", {
    type: "button",
    "data-task": task.id,
    "aria-pressed": "false",
    onclick: () => onSelect(task, true),
  }, [
    el("span.setu-act-task-rank", { text: String(task.rank).padStart(2, "0") }),
    el("div.setu-act-task-place", {}, [
      el("strong", { text: task.place }),
      el("span", { text: task.mode }),
    ]),
    el("div.setu-act-task-action", {}, [
      el("strong", { text: task.action }),
      el("span", { text: task.asset }),
    ]),
    el("span.setu-act-task-harm", { text: `${task.expectedHarm}` }),
    el("span.setu-act-task-eta", { text: task.eta }),
  ]);
  return { task, node };
}

function createAssetRow(asset) {
  return el("div.setu-act-asset-row", { "data-state": asset.state.toLowerCase() }, [
    el("strong", { text: asset.code }),
    el("span", { text: asset.type }),
    el("span", { text: asset.detail }),
    el("em", { text: asset.state }),
  ]);
}

function createPrinciple(index, title, strong, copy, mark) {
  return el("article.setu-act-principle", {}, [
    el("div.setu-act-principle-visual", { "data-mark": mark, "aria-hidden": "true" }, [el("i"), el("i"), el("i")]),
    el("span", { text: `${index} · ${title}` }),
    el("strong", { text: strong }),
    el("p", { text: copy }),
  ]);
}

export function isActRoute(pathname = window.location.pathname) {
  return /\/(?:[a-z]{2}\/)?(?:act|contact)\/?$/i.test(pathname);
}

export function mountActPage() {
  const existing = document.querySelector(".setu-act-root");
  if (existing) return existing;

  document.documentElement.setAttribute("data-setu", "on");
  document.documentElement.setAttribute("data-setu-page", "act");
  document.title = "SETU | Response Decision";

  let selected = ACT_TASKS[0];
  let userSelected = false;
  let autoTimer = null;

  const selectedRank = el("span.setu-act-selected-rank", { text: "01" });
  const selectedPlace = el("h2.setu-act-selected-place", { text: selected.place });
  const selectedMode = el("span.setu-act-selected-mode", { text: selected.mode });
  const selectedAction = el("strong.setu-act-selected-action", { text: selected.action });
  const selectedAsset = el("strong.setu-act-selected-asset", { text: selected.asset });
  const selectedEta = el("strong.setu-act-selected-eta", { text: selected.eta });
  const selectedHarm = el("strong.setu-act-selected-harm", { text: `${selected.expectedHarm}` });
  const selectedSaved = el("strong.setu-act-selected-saved", { text: selected.saved });
  const selectedPassable = el("strong.setu-act-selected-passable", { text: `${selected.passable}%` });
  const selectedReason = el("p.setu-act-selected-reason", { text: selected.reason });
  const selectedConstraint = el("p.setu-act-route-constraint", { text: selected.constraint });
  const routeName = el("strong.setu-act-route-name", { text: selected.route });
  const routeFill = el("i.setu-act-route-fill");
  const routeMarker = el("i.setu-act-route-marker");
  const routePercent = el("span.setu-act-route-percent", { text: `${selected.passable}% PASSABLE` });
  const queue = el("div.setu-act-task-list");
  const verifyList = el("div.setu-act-verify-list");
  const decisionPulse = el("span.setu-act-decision-pulse", { text: "PLAN STABLE" });
  const decisionNote = el("p.setu-act-decision-note", { text: "Waiting for the next high-value verification return." });

  const taskRows = ACT_TASKS.map((task) => createTaskRow(task, setSelected));
  for (const item of taskRows) queue.append(item.node);

  function setSelected(task, manual = false) {
    if (!task) return;
    if (manual) userSelected = true;
    selected = task;
    selectedRank.textContent = String(task.rank).padStart(2, "0");
    selectedPlace.textContent = task.place;
    selectedMode.textContent = task.mode;
    selectedAction.textContent = task.action;
    selectedAsset.textContent = task.asset;
    selectedEta.textContent = task.eta;
    selectedHarm.textContent = `${task.expectedHarm}`;
    selectedSaved.textContent = task.saved;
    selectedPassable.textContent = `${task.passable}%`;
    selectedReason.textContent = task.reason;
    selectedConstraint.textContent = task.constraint;
    routeName.textContent = task.route;
    routePercent.textContent = `${task.passable}% PASSABLE`;
    routeFill.style.width = `${task.passable}%`;
    routeMarker.style.setProperty("--route-progress", `${task.progress}%`);
    taskRows.forEach(({ task: rowTask, node }) => node.setAttribute("aria-pressed", String(rowTask.id === task.id)));
  }

  const applyVerification = (verification, button) => {
    if (button.dataset.resolved === "true") return;
    button.dataset.resolved = "true";
    button.querySelector("em").textContent = "RETURNED";
    decisionPulse.textContent = "PLAN RE-RANKED";
    decisionPulse.dataset.state = "changed";
    if (verification.id === "road") {
      decisionNote.textContent = "Bridge approach confirmed degraded. RESCUE-2 keeps the corridor; ambulance routing remains on the higher-clearance branch.";
      setSelected(ACT_TASKS[1], true);
    } else if (verification.id === "phc") {
      decisionNote.textContent = "PHC confirms transport pressure. Mundakkai remains rank 01 and reserve ambulance AMB-05 moves to readiness.";
      setSelected(ACT_TASKS[0], true);
    } else {
      decisionNote.textContent = "Ridge check keeps the pre-position threshold active. Attamala remains a precautionary move, not a confirmed severe-damage dispatch.";
      setSelected(ACT_TASKS[2], true);
    }
    window.setTimeout(() => {
      decisionPulse.textContent = "PLAN STABLE";
      decisionPulse.dataset.state = "stable";
    }, 2200);
  };

  for (const verification of VERIFICATIONS) {
    const button = el("button.setu-act-verify-row", {
      type: "button",
      "data-verify": verification.id,
      "data-resolved": "false",
      onclick: () => applyVerification(verification, button),
    }, [
      el("strong", { text: verification.score.toFixed(2) }),
      el("div", {}, [
        el("span", { text: verification.question }),
        el("small", { text: `${verification.action} · resolves ${verification.resolves}` }),
      ]),
      el("em", { text: "SIMULATE RETURN" }),
    ]);
    verifyList.append(button);
  }

  const root = el("div.setu-act-root", {}, [
    el("main.setu-act-page", {}, [
      el("header.setu-act-topbar", {}, [
        el("a.setu-act-brand", { href: "/", text: "SETU" }),
        el("div.setu-act-context", {}, [
          el("span", { text: "WAYANAD · FIRST 24H" }),
          el("span", { text: "DECISION LAYER" }),
        ]),
        el("div.setu-act-toplinks", {}, [
          el("a", { href: "/infer", text: "← INFER" }),
          el("a", { href: "/", text: "DISTRICT TWIN →" }),
        ]),
      ]),
      el("section.setu-act-hero", {}, [
        el("div.setu-act-hero-copy", {}, [
          el("h1", {}, ["TURN BELIEF", el("br"), "INTO ACTION"]),
          el("p", { text: "SETU does not dispatch to the reddest dot. It weighs expected harm, route viability, asset fit and what one more verification could change, then leaves a receipt for the operator." }),
        ]),
        el("section.setu-act-machine", {}, [
          el("div.setu-act-machine-head", {}, [
            el("span", { text: "LIVE DECISION CYCLE" }),
            el("span", { text: "03:44 IST · SYNTHETIC DEMO" }),
          ]),
          el("div.setu-act-machine-grid", {}, [
            el("div.setu-act-selected", {}, [
              el("div.setu-act-selected-head", {}, [
                selectedRank,
                el("div", {}, [selectedPlace, selectedMode]),
              ]),
              el("div.setu-act-selected-command", {}, [
                el("span", { text: "ORDER" }),
                selectedAction,
                selectedAsset,
              ]),
              el("div.setu-act-selected-metrics", {}, [
                el("div", {}, [el("span", { text: "EXPECTED HARM" }), selectedHarm]),
                el("div", {}, [el("span", { text: "ETA" }), selectedEta]),
                el("div", {}, [el("span", { text: "EST. LIVES SAVED" }), selectedSaved]),
                el("div", {}, [el("span", { text: "ROUTE PASS." }), selectedPassable]),
              ]),
              selectedReason,
            ]),
            el("div.setu-act-route", {}, [
              el("div.setu-act-route-head", {}, [
                el("span", { text: "ROUTE VIABILITY" }),
                routePercent,
              ]),
              el("div.setu-act-route-line", {}, [
                el("i.setu-act-route-track"),
                routeFill,
                routeMarker,
                el("span.setu-act-route-stop.setu-act-route-stop-a"),
                el("span.setu-act-route-stop.setu-act-route-stop-b"),
                el("span.setu-act-route-stop.setu-act-route-stop-c"),
              ]),
              routeName,
              selectedConstraint,
              el("div.setu-act-route-logic", {}, [
                el("span", { text: "RISK × PEOPLE × DELAY" }),
                el("i", { "aria-hidden": "true" }),
                el("span", { text: "PASSABLE SUBGRAPH" }),
                el("i", { "aria-hidden": "true" }),
                el("span", { text: "ASSET MATCH" }),
              ]),
            ]),
          ]),
          el("div.setu-act-machine-foot", {}, [
            decisionPulse,
            decisionNote,
          ]),
        ]),
      ]),
      el("section.setu-act-story", {}, [
        el("div.setu-act-story-copy", {}, [
          el("h2", { text: "DISPATCH IS NOT SEVERITY SORTING." }),
          el("p", { text: "Two places can have the same risk and demand completely different moves. Time-to-harm, isolation, route degradation and the assets you still have available decide what comes first." }),
        ]),
        el("div.setu-act-principles", {}, [
          createPrinciple("01", "HARM", "Rank the cost of waiting.", "Expected harm combines probability, exposed people, failure mode and how delay changes mortality.", "harm"),
          createPrinciple("02", "ACCESS", "A perfect plan that cannot arrive is not a plan.", "Every asset gets its own traversable route graph, so route degradation can change both ETA and asset choice.", "access"),
          createPrinciple("03", "VERIFY", "Ask only when the answer can change the move.", "Value of Information ranks callbacks and checks by how much they could reduce decision regret.", "verify"),
        ]),
      ]),
      el("section.setu-act-workspace", {}, [
        el("div.setu-act-workspace-head", {}, [
          el("div", {}, [
            el("span.setu-act-section-label", { text: "RANKED RESPONSE PLAN" }),
            el("h2", { text: "WHAT MOVES NOW" }),
          ]),
          el("p", { text: "SELECT A MISSION · ROUTE + ASSET LOGIC UPDATES ABOVE" }),
        ]),
        el("div.setu-act-task-head", {}, [
          el("span", { text: "RANK" }),
          el("span", { text: "PLACE / MODE" }),
          el("span", { text: "ORDER / ASSET" }),
          el("span", { text: "HARM" }),
          el("span", { text: "ETA" }),
        ]),
        queue,
        el("div.setu-act-lower-grid", {}, [
          el("section.setu-act-assets", {}, [
            el("div.setu-act-subhead", {}, [el("span", { text: "ASSET STATE" }), el("strong", { text: "6 AVAILABLE / 5 COMMITTED" })]),
            el("div.setu-act-asset-list", {}, ASSETS.map(createAssetRow)),
          ]),
          el("section.setu-act-verify", {}, [
            el("div.setu-act-subhead", {}, [el("span", { text: "VERIFY NEXT · VALUE OF INFORMATION" }), el("strong", { text: "CLICK TO SIMULATE A RETURN" })]),
            verifyList,
          ]),
        ]),
      ]),
      el("footer.setu-act-footer", {}, [
        el("p", { text: "The machine proposes. The operator can inspect, override and leave the reason attached to the decision." }),
        el("p", { text: "Synthetic demo trace of SETU’s expected-harm ranking, route-aware asset assignment and Value-of-Information queue." }),
        el("a", { href: "/", text: "OPEN DISTRICT TWIN" }),
      ]),
    ]),
  ]);

  document.body.append(root);
  setSelected(selected);

  autoTimer = window.setInterval(() => {
    if (userSelected || document.hidden) return;
    const index = ACT_TASKS.findIndex((task) => task.id === selected.id);
    setSelected(ACT_TASKS[(index + 1) % ACT_TASKS.length]);
  }, 7200);

  window.addEventListener("pagehide", () => {
    if (autoTimer) window.clearInterval(autoTimer);
  }, { once: true });

  return root;
}

export function installActRouteBridge() {
  if (window.__setuActRouteBridge) return;
  window.__setuActRouteBridge = true;

  const reconcile = () => {
    if (isActRoute()) {
      mountActPage();
      return;
    }
    if (document.querySelector(".setu-act-root")) window.location.reload();
  };

  document.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    try {
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || !isActRoute(url.pathname)) return;
      event.preventDefault();
      window.location.assign("/act");
    } catch {
      // Ignore malformed hrefs owned by the captured shell.
    }
  }, true);

  window.addEventListener("popstate", reconcile);
}
