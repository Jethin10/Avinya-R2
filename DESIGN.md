# SETU — Design System

**Direction:** Apple's *pro* tools, not Apple's consumer apps.
Reference set: **Final Cut Pro, Logic Pro, Xcode Instruments, Apple Watch, Maps at night,
Weather, Crash Detection / Emergency SOS.**

> Premium, in a tool someone uses at 03:00 in a dim room, is **restraint and hierarchy** —
> not decoration. Three principles govern everything below:
>
> 1. **Saturation is a scarce resource.** Only the worst thing on screen is fully saturated.
> 2. **Numbers must never jitter.** Tabular figures everywhere, always.
> 3. **Uncertainty is designed, not omitted.** "We don't know" gets as much care as "we know."

---

## 1. Commitments (decide once, never revisit)

| Decision | Choice | Why |
|---|---|---|
| Theme | **Dark only** | The tool is used at night, in a dim EOC, often projected. Apple would commit rather than ship a half-considered light mode. Building both doubles QA and halves polish |
| Density | **Dense, pro-app** | This is Instruments, not Notes. Information density *is* the respect you show the operator |
| Accent colours | **Exactly one** (`--accent`) | Interaction and selection only. Never severity |
| Icon set | **Lucide** (ISC), 1.5 px stroke, 20 px | SF Symbols are not licensable off-platform. One set, one weight, one size |
| Typeface | **Inter** (SIL OFL) | The standard SF Pro substitute. Variable, has real tabular figures |
| Mono | **IBM Plex Mono** or **JetBrains Mono** | IDs, coordinates, log lines only |
| Motion | Ease-out, never bounce | Springs that overshoot read as playful. Wrong register entirely |

---

## 2. Colour

### 2.1 Tokens

```css
:root {
  /* Ground — near-black with a slight cool cast, never #000 except OLED accents */
  --bg-base:        #0A0B0D;
  --bg-surface:     #141619;
  --bg-raised:      #1C1F23;
  --bg-overlay:     rgba(20, 22, 25, 0.72);   /* pairs with backdrop-filter */

  /* Hairlines — never borders where spacing will do */
  --line:           rgba(255, 255, 255, 0.08);
  --line-strong:    rgba(255, 255, 255, 0.14);

  /* Text */
  --text-primary:   #F5F6F7;
  --text-secondary: rgba(245, 246, 247, 0.62);
  --text-tertiary:  rgba(245, 246, 247, 0.38);
  --text-disabled:  rgba(245, 246, 247, 0.22);

  /* The single accent — interaction and selection ONLY */
  --accent:         #0A84FF;
  --accent-dim:     rgba(10, 132, 255, 0.16);

  /* Severity ramp — neutral -> amber -> red.
     Note saturation climbs monotonically. Only CATASTROPHIC is fully saturated. */
  --sev-none:       #3E444C;
  --sev-minor:      #6E6A4E;
  --sev-moderate:   #C08A2E;
  --sev-severe:     #E0662F;
  --sev-catastroph: #FF3B30;

  /* Water */
  --water-fill:     rgba(46, 111, 168, 0.42);
  --water-edge:     #6FB4E8;   /* the shoreline hairline — see §6.3 */

  /* State */
  --ok:             #30D158;
  --warn:           #FFD60A;
  --danger:         #FF453A;
}
```

### 2.2 The rules that matter

- **Severity never uses blue.** Blue is the accent and the water. Collision here is the most common
  way a data UI turns to mud.
- **Only `--sev-catastroph` is fully saturated.** Everything below it recedes. If half the map is red,
  nothing is red. Restraint is what makes the seven catastrophic settlements *findable*.
- **Confidence is encoded as opacity and texture, never as hue.**
  `P ≥ 0.8` → solid fill. `0.4–0.8` → 62% opacity. `< 0.4` → 38% opacity + **1px dashed outline**.
  A judge sees instantly which calls are firm and which are inferred. This is the most important
  single rule in this document — it is how the interface refuses to lie about certainty.
- **Never** use colour as the sole carrier of meaning. Severity always ships with a text label too.

---

## 3. Type

### 3.1 Scale

| Role | Size / Line | Weight | Tracking | Use |
|---|---|---|---|---|
| Display | 34 / 40 | 600 | −0.4 | The one number that matters (lives at risk) |
| Title | 22 / 28 | 600 | −0.2 | Panel headers |
| Headline | 17 / 22 | 600 | −0.1 | Settlement names, row leads |
| Body | 15 / 20 | 400 | 0 | Prose, evidence receipts |
| Caption | 13 / 16 | 400 | 0 | Secondary metadata |
| Micro | 11 / 14 | 500 | +0.4 | UPPERCASE column labels, chips |
| Mono | 13 / 18 | 400 | 0 | IDs, coordinates, log lines |

