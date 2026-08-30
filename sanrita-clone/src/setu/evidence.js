import { el } from "./dom.js";

export const SOURCES = [
  {
    id: "field",
    code: "FT",
    name: "Field teams",
    kind: "human / direct",
    state: "live",
    activity: [1, 1, 1, 0, 1, 1, 1],
    description: "PHC calls, responder notes and local verification teams.",
  },
  {
    id: "satphone",
    code: "SP",
    name: "Satellite phone",
    kind: "voice / fragmented",
    state: "degraded",
    activity: [1, 0, 1, 0, 0, 1, 0],
    description: "Short voice fragments from places where terrestrial networks are down.",
  },
  {
    id: "social",
    code: "SM",
    name: "Social media",
    kind: "public / high volume",
    state: "noisy",
    activity: [1, 1, 0, 1, 1, 1, 1],
    description: "Forwarded posts, clips and location claims that need corroboration.",
  },
  {
    id: "news",
    code: "NW",
    name: "News desks",
    kind: "media / second-hand",
    state: "live",
    activity: [0, 1, 1, 1, 0, 1, 1],
    description: "Local television, radio and newsroom reports entering the same ledger.",
  },
  {
    id: "telecom",
    code: "TC",
    name: "Telecom silence",
    kind: "absence / passive",
    state: "partial",
    activity: [1, 1, 1, 0, 0, 0, 0],
    description: "Tower attach loss and sudden communication blackouts treated as evidence of absence.",
  },
  {
    id: "remote",
    code: "RS",
    name: "Remote sensing",
    kind: "machine / delayed",
    state: "scheduled",
    activity: [0, 0, 0, 0, 1, 0, 0],
    description: "Satellite passes and derived surface-change signals when ground access is blocked.",
  },
  {
    id: "weather",
    code: "WX",
    name: "Weather + sensors",
    kind: "telemetry / continuous",
    state: "live",
    activity: [1, 1, 1, 1, 1, 0, 1],
    description: "Rainfall, feeder state and other machine telemetry used as supporting context.",
  },
];

export const SIGNALS = [
  {
    id: "sig-01",
    source: "satphone",
    time: "02:11",
    area: "Interior sector",
    summary: "Voice fragment reports the only road out is no longer passable.",
    detail: "Connection drops before a precise location or damage count can be confirmed.",
    state: "UNRESOLVED",
    handling: "Locate caller, compare with route graph, request one high-value callback.",
  },
  {
    id: "sig-02",
    source: "social",
    time: "02:17",
    area: "Location missing",
    summary: "Forwarded clip claims an entire neighbourhood has collapsed.",
    detail: "High-severity language, no original uploader and no reliable geolocation attached.",
    state: "UNVERIFIED",
    handling: "Keep out of dispatch until location and independent corroboration improve.",
  },
  {
    id: "sig-03",
    source: "telecom",
    time: "02:24",
    area: "Western cluster",
    summary: "Mobile attachment activity falls away across several adjacent settlements.",
    detail: "Silence is preserved as a signal instead of being interpreted as no damage.",
    state: "MACHINE SIGNAL",
    handling: "Raise uncertainty and verification value where human reports also disappear.",
  },
  {
    id: "sig-04",
    source: "news",
    time: "02:31",
    area: "District desk",
    summary: "Local newsroom relays that informal shelters are filling faster than expected.",
    detail: "Useful context, but the report is one step removed from the original observers.",
    state: "REPORTED",
    handling: "Cross-check against field and facility channels before changing medical dispatch.",
  },
  {
    id: "sig-05",
    source: "field",
    time: "02:38",
    area: "PHC callback",
    summary: "Health-centre callback confirms rising casualty load and an access blockage.",
    detail: "Named verification channel answers a question that directly affects asset choice.",
    state: "CORROBORATED",
    handling: "Update belief, recalculate route feasibility and record the evidence receipt.",
  },
  {
    id: "sig-06",
    source: "weather",
    time: "02:44",
    area: "Rain gauge sector",
    summary: "Rainfall telemetry remains elevated while drainage exposure is increasing.",
    detail: "Machine context changes the prior, but it does not by itself prove settlement damage.",
    state: "TELEMETRY",
    handling: "Use as supporting evidence for inundation and landslide risk, not as a casualty claim.",
  },
  {
    id: "sig-07",
    source: "remote",
    time: "03:02",
    area: "Next satellite pass",
    summary: "Remote-sensing window can test surface change where roads remain inaccessible.",
    detail: "The channel is slower than a phone call, but reaches places field teams cannot.",
    state: "PENDING PASS",
    handling: "Rank against faster verification options using value of information.",
  },
  {
    id: "sig-08",
    source: "social",
    time: "03:10",
    area: "Forwarded message",
    summary: "Multiple reposts repeat the same severe claim with slightly different locations.",
    detail: "Volume is not treated as independent corroboration when posts share the same origin.",
    state: "DUPLICATE CLUSTER",
    handling: "Collapse copies into one claim and keep the original provenance chain attached.",
  },
];

