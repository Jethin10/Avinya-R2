/**
 * Living inside someone else's React tree without fighting it.
 *
 * The clone hydrates the captured Next.js bundle, so React owns every node that arrived in the
 * server HTML and will happily revert anything we mutate. The rules that follow from that, and that
 * this module exists to enforce:
 *
 *   1. We never edit React's nodes. What has to disappear is hidden by a stylesheet rule keyed on
 *      ``html[data-setu="on"]`` - React manages neither stylesheets nor that attribute.
 *   2. Everything we draw lives in containers appended to ``<body>``, which React never created and
 *      so never reconciles away.
 *   3. The one exception is the nav rail, which has to sit inside the site's own ``<aside>`` to
 *      inherit its grid and scroll transform. That node *is* inside React's tree, so it is watched
 *      and re-inserted if a re-render drops it.
 */

/** ``el("div.foo", {...}, children)`` - a tag, optional dotted classes, attributes, children. */
export function el(spec, attributes = {}, children = []) {
  const [tag, ...classes] = spec.split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.className = classes.join(" ");
  for (const [key, value] of Object.entries(attributes)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = `${node.className} ${value}`.trim();
    else if (key === "text") node.textContent = String(value);
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of [children].flat(9)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
  return node;
}

/** The site's own eyebrow type: 10px mono, uppercase, forest green. Used for every label we add. */
export function eyebrow(text, extra = "") {
  return el("div", { class: `text-eyebrow uppercase font-mono ${extra}`.trim(), text });
}

/**
 * Where the SETU layer draws. One container for the WebGL canvas, one for chrome above it.
 *
 * Both are appended to the body rather than into the page's own grid, so their stacking is ours to
 * control and a React re-render cannot orphan them. The canvas host sits below the site's aside
 * (z-20) while the panels sit above it, which is what lets the rail keep its hover states while the
 * map is being flown through underneath.
 */
export function mount() {
  const existing = document.querySelector(".setu-root");
  if (existing) return { root: existing, stage: existing.querySelector(".setu-stage"), chrome: existing.querySelector(".setu-chrome") };
  const stage = el("div.setu-stage", { "aria-hidden": "true" });
  const chrome = el("div.setu-chrome");
  const root = el("div.setu-root", {}, [stage, chrome]);
  document.body.append(root);
  return { root, stage, chrome };
}

/** Turn the SETU layer on. The attribute is the switch every stylesheet rule of ours hangs off. */
export function activate(mode) {
  document.documentElement.setAttribute("data-setu", "on");
  if (mode) document.documentElement.setAttribute("data-setu-mode", mode);
}

export function setScene(name) {
  document.documentElement.setAttribute("data-setu-scene", name);
}

/**
 * Keep a node inside a React-owned parent.
 *
 * Returns a disposer. The observer is cheap - it fires only on childList changes to that one parent
 * - and it is the difference between a rail that survives navigation and one that vanishes the
 * first time the site re-renders its aside.
 */
export function keepInside(parent, node, { before = null } = {}) {
  const insert = () => {
    if (node.parentNode === parent) return;
    if (before && before.parentNode === parent) parent.insertBefore(node, before);
    else parent.append(node);
  };
  insert();
  const observer = new MutationObserver(insert);
  observer.observe(parent, { childList: true });
  return () => observer.disconnect();
}

/**
 * The tiny outline glyph that stands in for a state in the rail.
 *
 * The site's nav icons are hand-drawn marks. Ours cannot be, and inventing an abstract mark per
 * state would be arbitrary, so each state wears its own boundary: the same archived rings the map
 * is built from, decimated to a 20px silhouette. It is the one glyph that is guaranteed to be
 * about the thing it labels.
 */
export function outlineGlyph(rings, size = 20) {
  const points = rings.reduce((longest, ring) => (ring.length > longest.length ? ring : longest), []);
  if (!points.length) return el("svg");
  let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of points) {
    west = Math.min(west, lon); south = Math.min(south, lat);
    east = Math.max(east, lon); north = Math.max(north, lat);
  }
  const span = Math.max(east - west, north - south) || 1;
  const step = Math.max(1, Math.round(points.length / 90));
  const path = points
    .filter((_, index) => index % step === 0)
    .map(([lon, lat], index) => {
      const x = ((lon - west) / span) * size;
      const y = size - ((lat - south) / span) * size;
      return `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join("") + "Z";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "var(--color-forest-green)");
  svg.setAttribute("class", "translate-y-[3px]");
  svg.innerHTML = `<path d="${path}" fill-opacity="0.9"></path>`;
  return svg;
}

/**
 * A nav row in the site's own idiom: the exact class nesting the captured markup uses, so ours
 * inherits the hover, the mono type and the scroll transform rather than approximating them.
 */
export function navRow({ label, glyph, onSelect, active = false }) {
  const anchor = el("a.setu-nav-row", {
    href: "#", "data-active": active ? "true" : null,
    onclick: (event) => { event.preventDefault(); onSelect?.(event); },
  }, [
    el("div", { class: "c-icon || inline-block group uppercase" }, [
      el("div", { class: "relative overflow-hidden before:undefined" }, [
        el("div", { class: "flex items-center gap-12" }, [
          el("div", {}, [glyph]),
          el("div", { class: "w-fit text-forest-green relative text-[12px]", text: label }),
        ]),
      ]),
    ]),
  ]);
  return anchor;
}
