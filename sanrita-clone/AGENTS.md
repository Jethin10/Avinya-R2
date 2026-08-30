# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

SETU integration direction: preserve the captured site's pale/white canvas when entering state and district views. The operational layer should feel embedded in the existing San Rita visual system rather than switching to a separate dark/terrain-grey theme. State geometry may use a restrained cool-blue-to-warm-severity accent, and state interactions must stay smooth on complex/high-district-count boundaries.

SETU copy direction: every visible label must describe the disaster-response product, never the captured studio/portfolio. Prefer short operational language around reports, silence, risk belief, verification, dispatch, evidence, and the district twin. Keep the tone premium and calm rather than developer-facing or generic SaaS copy.

SETU district-story direction: the district twin is one continuous five-lens operational story — Information Fog → Risk Belief → Response Plan → Verify Next → Proof. Preserve the San Rita shell and keep the 3D terrain as the hero while the left rail, terrain emphasis, right dossier, and bottom controls change together with the selected lens. The right side is one contextual dossier, not a stack of dashboard cards. Historical replay must never fabricate evidence rows, verification success, or live operator actions that were not baked into the replay. Motion should explain causal changes such as a dispatch route becoming active, a block becoming the focus, or a verification return changing belief.

SETU demo direction: every operational backend capability needs a discoverable frontend path. Keep infrequent live controls in one command console opened from the source status, and use that console as the guided demo index so scenario control, ingest, stress tests, human authority, and exports do not clutter the five-lens terrain story.

SETU evidence/validator direction: keep evidence intake and source validation on a tighter product canvas instead of stretching across ultra-wide screens. Small operational text must remain comfortably readable, with Apple/Linear-like system typography, restrained soft surfaces, clear hierarchy, and visual state changes that communicate admit/verify/hold, confidence, source selection, and routing without requiring the operator to read every line. Preserve the oversized condensed hero language as the bridge back to the main SETU story.

SETU evidence-media direction: every evidence source channel should use a real, high-quality source-specific photograph or sensing image in its capture surface (field responders, satellite-phone use, disaster social media, newsroom, telecom failure, remote sensing, weather instrumentation). Keep imagery locally bundled, darkened/desaturated into the SETU operational palette, and dynamically switched with the active source; never fall back to blank or synthetic placeholder visuals for these channels.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