export const SIGNAL_META = {
  "sig-01": {
    origin: "Satellite-phone relay · interior ridge",
    evidence: "14 s voice fragment · road-loss claim",
    location: "Mundakkai ridge corridor",
    coordinates: "11.486° N · 76.132° E · ±2.1 km",
    confidence: "42%",
    route: ["Speech extract", "Locate caller", "Route graph check", "Verification queue"],
    capture: "voice",
  },
  "sig-02": {
    origin: "Public social feed · forwarded video",
    evidence: "11 s clip · collapse claim · 38 reposts",
    location: "Chooralmala claim · location unresolved",
    coordinates: "Three conflicting place tags · ±4.8 km",
    confidence: "21%",
    route: ["Origin trace", "Duplicate collapse", "Geolocation", "Hold dispatch"],
    capture: "social",
  },
  "sig-03": {
    origin: "Telecom network · six adjacent cell sectors",
    evidence: "81% attach-rate drop sustained for 18 min",
    location: "Western settlement cluster",
    coordinates: "11.512° N · 76.087° E · 6-cell footprint",
    confidence: "63%",
    route: ["Silence detector", "Cluster anomaly", "Raise uncertainty", "VOI verification"],
    capture: "telecom",
  },
  "sig-04": {
    origin: "Local television desk · newsroom relay",
    evidence: "Shelter-load report · second-hand testimony",
    location: "Kalpetta district desk → Meppadi shelters",
    coordinates: "Administrative-area claim · not point verified",
    confidence: "48%",
    route: ["Transcript", "Entity extract", "Facility cross-check", "Medical context"],
    capture: "news",
  },
  "sig-05": {
    origin: "Field channel · named PHC callback",
    evidence: "Direct callback · casualties + blocked approach road",
    location: "Meppadi PHC catchment",
    coordinates: "11.554° N · 76.135° E · named facility",
    confidence: "88%",
    route: ["Identity match", "Claim reconcile", "Belief update", "Medical dispatch"],
    capture: "field",
  },
  "sig-06": {
    origin: "Rain gauge + drainage telemetry",
    evidence: "Rainfall intensity + rising drainage exposure",
    location: "Meppadi rain-gauge sector",
    coordinates: "11.552° N · 76.121° E · sensor footprint",
    confidence: "74%",
    route: ["Telemetry ingest", "Hazard prior", "Exposure join", "Risk context"],
    capture: "weather",
  },
  "sig-07": {
    origin: "Remote sensing · synthetic orbital pass",
    evidence: "10 m surface-change tile · access corridor candidate",
    location: "Chooralmala–Mundakkai corridor",
    coordinates: "11.475° N · 76.131° E · 2.8 km² tile",
    confidence: "57%",
    route: ["Tile ingest", "Change detection", "Road overlap", "Belief update"],
    capture: "remote",
  },
  "sig-08": {
    origin: "Public social feed · repost cluster",
    evidence: "23 copies traced to one original severe claim",
    location: "Forwarded location labels disagree",
    coordinates: "Mundakkai / Chooralmala / Meppadi tags",
    confidence: "18%",
    route: ["Origin graph", "Collapse copies", "Keep provenance", "No new vote"],
    capture: "social",
  },
};

