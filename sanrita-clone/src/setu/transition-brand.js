let installed = false;

function brandOverlay(root = document) {
  const overlays = root.querySelectorAll?.(".c-preload-overlay") ?? [];
  for (const overlay of overlays) {
    const capturedLogo = overlay.querySelector("svg");
    if (capturedLogo) capturedLogo.style.display = "none";

    let wordmark = overlay.querySelector(".setu-transition-wordmark");
    if (!wordmark) {
      wordmark = document.createElement("span");
      wordmark.className = "setu-transition-wordmark";
      wordmark.textContent = "SETU";
      wordmark.setAttribute("aria-hidden", "true");
      overlay.append(wordmark);
    }
  }
}

export function installTransitionBrand() {
  if (installed || typeof document === "undefined") return;
  installed = true;

  brandOverlay();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(".c-preload-overlay") || node.querySelector(".c-preload-overlay")) {
          brandOverlay(node.matches(".c-preload-overlay") ? node.parentElement ?? document : node);
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

installTransitionBrand();