### 3.2 The non-negotiable

```css
/* Every element containing a number. No exceptions. */
font-variant-numeric: tabular-nums;
font-feature-settings: 'tnum' 1, 'cv05' 1;
```

Without this, a value ticking `0.89 → 0.90` shifts the glyph width and the whole column twitches.
With it, the layout is dead still while the numbers move. **This one line separates a professional
data interface from a hackathon one, and it costs nothing.**

Also:
- Never centre text in a data table. Labels left, numbers **right-aligned**, decimals aligned.
- Uppercase only at Micro size, and only with positive tracking.
- Maximum three weights in the entire app: 400 / 500 / 600. No 700, no 800.

---

## 4. Space, shape, elevation

```css
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;
--space-4: 16px;  --space-5: 24px;  --space-6: 32px;  --space-7: 48px;

--radius-chip:  6px;
--radius-card: 10px;
--radius-panel: 14px;
```

- **4 px base grid.** Every margin, padding and gap is a multiple. No `13px`, no `7px`.
- **Hairlines over borders.** Prefer `--space-*` to separate things. Where a line is genuinely needed,
  it is `1px solid var(--line)` — not a 1px `#333` box.
- **One shadow, used rarely**, only on panels floating over the 3D scene:
  ```css
  box-shadow: 0 12px 32px rgba(0,0,0,0.44), 0 2px 8px rgba(0,0,0,0.32);
  ```
- **Never mix corner radii within a component.** A card at 10 containing a chip at 6 is correct;
  two cards at 10 and 12 is not.

### The one CSS property that does the most work

```css
.panel-over-map {
  background: var(--bg-overlay);
  backdrop-filter: blur(24px) saturate(140%);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
}
```

Translucent, blurred panels over a live 3D scene is *the* Apple material. One declaration,
enormous perceived-quality return. Use it for the dispatch panel, the evidence receipt, and the
timeline chrome — and nowhere else, or it stops meaning anything.

---

## 5. Motion

```css
--ease-out:   cubic-bezier(0.32, 0.72, 0, 1);   /* the iOS decelerate curve */
--ease-inout: cubic-bezier(0.65, 0, 0.35, 1);

--dur-micro:  180ms;   /* hover, focus, chip states     */
--dur-ui:     320ms;   /* panels, list reorder, filters */
--dur-camera: 1200ms;  /* map fly-to                    */
--dur-extrude: 850ms;  /* buildings rising              */
```

**Rules:**

1. **Nothing bounces.** No overshoot, no spring, no `cubic-bezier` with a negative control point.
   Overshoot reads as playful; this product is not playful.
2. **Every value that changes, transitions.** Including numbers — animate the count, don't swap it.
3. **Never snap the camera.** All `easeTo` / `flyTo` at `--dur-camera` with `curve: 1.42`.
4. **List reordering animates.** When the dispatch queue re-ranks, rows *move* to their new position.
   Watching Bhimsar climb past Kolang is the argument — a hard cut destroys it.
5. **Stagger sparingly.** Buildings extrude with ~8 ms per-tile stagger — enough to feel alive,
   not enough to look like a loading animation.
6. Respect `prefers-reduced-motion: reduce` — drop to opacity fades at `--dur-micro`.

---

## 6. The 3D scene — where premium is won or lost

Default MapLibre extrusions look flat and cheap. Four changes fix that, and they are all config.

### 6.1 Lighting

```js
map.setLight({
  anchor:    'map',        // light stays with the world, not the camera
  position:  [1.4, 210, 28],  // low angle -> long, readable shadows
  color:     '#FFF3E0',    // faintly warm
  intensity: 0.42
});
```

A single low-angle, slightly warm light against a cool ground is the entire difference between
"3D bar chart" and "a place." Do this before anything else.

### 6.2 Atmosphere

```js
map.setSky({
  'sky-color':         '#0E1621',
  'horizon-color':     '#1B2735',
  'fog-color':         '#0A0B0D',
  'horizon-fog-blend': 0.6,
  'fog-ground-blend':  0.4
});
```

Distance fade is the cheapest depth cue available and the largest perceived-quality gain per line.

### 6.3 Water

```
fill-extrusion-base:    ground elevation
fill-extrusion-height:  water surface elevation
fill-extrusion-color:   var(--water-fill)
fill-extrusion-opacity: 0.42
```

**Then add the detail that actually sells it:** a 1.5 px `--water-edge` line layer along the
depth = 0 contour. That bright shoreline where water meets terrain is what makes the flood read as a
volume rather than a blue wash. It is one extra layer and it does more than any shader.

### 6.4 Building material