const CAPTURE_MEDIA = {
  field: {
    src: "/setu/evidence/field-team.jpg",
    alt: "Indian NDRF responders working through collapsed concrete during a rescue operation.",
    cue: "DIRECT HUMAN",
    note: "RESPONDER / GROUND CONFIRMATION",
    position: "center 56%",
  },
  satphone: {
    src: "/setu/evidence/satellite-phone.jpg",
    alt: "Two responders using an Iridium satellite phone beside an aircraft in a remote environment.",
    cue: "OFF-GRID VOICE",
    note: "SATELLITE RELAY / FRAGMENTED",
    position: "center 44%",
  },
  social: {
    src: "/setu/evidence/social-media.jpg",
    alt: "A disaster survivor showing flood-related social-media posts on a mobile phone.",
    cue: "PUBLIC FEED",
    note: "REPOST CHAIN / ORIGIN UNCERTAIN",
    position: "66% center",
  },
  news: {
    src: "/setu/evidence/news-desk.jpg",
    alt: "A working television newsroom with cameras, desks, monitors and an active news set.",
    cue: "MEDIA RELAY",
    note: "NEWSROOM / SECOND-HAND",
    position: "center 62%",
  },
  telecom: {
    src: "/setu/evidence/telecom-outage.jpg",
    alt: "A collapsed mobile communications tower after severe storm damage.",
    cue: "PASSIVE SIGNAL",
    note: "TOWER FAILURE / NETWORK SILENCE",
    position: "center 67%",
  },
  remote: {
    src: "/setu/evidence/remote-sensing.jpg",
    alt: "Satellite imagery showing a large landslide scar and debris field from above.",
    cue: "ORBITAL PASS",
    note: "SURFACE CHANGE / REMOTE SENSING",
    position: "center center",
  },
  weather: {
    src: "/setu/evidence/weather-sensor.jpg",
    alt: "An automatic rain gauge and environmental monitoring station on an exposed hillside.",
    cue: "LIVE TELEMETRY",
    note: "RAIN GAUGE / SENSOR CONTEXT",
    position: "center 58%",
  },
};

export function sourceFor(id) {
  return SOURCES.find((source) => source.id === id) || SOURCES[0];
}

function sourceMark(source) {
  return el("span.setu-evidence-source-mark", { text: source.code, "aria-hidden": "true" });
}

function situationTone(source) {
  if (source.id === "field") return "confirmed";
  if (source.id === "social") return "conflict";
  if (source.id === "telecom" || source.id === "satphone") return "warning";
  return "context";
}

export function metaFor(signal) {
  return SIGNAL_META[signal.id] || {
    origin: sourceFor(signal.source).name,
    evidence: signal.summary,
    location: signal.area,
    coordinates: "Location unresolved",
    confidence: "—",
    route: ["Ingest", "Reconcile", "Belief update", "Decision"],
    capture: "field",
  };
}

function createCaptureVisual(signal) {
  const meta = metaFor(signal);
  const source = sourceFor(signal.source);
  const media = CAPTURE_MEDIA[source.id] || CAPTURE_MEDIA.field;
  const frame = el("div.setu-evidence-capture", {
    "data-capture": meta.capture,
    "data-source": source.id,
  });
  const header = el("div.setu-evidence-capture-head", {}, [
    el("span", { text: source.name }),
    el("span", { text: `${signal.time} IST` }),
  ]);
  const body = el("div.setu-evidence-photo", {}, [
    el("img.setu-evidence-photo-img", {
      src: media.src,
      alt: media.alt,
      loading: "eager",
      decoding: "async",
      style: { objectPosition: media.position },
    }),
    el("div.setu-evidence-photo-tint", { "aria-hidden": "true" }),
    el("div.setu-evidence-photo-readout", {}, [
      el("span", { text: media.cue }),
      el("strong", { text: media.note }),
    ]),
  ]);

  frame.append(header, body, el("div.setu-evidence-capture-foot", {}, [
    el("span", { text: meta.evidence }),
    el("strong", { text: signal.state }),
  ]));
  return frame;
}

