const OPERATIONAL_HOTSPOTS = Object.freeze({
  about: "EVIDENCE",
  project: "VALIDATION",
  projects: "VALIDATION",
  playground: "INFERENCE",
  contact: "ACTION",
});

const OPERATIONAL_MENU_ORDER = Object.freeze([
  /\/(?:en|fr)?\/?$/i,
  /\/(?:en|fr)\/about\/?$/i,
  /\/(?:en|fr)\/projects\/?$/i,
  /\/(?:en|fr)\/(?:playground|infer|inference)\/?$/i,
  /\/(?:en|fr)\/(?:contact|act|action)\/?$/i,
]);

let installed = false;

export function installOperationalHotspotLabels() {
  if (installed || typeof document === "undefined") return;
  installed = true;

  const label = document.createElement("div");
  label.className = "setu-terrain-hotspot-label";
  label.setAttribute("aria-hidden", "true");
  document.body.append(label);

  let pointerX = 0;
  let pointerY = 0;

  const render = () => {
    const key = document.body.dataset.setuHotspot ?? "";
    const text = OPERATIONAL_HOTSPOTS[key];
    if (!text) {
      label.dataset.visible = "false";
      return;
    }

    label.textContent = text;
    label.style.setProperty("--setu-hotspot-x", `${pointerX}px`);
    label.style.setProperty("--setu-hotspot-y", `${pointerY}px`);
    label.dataset.visible = "true";
  };

  window.addEventListener(
    "pointermove",
    event => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      render();
    },
    { passive: true },
  );

  const observer = new MutationObserver(render);
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-setu-hotspot"],
  });

  const reorderMenus = () => {
    for (const menu of document.querySelectorAll(".c-icons")) {
      const anchors = [...menu.querySelectorAll(":scope > a[href]")];
      if (anchors.length < 5) continue;

      const ordered = OPERATIONAL_MENU_ORDER.map((pattern) =>
        anchors.find((anchor) => pattern.test(anchor.getAttribute("href") ?? "")),
      );
      if (ordered.some((anchor) => !anchor)) continue;
      ordered.forEach((anchor, index) => {
        anchor.style.order = `${index}`;
      });
      for (const anchor of anchors) {
        if (!ordered.includes(anchor)) anchor.style.order = "99";
      }
    }
  };

  reorderMenus();
  const menuObserver = new MutationObserver(reorderMenus);
  menuObserver.observe(document.body, { childList: true, subtree: true });
}

installOperationalHotspotLabels();