- **Default buildings are near-neutral** — `#3E444C`, barely lighter than terrain.
- **Only damaged buildings take colour**, on the §2.1 severity ramp.
- **Collapsed = `height × 0.4`**, animated over `--dur-ui`, plus a debris footprint at ground level.
  This reads as destruction far better than cracks would, and needs no 3D engine.
- **Do not paint the whole district red.** If 80% of buildings are coloured, the eye finds nothing.
  A neutral field with seven red clusters is legible; a red field is not.

### 6.5 Vertical exaggeration

Real Indian residential stock is 6–15 m. At true scale a district looks flat.

**Use ×2.5, and put `VERTICAL EXAGGERATION ×2.5` in the scene chrome at Micro size.** Standard
dataviz practice; stating it plainly is what makes it rigorous rather than misleading.

---

## 7. Component specs

### 7.1 Dispatch row

```
┌─────────────────────────────────────────────────────────────────┐
│  1   BHIMSAR                    COLLAPSE   0.89      68   ⛏ ✚  │   ← 56px, 4px accent
│      Kolang block · 2,140                                       │      bar when selected
└─────────────────────────────────────────────────────────────────┘
```

- Height 56 px. Rank in Mono/tertiary. Name in Headline. Block + population in Caption/secondary.
- Severity as a **Micro uppercase chip**, background `--sev-*` at 18% alpha, text at full `--sev-*`.
- Confidence and harm right-aligned, tabular.
- Selected state: `--bg-raised` + a 4 px `--accent` bar on the leading edge. **No glow, no border.**
- Hover: background lifts to `--bg-raised` at 60%. That is all.

### 7.2 Evidence receipt

Slides in from the right over the scene, on the blur material (§4). This is the most important panel
in the product — it is the audit trail — so it gets the most typographic care:

- Prior, then each evidence line as a row: `timestamp · channel · description · LR · Δlog-odds`
- **Δ values right-aligned, tabular, signed**, coloured `--ok` / `--danger` at *low* saturation
- The discounted contradiction stays visible at `--text-tertiary` with a strikethrough on its LR.
  **Showing the evidence you dismissed, and why, is the whole credibility argument.** Never hide it.
- Posterior on its own row, hairline above, Title size.

### 7.3 Timeline

Full-bleed at the bottom, 64 px, on the blur material. Event markers as 2 px ticks. The scrub head is
a 3 px `--accent` line with a 12 px dot. Current timestamp in Mono, tabular, above the head.
**No skeuomorphic knob.**

### 7.4 The unknown state — treat as a first-class design problem

```
┌──────────────────────────────────────┐
│  NO USABLE SIGNAL              26    │
│  Insufficient observability for a    │
│  severity estimate. Queued for       │
│  verification.               [VIEW]  │
└──────────────────────────────────────┘
```

Dashed 1 px `--line-strong`, text at `--text-secondary`, no severity colour at all. Every other
dashboard projects false completeness. Designing this state deliberately — and giving it a route into
the verification queue — is the most on-brand thing in this document.

---

## 8. Tells of a hackathon UI — banned

- Bootstrap or Material default components, unmodified
- Purple→blue gradients anywhere
- Emoji used as interface icons (fine in exported text and printed sheets, never in the chrome)
- Drop shadows on non-floating elements
- More than one accent colour
- Centred text in data tables
- Mixed corner radii or mixed icon stroke weights
- Heavy-bordered "glassmorphism" cards
- Rainbow / spectral severity ramps
- Loading spinners — use skeleton rows on `--bg-raised` instead
- Any number rendered without `tabular-nums`

---

## 9. The five details that read as expensive and cost almost nothing

1. **`tabular-nums` on every number.** One CSS line. Biggest single win in the entire document.
2. **`backdrop-filter: blur(24px) saturate(140%)`** on panels over the scene. One declaration.
3. **Low-angle warm `setLight` + `setSky` fog** on the 3D scene. Six lines of config.
4. **Animated list reordering** in the dispatch queue. The argument becomes visible motion.
5. **A designed empty/unknown state.** Nobody else will have one.

---

## 10. Implementation order

| Step | Effort | Yield |
|---|---|---|
| 1 | 1 h | Drop in the §2 tokens + Inter with `tnum`. Recolour everything |
| 2 | 1 h | `setLight` + `setSky` on the 3D scene |
| 3 | 2 h | Blur material on the three floating panels |
| 4 | 2 h | Motion tokens; convert all transitions; animate list reorder |
| 5 | 2 h | Confidence-as-opacity encoding + the dashed low-confidence treatment |
| 6 | 1 h | The water shoreline hairline |
| 7 | 2 h | Evidence receipt typography, including the visible discounted evidence |

**~11 hours, one person, no new dependencies.** Do steps 1 and 2 first — together they are about 60%
of the perceived quality gain.

---

*Restraint is the feature. If it looks designed, it is over-designed.*
