# Simulations

A small collection of interactive, browser-based simulations, deployed through
GitHub Pages. Each one is a self-contained page that runs a single rule a few
thousand times until something lifelike emerges — and each can be recolored,
reshaped, tuned, recorded, and shared via a link.

`index.html` is an Apple-style landing page that pitches each sim in a
full-viewport section with a live, dialed-down preview of that algorithm running
behind it.

## The sims

| Page | What it is |
|------|------------|
| `slime-mold.html` | Physarum agents leave a diffusing pheromone trail and steer up its gradient, weaving transport networks. |
| `boids.html` | Reynolds flocking — separation, alignment, cohesion. |
| `particle-life.html` | Colored species attract/repel by a random matrix; cells and creatures self-assemble. |
| `flow-field.html` | Particles ride a drifting noise field, painting silken streams colored by flow direction. |
| `reaction-diffusion.html` | Gray–Scott two-chemical reaction → Turing patterns (spots, stripes, coral mazes). |
| `gravity.html` | An n-body gravity world — every speck pulls on every other (softened inverse-square), and the crowd condenses into glowing clumps, orbits, and spiral whirlpools. |

## Running it

Zero dependencies, no build step — plain files served as-is. Open `index.html`
(or any sim page) in a browser. The chrome is shared: every sim is a thin
`<sim>.html` skeleton (a `<canvas>` plus two `<script>` tags) that loads the
shared `sim-shell.js` + `sim-shell.css` and one `<sim>.sim.js` holding only that
sim's logic. A couple of sims add a small per-sim stylesheet for sim-specific
bits (currently only `particle-life.css`).

## Social preview images

Each page links an Open Graph / Twitter preview image from `og/`, generated
automatically — no manual screenshots. The script runs each sim in your
installed Chrome, hides the on-screen controls, lets it develop, then snapshots
the canvas at 1200×630. The landing page uses a montage of all the thumbnails.

```sh
npm install                              # one-time: installs playwright-core (driver only)
node scripts/capture-og.mjs              # regenerate every preview + montage
node scripts/capture-og.mjs flow-field   # regenerate just one (by file stem)
```

`playwright-core` drives your existing Google Chrome, so there's no large
browser download. Per-sim dwell times (how long a sim runs before the snapshot)
live in the `SIMS` map in the script; bump a value if a slow-forming sim looks
underdeveloped.

The `og:image` paths are relative, which every modern scraper (Twitter/X,
Slack, Discord, LinkedIn) resolves against the page URL. Facebook prefers
absolute URLs — once the site has a fixed domain, prefix the paths with it.

## How a sim is built (the shared shell)

The chrome and all the cross-cutting conventions live once in `sim-shell.js` +
`sim-shell.css`. A sim is just data + a few callbacks registered through a fixed
contract — `SimShell.registerSim({ id, state, defaultState, config, init, step,
render, reset, randomize, refreshPalette, resize, onRestoreDefaults? })`. **The
contract is documented in the comment block at the top of `sim-shell.js`; read it
before adding or editing a sim.** To make a new sim, copy any `<sim>.html`
skeleton and write one `<sim>.sim.js` against that contract (mirror the nearest
analog — a particle sim, or a grid/field sim like `reaction-diffusion`).

- **Chrome (shell-owned).** The shell renders, at runtime, a full-viewport
  `<canvas>`; a top-right cogwheel opening a dropdown of four glass modals (Color /
  Shape / Parameters / Settings); a bottom-right FAB toolbar (record-to-WebM,
  share-link, hide-UI, speed ×1–8, reset, pause, randomize). Modals are draggable
  floating windows on desktop and bottom sheets on mobile. Press **H** to hide all
  UI for clean recordings. The shell also owns the `requestAnimationFrame` loop —
  it calls the sim's `step()` (only while playing, scaled by speed) and `render()`.
- **State.** Each sim supplies one `state` object (`params` / `pattern` /
  `palette` / `settings`); the shell reads and writes it directly, persists it to
  localStorage, and base64-JSON-encodes it into the URL hash for share links, so
  **`state` must stay JSON-serializable** (typed arrays and canvas buffers live as
  module-locals in the sim, never in `state`). `defaultState` backs "Restore
  defaults". A returning visitor's saved state overrides the code defaults.
- **Modals.** `config.modals.color` and `config.modals.params` are required;
  `shape` and `settings` are optional. Optional extension points the shell already
  supports: a gated `regionSlider`, a secondary chip/slider axis (e.g. boids'
  heading), custom color-modal content + legend text, a `segmented` settings
  control, and an `onRestoreDefaults()` hook for grid sims that must reallocate.
- **Enumerations.** Each set of options (palettes, shapes, …) lives in one ordered
  `registry()` of `{ id, label, ...metadata }` descriptors. The sim branches on
  `.id`; the UI renders `.label` (the only field copy edits touch);
  `registry.byId()` resolves a stored id with a safe fallback.
- **Color.** A 5-stop palette is expanded into a 256-entry lookup table; presets
  plus custom hue / accent / saturation sliders. Grid sims map field values through
  the LUT into a canvas `ImageData`; particle sims color dots/triangles by a derived
  quantity (speed, heading, species, phase).
- **Particle sims** (boids, particle-life, flow-field) share density
  scaling (the count is a per-reference-screen target × a Settings multiplier, so
  small screens run proportionally fewer), a toroidal world, and center-anchored
  zoom. **Grid sims** (reaction-diffusion)
  render a small offscreen grid scaled up via `drawImage`, and Settings offers
  Resolution + a brush instead of count/density.

## Discovery Feed (`feed.html`)

`feed.html` is an invisible, chrome-less host (`feed.js`) that turns the sims into
a personal "scroll for fun" feed. It renders the current item in a full-screen
`<iframe src="<sim>.html?feed=1#<recipe>">` and keeps the next draw warm in a
second paused, off-screen iframe (cap: 2 live iframes) so cross-sim draws are a
flash-free hard cut; same-sim draws apply the recipe in place via `postMessage`.
The recipe is the existing share-hash payload (`base64(stateWithoutGlobal())`) —
no new format. Randomize and a new Back FAB forward intent to the host. Taste is
learned passively from dwell / fast-skip (per sim + per param-bucket, in
`localStorage`); a single "Taste influence" slider in Settings linearly blends the
learned draw toward uniform random. All of this lives behind a `?feed=1` flag in
`sim-shell.js`; a sim opened without the flag is unchanged. Per-sim param ranges
are harvested at runtime from each sim's own `modals.params` (reported in its
`ready` message), so they never drift. Tuning constants live in `TUNING` at the
top of `feed.js`.

## Notes for contributors

- **Verify in a real browser.** The chrome and modals are built by JS at runtime,
  so static preview tools that don't execute scripts show them empty. There's no
  test framework — exercise every control by hand after a change.
- **Don't reintroduce chrome into a sim.** Anything generic (modals, toolbar,
  persistence, the rAF loop, the color machinery) belongs in `sim-shell.js`. If a
  sim needs a capability the contract lacks, extend the shell additively and
  document it in the contract block — don't fork the chrome back into the sim.
- **Keep user-facing copy non-technical** — favor the playful "critters / ants /
  masses" mental model over agent / sensor / pheromone / kernel in anything the user
  reads.
- **Known quirk:** `particle-life` keeps a legacy localStorage key
  (`plife-state`), preserved from before the shell extraction. New sims that omit
  `config.keys` get an id-derived namespace automatically.
