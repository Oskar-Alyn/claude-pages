# Sim Shell Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the duplicated CSS/HTML/JS chrome across the 7 monolithic sim pages by extracting a shared, build-free `sim-shell.css` + `sim-shell.js`, leaving each sim as a tiny `.html` + one `.sim.js`.

**Architecture:** Build-free (A1). Shared chrome DOM is rendered at runtime by `sim-shell.js`; per-sim variation is expressed as a config object + a registered sim module driven through a fixed contract. Static-file deployment is unchanged.

**Tech Stack:** Vanilla HTML/CSS/JS, no build step, no test framework. Verification is manual (open the page, exercise every control). GitHub Pages serves the files as-is.

**Task sizing:** Tasks are intentionally coarse — big extraction chunks, not micro-steps. The checkpoints that matter are the **manual verification gates**, placed where a mistake is expensive to unwind: after CSS, a HARD GATE after gravity (it defines the contract every other sim inherits), and a per-sim verify during rollout.

**Reference:** Design spec at `docs/superpowers/specs/2026-06-02-sim-shell-refactor-design.md`.

---

## Task 1: Extract the shared stylesheet

Pure CSS extraction. Body markup and inline `<script>` stay untouched in every file — this task only swaps each `<style>…</style>` block for a `<link>`. Lowest-risk win; do it first and verify before anything else.

**Files:**
- Create: `sim-shell.css`
- Create: `particle-life.css`
- Modify: `boids.html` (style block 35–800), `gravity.html` (35–799), `flow-field.html` (35–778), `particle-life.html` (35–814), `reaction-diffusion.html` (35–776), `strange-attractors.html` (35–776)
- Leave alone: `slime-mold.html` / `slime-mold.css` (handled in Task 4)

- [ ] **Step 1: Create `sim-shell.css` from gravity's stylesheet**

Copy the contents of `gravity.html` lines 36–798 (everything between `<style>` and `</style>`, exclusive) into a new top-level `sim-shell.css`, de-indented to column 0 (match the existing `slime-mold.css` formatting). This is the canonical stylesheet — comment-stripped, the 6 monolith style blocks are identical to it except for the two items below.

- [ ] **Step 2: Reconcile the one value conflict**

In `sim-shell.css`, set `.palette-legend { margin-top: 8px; }` (sims currently use 6px/8px/14px; 8px is the plurality). Verify there is exactly one `margin-top` under `.palette-legend`.

- [ ] **Step 3: Create `particle-life.css` for the one sim-specific block**

`particle-life.html`'s style block contains rules NOT present in the others:

```css
.type-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 8px;
}
.type-swatches .dot {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.18);
    box-shadow: 0 0 8px rgba(0, 0, 0, 0.4);
}
```

Put exactly these rules in a new `particle-life.css`. Do NOT put them in `sim-shell.css`.

- [ ] **Step 4: Repoint all six monolith files at the shared stylesheet**

In each of the six files, replace the entire `<style>…</style>` block with:

```html
<link rel="stylesheet" href="sim-shell.css" />
```

For `particle-life.html` only, add a second line immediately after:

```html
<link rel="stylesheet" href="particle-life.css" />
```

- [ ] **Step 5: Verify (manual gate)**

Open all six pages in a browser. Confirm each renders pixel-identically to before — open the color/shape/params/settings modals, check the palette legend spacing, and confirm particle-life's type swatches still look right. The only intended visual change is the palette-legend margin on boids (6→8px) and gravity/particle-life (14→8px), which should be imperceptible.

- [ ] **Step 6: Commit**

```bash
git add sim-shell.css particle-life.css boids.html gravity.html flow-field.html particle-life.html reaction-diffusion.html strange-attractors.html
git commit -m "Extract shared sim-shell.css from the monolithic sims"
```

---

## Task 2: Build `sim-shell.js` + the contract, migrate gravity (HARD GATE)

This is the load-bearing task. It invents the shell↔sim contract that all six remaining sims inherit, so it gets done in one focused pass on a single sim (gravity) and is fully verified before any rollout. Do not start Task 3 until gravity behaves identically.

**Files:**
- Create: `sim-shell.js`
- Create: `gravity.sim.js`
- Modify: `gravity.html` (collapse body chrome + inline `<script>` at 1428)

- [ ] **Step 1: Split gravity's inline JS into shell-owned vs sim-owned**