const FOCUS_READS = {
  all: {
    label: "CURRENT READ",
    title: "PARTIALLY CONFLICTED",
    copy: "Severe claims are outrunning verification. One medical callback holds; the western cluster is going quiet.",
    tone: "conflict",
  },
  field: {
    label: "CORROBORATED",
    title: "DIRECT CALLBACK HOLDS",
    copy: "A named health-centre callback confirms casualty pressure and an access blockage. This can change dispatch.",
    tone: "confirmed",
  },
  satphone: {
    label: "FRAGMENTED",
    title: "ONE ROUTE CLAIM. NOT ENOUGH YET.",
    copy: "The caller says the only road out is gone, then the connection drops before location and scale are fixed.",
    tone: "warning",
  },
  social: {
    label: "CONFLICT",
    title: "VIRAL SEVERITY. NO STABLE LOCATION.",
    copy: "Multiple reposts repeat one severe claim with shifting locations. Volume is not independent corroboration.",
    tone: "conflict",
  },
  news: {
    label: "REPORTED",
    title: "SHELTER PRESSURE IS RISING",
    copy: "News desks add useful district context, but the observation is second-hand until field or facility channels agree.",
    tone: "context",
  },
  telecom: {
    label: "SILENCE",
    title: "THE WEST IS GOING QUIET",
    copy: "Tower attachment activity falls away across adjacent settlements. Missing reports now increase uncertainty instead of reducing it.",
    tone: "warning",
  },
  remote: {
    label: "PENDING",
    title: "THE NEXT PASS CAN REACH WHAT TEAMS CANNOT",
    copy: "Remote sensing is slower, but it can test surface change where severed roads make physical verification impossible.",
    tone: "context",
  },
  weather: {
    label: "CONTEXT",
    title: "RAIN RAISES THE PRIOR. IT DOES NOT PROVE DAMAGE.",
    copy: "Telemetry changes what is plausible, while remaining supporting evidence rather than a casualty claim by itself.",
    tone: "context",
  },
};

const SOURCE_POSITIONS = {
  field: [18, 18],
  satphone: [73, 16],
  social: [87, 43],
  news: [76, 76],
  telecom: [24, 78],
  remote: [51, 89],
  weather: [10, 48],
};

