# San Rita `/en` clone — design QA

## Evidence

- Source visual truth: `C:/avinyar2/tmp/sanrita-clone/source-desktop-1280.png`
- Desktop implementation: `C:/avinyar2/tmp/sanrita-clone/clone-desktop-1280-matched.png`
- Desktop combined comparison: `C:/avinyar2/tmp/sanrita-clone/comparison-desktop.png`
- Mobile source: `C:/avinyar2/tmp/sanrita-clone/source-desktop-matched.png`
- Mobile implementation: `C:/avinyar2/tmp/sanrita-clone/clone-mobile-ready-matched.png`
- Mobile combined comparison: `C:/avinyar2/tmp/sanrita-clone/comparison-mobile.png`
- Project-card state: `C:/avinyar2/tmp/sanrita-clone/clone-project-open-1280.png`
- Mobile drawer state: `C:/avinyar2/tmp/sanrita-clone/clone-mobile-menu-matched.png`

## Normalization

- Desktop source and implementation: 1280 × 720 CSS px, device density 1, 1280 × 720 PNGs.
- Mobile source: 390 × 844 CSS px and PNG.
- Mobile implementation: 390 × 843 CSS px; the browser capture omitted one right-edge pixel and emitted a 389 × 843 PNG. The comparison is aligned at the top-left without scaling; the missing raster edge does not affect authored layout.
- State: settled `/en` map scene, trails hidden, featured project card collapsed unless otherwise named.

## Findings

- No actionable P0, P1, or P2 differences remain.
- Fonts and typography: exact production F37 Stout and Centra Mono files are used; headline, navigation, labels, letter spacing, weights, and wrapping match.
- Spacing and layout: desktop frame, left rail, map crop, project card, guide lines, mobile header, and mobile map crop match the source at equivalent states.
- Colors and visual tokens: production stylesheets and textures are unchanged; terrain, icy background, forest-green ink, and fluorescent trail colors match.
- Image and asset fidelity: the original GLB map, KTX2 textures, HDR environment, topology art, project images, fonts, icons, and production raster assets are local. No replacement or generated artwork is used.
- Copy/content: source copy is unchanged.
- Interaction states: the WebGL intro, map camera, zoom controls, project-card expansion, trails drawer, desktop navigation rail, and mobile drawer were exercised locally.
- Console: no errors or warnings on the normalized desktop run. Mobile WebGL emitted only a GPU shader precision warning from the original Three.js shader; it produced no visible defect.

## Focused comparisons

- Desktop navigation, display headline, map crop, featured card, and bottom/side margin furniture were readable in the full 1280 × 720 comparison, so no additional crop was needed.
- The expanded project card was checked separately and retains the original transition, typography, imagery, and CTA treatment.
- The mobile header and trails drawer were checked separately at the 390 px breakpoint.

## Comparison history

1. First local pass: blocked. The browser-saved archive contained an already-running clock value, producing React hydration error #418.
2. Fix: used the clean server-rendered `/en` HTML as the hydration source while retaining the downloaded local production asset bundle. Analytics and browser-extension capture shims were removed; asset URLs were localized.
3. Second pass: desktop and mobile rendered without hydration errors. Full-view and focused interaction comparisons found no P0/P1/P2 mismatch.

## Follow-up polish

- P3: animated clock values and WebGL camera easing naturally differ between screenshots captured at different elapsed times.
- P3: exact 390 × 844 raster output depends on the in-app browser's viewport scaling; CSS viewport behavior matches.

## Verification

- `npm run build`: passed.
- `npm run test:sites`: 4/4 passed.
- Local preview: `http://127.0.0.1:4173/en`

## SETU district inspection

- Reference state overview: `C:/Users/jethi/OneDrive/Documents/JetSnap/Screenshots/2026-08/brave_HS4SvCl9Fx.png`
- Final Assam → Golaghat inspection: `C:/avinyar2/qa-final/setu-assam-golaghat-final.png`
- Side-by-side state/inspection comparison: `C:/avinyar2/qa-final/setu-reference-vs-golaghat.png`
- Mobile district inspection: `C:/avinyar2/qa-final/setu-assam-golaghat-mobile.png`
- Desktop behavior at 1664 × 928: clicking Golaghat keeps `data-setu-scene="state"`, changes the summary to district mode, keeps the India / Assam / Golaghat breadcrumb, lowers the surrounding districts and leaves Golaghat as the relief focus.
- The district dossier exposes sourced incident status, threat belief, failure mode, affected population, district profile, river/flood signal and the PS operational coverage boundary. Regional-only Assam districts explicitly mark M1–M4 village systems as unavailable instead of fabricating settlement evidence.
- Full-twin districts expose the existing engine-backed information-fog, belief, Value-of-Information verification, dispatch/routing, cascade, reachability, calibration, equity, robustness, audit and provenance surfaces before the operator explicitly enters village operations.
- Mobile behavior at 390 × 844: no horizontal document overflow; the district dossier remains inside a 366 px panel and can be vertically inspected while the selected map geometry stays behind it.
- Captured-shell console noise still includes the pre-existing React hydration warning and non-HTTP captured-asset failures; the SETU district interaction produced no new application exception during QA.
- `npm run test:sites`: 4/4 passed.
- Backend `uv run --extra test pytest -q`: passed after routing generated replay copies through the existing atomic `_write` helper, removing the Windows repeated-copy failure in historical package regeneration.

## SETU historical replay interaction pass — 2026-08-30

- Source visual truth: `C:/Users/jethi/OneDrive/Documents/JetSnap/Screenshots/2026-08/brave_YFZr1UfwKq.png` (1910 × 1066 px).
- Target state: command console opened from a state/district selection, then a full district replay opened and driven through the five-step story plus play/pause/reset.
- Implementation screenshot: blocked. Browser Harness reached Chrome but Chrome requires the user to approve the one-time `Allow remote debugging` permission before the real UI can be interacted with or captured.
- Browser-rendered viewport: blocked for the same reason; no substitute screenshot is being treated as browser evidence.
- Primary interactions pending browser evidence: regional-only district story rejection, full-twin transition, deterministic historical checkpoints, replay play/pause/reset, and semantic camera focus for fog → belief → dispatch → verify → proof.
- Code/build verification completed: `node --check src/setu/main.js`, `node --check src/setu/panels.js`, `npm run build`, `npm run test:sites`, and `git diff --check` all pass.
- Replay checkpoint logic was exercised against all three historical Wayanad bundles. The authored checkpoints are monotonic and deterministic: Meppadi 2024 `0 → 3 → 4 → 5 → 8`, Wayanad 2018 `0 → 2 → 4 → 5 → 8`, and Wayanad 2019 `0 → 1 → 2 → 3 → 8`.
- Comparison history: the original console screenshot exposed a context/action mismatch; the implementation now scopes scenarios to the selected district, refuses regional-only story actions, seeks each historical story step to a meaningful recorded frame, focuses the camera on the actual operational subject, and exposes replay frame/play state in the console status.

final result: blocked
