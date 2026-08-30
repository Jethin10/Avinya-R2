# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

SETU integration direction: preserve the captured site's pale/white canvas when entering state and district views. The operational layer should feel embedded in the existing San Rita visual system rather than switching to a separate dark/terrain-grey theme. State geometry may use a restrained cool-blue-to-warm-severity accent, and state interactions must stay smooth on complex/high-district-count boundaries.

SETU copy direction: every visible label must describe the disaster-response product, never the captured studio/portfolio. Prefer short operational language around reports, silence, risk belief, verification, dispatch, evidence, and the district twin. Keep the tone premium and calm rather than developer-facing or generic SaaS copy.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
