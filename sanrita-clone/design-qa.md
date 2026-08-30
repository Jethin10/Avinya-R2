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

final result: passed
