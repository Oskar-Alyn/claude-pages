# Sim Shell Refactor — Design

## Goal

Make the vibe-coded sim collection maintainable by killing the duplication across
the 7 monolithic `*.html` files (~3,300 lines each). Stay **build-free**: every sim
remains a static page served by GitHub Pages, just linking shared files. New sims
should be creatable by copying a ~40-line `.html` and filling in one `.sim.js`.

## Approach (A1: render shared chrome in JS, no build step)

The shared "chrome" (menu, FAB toolbar, banners, modal scaffolding) is rendered at
runtime by a shared script, so it lives exactly once. Per-sim variation is expressed
as data + a small module, not copied markup.

## Target layout

```
sim-shell.css            one stylesheet (was copied 7×)
sim-shell.js             renders shared chrome DOM + owns all sim-agnostic logic
particle-life.css        optional per-sim CSS (only sims that need one-offs)
<sim>.html               ~40 lines: <head>, <canvas>, mount point, 2 <script>s
<sim>.sim.js             sim core + this sim's config (palettes, params, simulate, render)
```

## CSS extraction

- The 6 monolithic style blocks are byte-identical after stripping comments, except:
  - `.palette-legend { margin-top }` — values 6/8/14px across sims. **Reconcile to 8px.**
  - `.type-swatches` + `.type-swatches .dot` (~13 lines) exist only in particle-life.
- Move the unified stylesheet to `sim-shell.css`.
- particle-life's one-off rules go in `particle-life.css`, loaded via an optional
  per-sim `<link>`. This is the general escape hatch for future per-sim styles.

## Shared chrome (`sim-shell.js`)

Builds the identical chrome DOM at runtime and owns everything sim-agnostic:
menu open/close, modal open/close + drag, hide-UI, speed, pause/play, reset button,
recording, share-link, and the settings modal (FPS slider, toolbar-visibility toggles).
The shell runs the rAF loop and calls into the sim; sims never wire chrome buttons or
`requestAnimationFrame` themselves.

## Modals (config-driven)

Modal scaffolding (header, title, close, body container, mobile bottom-sheet) is
rendered by the shell. Contents are declared per sim as data, rendered via a small
library of control primitives: **chip-row, slider, toggle, section-with-description**.

- **Color modal** is a shell-provided standard modal: presets + hue/accent/sat custom
  palette machinery (~90% shared today). A sim opts in and feeds its palette stops.
- **Shape modal** and **Params modal** are the most sim-specific; defined per sim via
  the control primitives. Example shape:

```js
modals: {
  color:  { palette: PALETTES, customStops: currentPaletteStops },
  shape:  { title: "Starting shape", chips: PATTERNS, sections: [...] },
  params: { title: "Parameters", controls: [ {type:"slider", key, label, min, max}, ... ] },
}
```

This is the area expected to need iteration during implementation; the control-primitive
set is the contract that keeps it bounded.

## Shell ↔ sim contract

A sim registers a module the shell drives through a fixed interface:

```js
registerSim({
  state,                  // sim's own params
  config: { modals },     // see Modals
  init(ctx),              // ctx = { canvas, getPalette, requestReset, ... }
  reset(),                // re-seed
  randomize(),
  frame(dt),              // simulate + render one step (shell owns the loop)
  refreshPalette(stops),
  resize(rescale),
})
```

## Migration

1. **CSS first**: extract `sim-shell.css`, reconcile the one value, split out
   `particle-life.css`. Point all 7 files at it. Low risk, immediate win.
2. **Reference sim = gravity**: build `sim-shell.js` + the contract by migrating gravity
   end-to-end. Prove it behaves identically.
3. **Roll out** the proven shell to the other five monoliths.
4. **slime-mold last**: it is already split on the *old* coupled structure; re-fit it
   onto the shared shell as a special case.

Each sim is its own verifiable step. The user verifies behavior manually.

## Out of scope

- No build step / toolchain.
- No regression-tooling work (manual verification).
- No unrelated refactors of sim math/rendering.