function createSituationBoard(onSource, onSignal) {
  const sourceTabs = el("div.setu-evidence-trace-sources");
  const captureHost = el("div.setu-evidence-capture-host");
  const sourceName = el("strong.setu-evidence-trace-source-name");
  const sourceKind = el("span.setu-evidence-trace-source-kind");
  const sourceOrigin = el("p.setu-evidence-trace-origin");
  const claim = el("h2.setu-evidence-trace-claim");
  const evidenceType = el("strong.setu-evidence-fact-value");
  const location = el("strong.setu-evidence-fact-value");
  const coordinates = el("span.setu-evidence-fact-note");
  const confidence = el("strong.setu-evidence-confidence-value");
  const confidenceBar = el("i.setu-evidence-confidence-bar");
  const state = el("span.setu-evidence-trace-state");
  const route = el("div.setu-evidence-route-steps");
  const action = el("p.setu-evidence-route-action");
  const selectedId = el("span.setu-evidence-trace-id");

  for (const source of SOURCES) {
    sourceTabs.append(el("button.setu-evidence-trace-source", {
      type: "button",
      "data-source": source.id,
      "aria-pressed": "false",
      onclick: () => {
        const firstSignal = SIGNALS.find((signal) => signal.source === source.id);
        onSource?.(source.id);
        if (firstSignal) onSignal?.(firstSignal);
      },
    }, [
      sourceMark(source),
      el("span", {}, [
        el("strong", { text: source.name }),
        el("small", { text: source.kind }),
      ]),
    ]));
  }

  const node = el("section.setu-evidence-situation", {}, [
    el("div.setu-evidence-situation-head", {}, [
      el("span", { text: "LIVE EVIDENCE TRACE · SOURCE → CLAIM → LOCATION → DECISION" }),
      selectedId,
    ]),
    sourceTabs,
    el("div.setu-evidence-trace", {}, [
      el("article.setu-evidence-trace-panel.setu-evidence-trace-from", {}, [
        el("div.setu-evidence-trace-label", { text: "01 · WHERE IT COMES FROM" }),
        el("div.setu-evidence-trace-source-line", {}, [sourceName, sourceKind]),
        sourceOrigin,
        captureHost,
      ]),
      el("div.setu-evidence-trace-arrow", { "aria-hidden": "true" }, [el("i"), el("span", { text: "INGEST" })]),
      el("article.setu-evidence-trace-panel.setu-evidence-trace-what", {}, [
        el("div.setu-evidence-trace-label", { text: "02 · WHAT THE EVIDENCE SAYS" }),
        claim,
        el("div.setu-evidence-facts", {}, [
          el("div.setu-evidence-fact", {}, [
            el("span", { text: "EVIDENCE OBJECT" }),
            evidenceType,
          ]),
          el("div.setu-evidence-fact.setu-evidence-location", {}, [
            el("span", { text: "LOCATED AT" }),
            location,
            coordinates,
            el("div.setu-evidence-location-plot", { "aria-hidden": "true" }, [
              el("i.setu-location-ring.setu-location-ring-a"),
              el("i.setu-location-ring.setu-location-ring-b"),
              el("i.setu-location-pin"),
            ]),
          ]),
          el("div.setu-evidence-fact.setu-evidence-confidence", {}, [
            el("span", { text: "CURRENT CONFIDENCE" }),
            confidence,
            el("div.setu-evidence-confidence-track", {}, [confidenceBar]),
            state,
          ]),
        ]),
      ]),
      el("div.setu-evidence-trace-arrow", { "aria-hidden": "true" }, [el("i"), el("span", { text: "ROUTE" })]),
      el("article.setu-evidence-trace-panel.setu-evidence-trace-to", {}, [
        el("div.setu-evidence-trace-label", { text: "03 · WHERE IT GOES" }),
        el("h3", { text: "SETU routes the claim, not the panic." }),
        route,
        el("div.setu-evidence-route-result", {}, [
          el("span", { text: "DECISION EFFECT" }),
          action,
        ]),
      ]),
    ]),
    el("div.setu-evidence-situation-foot", {}, [
      el("span", { text: "SELECT ANY SOURCE ABOVE OR ANY EVIDENCE ROW BELOW" }),
      el("span", { text: "SYNTHETIC DEMO · PROVENANCE PRESERVED END TO END" }),
    ]),
  ]);

  const setSignal = (signal) => {
    if (!signal) return;
    const source = sourceFor(signal.source);
    const meta = metaFor(signal);
    sourceName.textContent = source.name;
    sourceKind.textContent = `${source.kind} · ${source.state}`;
    sourceOrigin.textContent = meta.origin;
    captureHost.replaceChildren(createCaptureVisual(signal));
    claim.textContent = signal.summary;
    evidenceType.textContent = meta.evidence;
    location.textContent = meta.location;
    coordinates.textContent = meta.coordinates;
    confidence.textContent = meta.confidence;
    confidenceBar.style.width = meta.confidence === "—" ? "0%" : meta.confidence;
    state.textContent = signal.state;
    action.textContent = signal.handling;
    selectedId.textContent = `${signal.id.toUpperCase()} · ${signal.time} IST`;
    route.replaceChildren(...meta.route.map((step, index) => el("div.setu-evidence-route-step", {}, [
      el("span", { text: String(index + 1).padStart(2, "0") }),
      el("strong", { text: step }),
    ])));
    sourceTabs.querySelectorAll(".setu-evidence-trace-source").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.source === signal.source));
    });
    node.dataset.tone = situationTone(source);
  };

  return {
    node,
    setActive(sourceId) {
      sourceTabs.querySelectorAll(".setu-evidence-trace-source").forEach((button) => {
        button.setAttribute("aria-pressed", String(sourceId !== "all" && button.dataset.source === sourceId));
      });
    },
    setSignal,
  };
}

