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
| `slime-mold.html` | Physarum agents leave a diffusing pheromone trail and steer up its gradient, weaving transport networks. (The original; multi-file.) |
| `boids.html` | Reynolds flocking — separation, alignment, cohesion. |
| `particle-life.html` | Colored species attract/repel by a random matrix; cells and creatures self-assemble. |
| `flow-field.html` | Particles ride a drifting noise field, painting silken streams colored by flow direction. |
| `reaction-diffusion.html` | Gray–Scott two-chemical reaction → Turing patterns (spots, stripes, coral mazes). |
| `gravity.html` | Softened N-body gravity; masses collapse into spinning galaxies. |
| `strange-attractors.html` | Iterate a two-line map (Clifford / De Jong / Svensson / Fractal Dream) into a density field of fractal lace. |

## Running it

Zero dependencies, no build step. Open `index.html` (or any sim page) in a
browser. Everything is self-contained: every sim except slime mold inlines its
own CSS and JS into a single `.html` file. Slime mold is split into
`slime-mold.html` + `slime-mold.css` + `slime-mold.js`.

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

Every sim reuses the same chrome and conventions, so they're built by copying the
nearest existing file and swapping only the simulation core:

- **Chrome.** A full-viewport `<canvas>`; a top-right cogwheel opening a dropdown
  of four glass modals (Color / Shape / Parameters / Settings); a bottom-right FAB
  toolbar (record-to-WebM, share-link, hide-UI, speed ×1–8, reset, pause,
  randomize). Modals are draggable floating windows on desktop and bottom sheets on
  mobile. Press **H** to hide all UI for clean recordings.
- **State.** One `state` object holds `params` / `pattern` / `palette` /
  `settings`. It is persisted to localStorage and base64-JSON-encoded into the URL
  hash for share links. `defaultState` backs "Restore defaults". A returning
  visitor's saved state overrides the code defaults.
- **Enumerations.** Each set of options (palettes, shapes, …) lives in one ordered
  `registry()` of `{ id, label, ...metadata }` descriptors. The sim branches on
  `.id`; the UI renders `.label` (the only field copy edits touch);
  `registry.byId()` resolves a stored id with a safe fallback.
- **Color.** A 5-stop palette is expanded into a 256-entry lookup table; presets
  plus custom hue / accent / saturation sliders. Grid sims map field values through
  the LUT into a canvas `ImageData`; particle sims color dots/triangles by a derived
  quantity (speed, heading, species, phase).
- **Particle sims** (boids, particle-life, flow-field, gravity) share density
  scaling (the count is a per-reference-screen target × a Settings multiplier, so
  small screens run proportionally fewer), a toroidal world, and center-anchored
  zoom. **Grid sims** (reaction-diffusion, strange-attractors)
  render a small offscreen grid scaled up via `drawImage`, and Settings offers
  Resolution + a brush instead of count/density.

## Notes for contributors

- **Verify in a real browser.** The modals are built by JS at runtime, so static
  preview tools that don't execute scripts show them empty.
- **Keep user-facing copy non-technical** — favor the playful "critters / ants /
  masses" mental model over agent / sensor / pheromone / kernel in anything the user
  reads.
- The biggest wart is duplication: the `<style>` block and chrome markup are copied
  near-verbatim across the single-file sims. A shared `shell.css` / shell builder is
  the obvious next refactor.
