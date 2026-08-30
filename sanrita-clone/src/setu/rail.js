/**
 * The nav rail: the site's own list of links, with places in it.
 *
 * San Rita's aside lists map / projects / about / playground / contact. This layer replaces that
 * list with the states the atlas covers, because on this site those *are* the sections - there is
 * nowhere else to go. The original anchors are hidden by the stylesheet rather than removed, and our
 * rows are built from the captured markup's own class nesting, so they inherit the site's hover, its
 * mono type, and the scroll transform the aside applies to its children.
 *
 * A state's glyph is its own boundary. Every row also carries a count of how many districts inside
 * it the engine can actually speak for, which for seven of the eight states is zero and is written
 * as zero.
 */

import { el, keepInside, navRow, outlineGlyph } from "./dom.js";

const LENSES = [
  ["fog", "Information fog"],
  ["belief", "Risk belief"],
  ["response", "Response plan"],
  ["verify", "Verify next"],
  ["proof", "Proof"],
];

function stepGlyph(index) {
  return el("span.setu-step-glyph", { text: String(index + 1).padStart(2, "0") });
}

function blockGlyph() {
  return el("span.setu-block-glyph", { "aria-hidden": "true" });
}

export function createRail({ states, onSelectState, onSelectLens, onSelectBlock, heading = "SETU · DISTRICT TWIN" }) {
  // The captured site renders more than one `.c-icons` list (including a top/mobile navigation
  // copy). SETU's geographic rail belongs specifically to the desktop aside; mounting into the
  // first match can put the state links inside an invisible/pointer-disabled navigation overlay.
  const container = document.querySelector("aside .c-icons");
  if (!container) return null;

  const rows = new Map();
  const lensRows = new Map();
  const rail = el("div.setu-rail", { style: { display: "contents" } });
  const geoRail = el("div.setu-rail-geo", { style: { display: "contents" } });
  const storyRail = el("div.setu-rail-story", { style: { display: "none" } });

  for (const state of states) {
    const anchor = navRow({
      label: state.name,
      glyph: outlineGlyph(state.rings),
      onSelect: () => onSelectState?.(state),
    });
    // The site's own anchors are direct children of .c-icons and its `*:py-[6px]` spacing keys off
    // that, so `display: contents` on our wrapper puts ours in the same flow rather than nesting
    // them one level deeper where the spacing would not reach.
    anchor.classList.add("setu-nav-row");
    anchor.dataset.state = state.id;
    if (state.live_district_count) anchor.dataset.live = String(state.live_district_count);
    geoRail.append(anchor);
    rows.set(state.id, anchor);
  }

  LENSES.forEach(([id, label], index) => {
    const anchor = navRow({
      label,
      glyph: stepGlyph(index),
      onSelect: () => onSelectLens?.(id),
    });
    anchor.dataset.lens = id;
    storyRail.append(anchor);
    lensRows.set(id, anchor);
  });

  const blockDivider = el("div.setu-rail-divider", { text: "BLOCKS" });
  const blockRail = el("div.setu-block-rail");
  storyRail.append(blockDivider, blockRail);
  rail.append(geoRail, storyRail);

  const dispose = keepInside(container, rail);

  // The aside's heading names the section. Ours names what the section became; the original is left
  // in the DOM and hidden, because React put it there and will want it back.
  const original = document.querySelector("aside > h2");
  let headingNode = null;
  const renderHeading = (text) => {
    if (!headingNode) return;
    const [brand = "SETU", ...descriptorParts] = String(text).split("·");
    const descriptor = descriptorParts.join("·").trim() || "DISTRICT TWIN";
    headingNode.replaceChildren(
      el("span.setu-heading__brand", { text: brand.trim() || "SETU" }),
      el("span.setu-heading__descriptor", { text: descriptor }),
    );
    headingNode.setAttribute("aria-label", String(text));
  };
  if (original) {
    headingNode = el("h2.setu-heading", { class: original.className });
    renderHeading(heading);
    keepInside(original.parentNode, headingNode, { before: original.nextSibling });
  }

  return {
    rail,
    rows,
    /** Mark which state is being looked at, in the same way the site marks its current page. */
    setActive(stateId) {
      geoRail.style.display = "contents";
      storyRail.style.display = "none";
      renderHeading("SETU · DISTRICT TWIN");
      for (const [id, anchor] of rows) {
        if (id === stateId) anchor.dataset.active = "true";
        else delete anchor.dataset.active;
      }
    },
    setDistrict(districtName, blocks = [], lens = "fog") {
      geoRail.style.display = "none";
      storyRail.style.display = "block";
      renderHeading(`SETU · ${districtName || "DISTRICT"}`);
      for (const [, anchor] of rows) delete anchor.dataset.active;
      for (const [id, anchor] of lensRows) {
        if (id === lens) anchor.dataset.active = "true";
        else delete anchor.dataset.active;
      }
      blockRail.replaceChildren();
      for (const block of blocks) {
        const anchor = navRow({
          label: block,
          glyph: blockGlyph(),
          onSelect: () => onSelectBlock?.(block),
        });
        anchor.classList.add("setu-block-row");
        blockRail.append(anchor);
      }
    },
    setLens(lens) {
      for (const [id, anchor] of lensRows) {
        if (id === lens) anchor.dataset.active = "true";
        else delete anchor.dataset.active;
      }
    },
    setHeading(text) {
      renderHeading(text);
    },
    dispose,
  };
}