Read gravity's inline `<script>` (starts line 1428). Classify every function/handler into two buckets:

- **Shell-owned (sim-agnostic):** menu open/close, modal open/close + header-drag, FAB toolbar (record/share/hide/speed/pause/reset wiring), recording, share-link, hide-UI, settings modal (FPS slider + toolbar-visibility toggles), the rAF loop + speed/pause control, canvas resize plumbing.
- **Sim-owned:** `PALETTES`/`PATTERNS`/headings registries, palette LUT + `refreshPalette`, `seed*`/`reset*`/`randomize`, `simulate`, `render`, the gravity `state` params, and the shape/params modal *contents*.

- [ ] **Step 2: Create `sim-shell.js`**

`sim-shell.js` renders the shared chrome DOM at runtime (canvas overlay menu, FAB toolbar, recording indicator, hide banner, and the modal scaffolding: header/title/close/body container + mobile bottom-sheet). Move all shell-owned logic here. It exposes a single global entry point and a small control-primitive renderer:

```js
// sim-shell.js  (sketch of the public surface; full chrome impl moves in from gravity)
const SimShell = (() => {
  // control primitives the modals are built from
  function chipRow({ chips, value, onSelect }) { /* ... */ }
  function slider({ key, label, min, max, step, value, onInput }) { /* ... */ }
  function toggle({ key, label, value, onChange }) { /* ... */ }
  function section({ title, description, children }) { /* ... */ }

  // standard color modal: presets + hue/accent/sat custom palette
  function renderColorModal(cfg, ctx) { /* shared palette machinery */ }

  function registerSim(sim) {
    // 1. build shared chrome DOM
    // 2. render modals from sim.config.modals using the primitives above
    // 3. call sim.init(ctx); start rAF loop calling sim.frame(dt)
    // 4. wire reset/randomize/pause/speed/hide/record/share to the sim + chrome
  }
  return { registerSim };
})();
```

The shell owns `requestAnimationFrame`; sims never call it.

- [ ] **Step 3: Create `gravity.sim.js`**

Move all sim-owned code here and register it through the contract:

```js
// gravity.sim.js
SimShell.registerSim({
  state: { /* gravity params: G, softening, count, ... */ },
  config: {
    modals: {
      color:  { palette: PALETTES, customStops: currentPaletteStops },
      shape:  { title: "Starting shape", chips: PATTERNS, sections: [/* heading row, region slider, ... */] },
      params: { title: "Parameters", controls: [ /* {type:"slider", key, label, min, max, step}, ... */ ] },
    },
  },
  init(ctx) { /* grab ctx.canvas, store ctx.getPalette / ctx.requestReset; seed */ },
  reset() { /* re-seed bodies */ },
  randomize() { /* randomize params + reset */ },
  frame(dt) { /* simulate(dt); render(); */ },
  refreshPalette(stops) { /* rebuild LUT */ },
  resize(rescale) { /* resize canvas buffers */ },
});
```

`ctx` provides at minimum: `{ canvas, getPalette, requestReset }`. If gravity needs another shell capability, add it to `ctx` here (this is the moment the contract is defined — keep it minimal but complete).

- [ ] **Step 4: Reduce `gravity.html` to the shell skeleton**

Replace the entire chrome body (settings menu, rec indicator, hide banner, fab toolbar, all four modals) and the inline `<script>` with:

```html
<body>
    <canvas id="canvas"></canvas>
    <script src="sim-shell.js"></script>
    <script src="gravity.sim.js"></script>
</body>
```

Keep the per-sim `<head>` (title, description, OG tags) and the `<link rel="stylesheet" href="sim-shell.css" />` from Task 1.

- [ ] **Step 5: HARD GATE — verify gravity is behaviorally identical**

Open `gravity.html`. Exercise EVERY control and confirm it matches the pre-refactor behavior:
- color modal: each preset palette + custom hue/accent/sat sliders + live preview;
- shape modal: each starting shape, heading/region controls, re-seed on change;
- params modal: every slider maps to the right gravity parameter and visibly affects the sim;
- settings modal: FPS slider, each toolbar-visibility toggle, restore-defaults;
- toolbar: record, share-link, hide-UI, speed cycling, pause/play, reset;
- menu open/close, modal drag (desktop) + bottom-sheet (mobile width), canvas resize/orientation.