function createInlineDetail(signal) {
  const meta = metaFor(signal);
  return el("div.setu-evidence-inline-detail", {}, [
    el("div.setu-evidence-detail-copy", {}, [
      el("span.setu-evidence-detail-kicker", { text: "WHY IT MATTERS" }),
      el("p", { text: signal.detail }),
    ]),
    el("dl.setu-evidence-meta", {}, [
      el("div", {}, [el("dt", { text: "Received" }), el("dd", { text: `${signal.time} IST` })]),
      el("div", {}, [el("dt", { text: "Origin" }), el("dd", { text: meta.origin })]),
      el("div", {}, [el("dt", { text: "Evidence" }), el("dd", { text: meta.evidence })]),
      el("div", {}, [el("dt", { text: "Location" }), el("dd", { text: meta.location })]),
      el("div", {}, [el("dt", { text: "Coordinates" }), el("dd", { text: meta.coordinates })]),
      el("div", {}, [el("dt", { text: "Confidence" }), el("dd", { text: meta.confidence })]),
      el("div", {}, [el("dt", { text: "State" }), el("dd", { text: signal.state })]),
      el("div", {}, [el("dt", { text: "Provenance" }), el("dd", { text: "Synthetic demo signal" })]),
    ]),
    el("div.setu-evidence-next", {}, [
      el("span", { text: "WHAT SETU DOES NEXT" }),
      el("p", { text: signal.handling }),
    ]),
  ]);
}

async function hydratePackageMeta(root) {
  try {
    const response = await fetch("/setu/wayanad-demo/district.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`district metadata ${response.status}`);
    const district = await response.json();
    const values = {
      events: district.counts?.events,
      settlements: district.counts?.settlements,
      assets: district.counts?.assets,
      privacy: district.event_streams?.personal_data === false ? "NONE" : "CHECK",
    };
    for (const [key, value] of Object.entries(values)) {
      const node = root.querySelector(`[data-meta-${key}]`);
      if (node && value != null) node.textContent = String(value);
    }
    const disclosure = root.querySelector("[data-evidence-disclosure]");
    if (disclosure && district.provenance?.disclosure) disclosure.textContent = district.provenance.disclosure;
  } catch (error) {
    console.warn("[setu] evidence metadata unavailable", error);
  }
}

export function isEvidenceRoute(pathname = window.location.pathname) {
  return /\/(?:[a-z]{2}\/)?(?:about|evidence)\/?$/i.test(pathname);
}

export function mountEvidencePage() {
  const existing = document.querySelector(".setu-evidence-root");
  if (existing) return existing;

  document.documentElement.setAttribute("data-setu", "on");
  document.documentElement.setAttribute("data-setu-page", "evidence");
  document.title = "SETU | Evidence Sources";

  let activeSource = "all";
  let selected = SIGNALS.find((signal) => signal.source === "remote") || SIGNALS[0];

  const sourceList = el("div.setu-evidence-source-list");
  const stream = el("div.setu-evidence-stream-list");
  const sourceDescription = el("p.setu-evidence-source-description", {
    text: "Seven independent channels stay separate until their claims are reconciled.",
  });

  let situation;
  let renderStream = () => {};

  const setDetail = (signal) => {
    selected = signal;
    situation?.setSignal(signal);
    renderStream();
  };

  const selectSource = (sourceId) => {
    activeSource = sourceId;
    sourceList.querySelectorAll(".setu-evidence-source").forEach((node) => {
      node.setAttribute("aria-pressed", String(node.dataset.source === activeSource));
    });
    situation?.setActive(activeSource);
    const source = SOURCES.find((item) => item.id === activeSource);
    sourceDescription.textContent = activeSource === "all"
      ? "Seven independent channels stay separate until their claims are reconciled."
      : `${source?.kind || "source"} · ${source?.state || "unknown"}. ${source?.description || ""}`;
    renderStream();
  };

  situation = createSituationBoard(selectSource, setDetail);

  const root = el("div.setu-evidence-root", {}, [
    el("main.setu-evidence-page", {}, [
      el("header.setu-evidence-topbar", {}, [
        el("a.setu-evidence-brand", { href: "/", text: "SETU" }),
        el("div.setu-evidence-context", {}, [
          el("span", { text: "WAYANAD · FIRST 24H" }),
          el("span", { text: "SYNTHETIC DEMO" }),
        ]),
        el("a.setu-evidence-back", { href: "/", text: "BACK TO TWIN" }),
      ]),
      el("section.setu-evidence-hero", {}, [
        el("div", {}, [
          el("h1", {}, ["EVIDENCE", el("br"), "INTAKE"]),
          el("p", { text: "A message is not ground truth. A quiet village is not a safe village. SETU keeps every source attached, shows where it conflicts, and only then lets it change the response." }),
        ]),
        situation.node,
      ]),
      el("section.setu-evidence-story", {}, [
        el("div.setu-evidence-story-copy", {}, [
          el("h2", { text: "FOG BECOMES A DECISION IN THREE MOVES" }),
          el("p", { text: "The interface does not ask an operator to read every report. It surfaces the three changes that actually alter what the district should do next." }),
        ]),
        el("div.setu-evidence-moments", {}, [
          el("article.setu-evidence-moment", { "data-moment": "silence" }, [
            el("div.setu-evidence-moment-visual", { "aria-hidden": "true" }, [el("i"), el("i"), el("i"), el("i"), el("i")]),
            el("span", { text: "01 · SILENCE" }),
            el("strong", { text: "A missing signal can raise risk." }),
            el("p", { text: "The western cluster fading off the network is treated as evidence of absence, not proof of safety." }),
          ]),
          el("article.setu-evidence-moment", { "data-moment": "conflict" }, [
            el("div.setu-evidence-moment-visual", { "aria-hidden": "true" }, [el("i"), el("i"), el("i")]),
            el("span", { text: "02 · CONFLICT" }),
            el("strong", { text: "Repeated does not mean corroborated." }),
            el("p", { text: "Reposts with a shared origin collapse into one claim even when panic makes the volume look convincing." }),
          ]),
          el("article.setu-evidence-moment", { "data-moment": "confirm" }, [
            el("div.setu-evidence-moment-visual", { "aria-hidden": "true" }, [el("i"), el("i"), el("i")]),
            el("span", { text: "03 · CORROBORATE" }),
            el("strong", { text: "One answer can move response." }),
            el("p", { text: "A named callback plus route blockage is strong enough to recalculate access and medical dispatch." }),
          ]),
        ]),
      ]),
      el("section.setu-evidence-workspace", {}, [
        el("div.setu-evidence-stream-head", {}, [
          el("div", {}, [
            el("div.setu-evidence-section-label", { text: "INCOMING LEDGER" }),
            el("h2", { text: "WHAT THE EOC IS HEARING" }),
          ]),
          el("span.setu-evidence-stream-note", { text: "SELECT A ROW TO OPEN ITS RECEIPT" }),
        ]),
        el("div.setu-evidence-source-controls", {}, [
          sourceList,
          sourceDescription,
        ]),
        stream,
      ]),
      el("footer.setu-evidence-footer", {}, [
        el("p", { text: "Evidence stays traceable from source → claim → corroboration → belief → decision." }),
        el("div.setu-evidence-meta-strip", {}, [
          el("span", {}, [el("strong", { text: "432", "data-meta-events": "" }), " demo events"]),
          el("span", {}, [el("strong", { text: "214", "data-meta-settlements": "" }), " settlements"]),
          el("span", {}, [el("strong", { text: "16", "data-meta-assets": "" }), " response assets"]),
          el("span", {}, [el("strong", { text: "NONE", "data-meta-privacy": "" }), " personal data"]),
        ]),
        el("div.setu-evidence-footer-next", {}, [
          el("p", { "data-evidence-disclosure": "", text: "Demonstration package. Evidence shown here is synthetic and exists to demonstrate the information-fog workflow." }),
          el("a", { href: "/projects", text: "NEXT · VALIDATOR" }),
        ]),
      ]),
    ]),
  ]);

  renderStream = () => {
    const visible = SIGNALS.filter((signal) => activeSource === "all" || signal.source === activeSource);
    if (!visible.some((signal) => signal.id === selected.id) && visible[0]) selected = visible[0];
    situation?.setSignal(selected);
    stream.replaceChildren(...visible.map((signal) => {
      const source = sourceFor(signal.source);
      const meta = metaFor(signal);
      const expanded = signal.id === selected.id;
      return el("article.setu-evidence-entry", { "data-expanded": String(expanded) }, [
        el("button.setu-evidence-row", {
          type: "button",
          "data-signal": signal.id,
          "aria-expanded": String(expanded),
          onclick: () => setDetail(signal),
        }, [
          el("span.setu-evidence-time", { text: signal.time }),
          el("span.setu-evidence-row-source", {}, [sourceMark(source), el("span", { text: source.name })]),
          el("span.setu-evidence-row-copy", {}, [
            el("strong", { text: signal.summary }),
            el("small", { text: `${meta.evidence} · ${meta.location}` }),
          ]),
          el("span.setu-evidence-state", { text: signal.state }),
          el("span.setu-evidence-disclosure", { "aria-hidden": "true", text: expanded ? "−" : "+" }),
        ]),
        expanded ? createInlineDetail(signal) : null,
      ]);
    }));
  };

  const filterRows = [{ id: "all", code: "∑", name: "All sources", kind: "combined ledger", state: "432 events" }, ...SOURCES];
  for (const source of filterRows) {
    const button = el("button.setu-evidence-source", {
      type: "button",
      "aria-pressed": source.id === activeSource ? "true" : "false",
      onclick: () => selectSource(source.id),
      "data-source": source.id,
    }, [
      sourceMark(source),
      el("span", {}, [el("strong", { text: source.name })]),
    ]);
    sourceList.append(button);
  }

  renderStream();
  situation.setActive(activeSource);
  situation.setSignal(selected);
  document.body.append(root);
  hydratePackageMeta(root);
  return root;
}

export function installEvidenceRouteBridge() {
  if (window.__setuEvidenceRouteBridge) return;
  window.__setuEvidenceRouteBridge = true;

  const reconcile = () => {
    if (isEvidenceRoute()) {
      mountEvidencePage();
      return;
    }
    if (document.querySelector(".setu-evidence-root")) window.location.reload();
  };

  document.addEventListener("click", (event) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    try {
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || !isEvidenceRoute(url.pathname)) return;
      event.preventDefault();
      window.location.assign("/about");
    } catch {
      // Ignore malformed or non-standard hrefs owned by the captured shell.
    }
  }, true);

  for (const method of ["pushState", "replaceState"]) {
    const original = history[method].bind(history);
    history[method] = (...args) => {
      const result = original(...args);
      queueMicrotask(reconcile);
      return result;
    };
  }
  window.addEventListener("popstate", reconcile);
}