Do not proceed to Task 3 until all pass. Fix the contract here, not downstream.

- [ ] **Step 6: Commit**

```bash
git add sim-shell.js gravity.sim.js gravity.html
git commit -m "Add sim-shell.js contract and migrate gravity onto it"
```

---

## Task 3: Roll the proven shell out to the five remaining monoliths

Mechanical pattern-match against the gravity template — coarse edits are fine here. The risk is **silent behavioral drift** (a control wired to the wrong state key), so each sim gets its own verify before moving to the next. Do one sim fully (migrate → verify → commit) before starting the next.

**Files (one pair per sim):**
- `boids.html` + create `boids.sim.js`
- `flow-field.html` + create `flow-field.sim.js`
- `particle-life.html` + create `particle-life.sim.js`
- `reaction-diffusion.html` + create `reaction-diffusion.sim.js`
- `strange-attractors.html` + create `strange-attractors.sim.js`

For EACH sim, repeat:

- [ ] **Step A: Create `<sim>.sim.js`** by moving that file's sim-owned JS into a `SimShell.registerSim({...})` call, mirroring `gravity.sim.js`. Use the sim's real registries, state, modal labels (e.g. flow-field's shape modal title is "Emitter shape"), and param controls. If a sim needs a shell capability gravity didn't, add it to `ctx` in `sim-shell.js` (and note it — later sims may reuse it).

- [ ] **Step B: Reduce `<sim>.html`** to the skeleton from Task 2 Step 4 (`<canvas>` + two `<script>`s), keeping its per-sim `<head>` and stylesheet `<link>`(s). particle-life keeps its extra `<link rel="stylesheet" href="particle-life.css" />`.

- [ ] **Step C: Verify (per-sim gate)** — open the page and exercise every control as in Task 2 Step 5, confirming behavior matches pre-refactor. Pay special attention to that sim's unique shape/params controls actually mapping to the right state.

- [ ] **Step D: Commit**

```bash
git add <sim>.html <sim>.sim.js sim-shell.js
git commit -m "Migrate <sim> onto sim-shell"
```

---

## Task 4: Re-fit slime-mold onto the shared shell

slime-mold is already split, but on the OLD coupled structure (`slime-mold.css` + `slime-mold.js` with its own chrome). Bring it onto the shared shell and delete the now-redundant files.

**Files:**
- Modify: `slime-mold.html`
- Create: `slime-mold.sim.js`
- Delete: `slime-mold.css`, `slime-mold.js`

- [ ] **Step 1: Diff slime-mold.css against sim-shell.css.** Move any genuinely slime-mold-only rules into a new `slime-mold.css` containing ONLY those (mirroring the particle-life pattern); discard the rest as duplication. If there are none, no per-sim CSS file is needed.

- [ ] **Step 2: Create `slime-mold.sim.js`** by porting the sim-owned logic out of `slime-mold.js` into a `SimShell.registerSim({...})` call (its modals: Color, Starting pattern, Parameters, Settings). Drop slime-mold's own chrome/menu/toolbar code — the shell provides it.

- [ ] **Step 3: Update `slime-mold.html`** to the skeleton: `<canvas>` + `<link rel="stylesheet" href="sim-shell.css" />` (+ optional `slime-mold.css`) + `<script src="sim-shell.js">` + `<script src="slime-mold.sim.js">`. Delete the old `slime-mold.js` reference.

- [ ] **Step 4: Delete the old files**

```bash
git rm slime-mold.js
# git rm slime-mold.css   # only if Step 1 found no slime-mold-only rules
```

- [ ] **Step 5: Verify (manual gate)** — open `slime-mold.html`, exercise every control as in Task 2 Step 5.

- [ ] **Step 6: Commit**

```bash
git add slime-mold.html slime-mold.sim.js sim-shell.js
git commit -m "Re-fit slime-mold onto the shared sim-shell"
```

---

## Done criteria

- `sim-shell.css` + `sim-shell.js` exist once; every sim is a ~40-line `.html` + one `.sim.js` (+ optional per-sim `.css`).
- No `<style>` block or inline chrome `<script>` remains in any sim page.
- `slime-mold.js` (old structure) is deleted.
- Every sim verified behaviorally identical to pre-refactor.
- A new sim can be created by copying a `.html` skeleton + writing one `.sim.js`.
