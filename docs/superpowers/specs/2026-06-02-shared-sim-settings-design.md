# Shared sim settings + device-scaled Quality — design

**Date:** 2026-06-02
**Status:** Approved (pending spec review)

## Problem

Each sim persists its own settings under its own localStorage key, so generic
knobs (FPS, sim speed, randomize/sharing toggles) and the desired performance
level must be re-set per sim. The original motivation for Quality was the
mobile-vs-desktop gap: on a phone you want every sim dialed down to run
smoothly; on desktop you want them all pushed up to look better. Today only
slime-mold has a Quality bar, and the other sims expose ad-hoc per-sim
performance controls (a "Particle multiplier", a manual "Resolution" slider) and
a now-unwanted "Zoom" slider.

Goal: one set of **global, per-device** settings shared across all sims, with a
single **Quality** dial that each sim translates into its own dominant cost — set
once per device, applied everywhere. Settings modals converge on slime-mold's
clean shape. Zoom is dropped.

## Decisions

These were settled during brainstorming and are the binding requirements:

1. **Quality is a per-device budget, not a per-sim count control.** Particle
   count stays a randomizable Parameters knob. Quality scales each sim's
   dominant cost; it never pins count to a fixed value.
2. **For count-dominated sims, Quality scales the count _budget/range_.**
   Randomize still varies count freely; on Low it draws from a smaller range,
   on Ultra a larger one. "Quality sets the baseline, randomize varies within
   it." Mobile-Low keeps every sim light; desktop-Ultra lets them all go big.
3. **The redundant manual performance knobs are removed.** The per-sim
   "Particle multiplier" and the manual "Resolution" sliders are superseded by
   Quality and deleted.
4. **Zoom is removed** from every sim.
5. **Interaction-strength sliders are removed**, strength hardcoded to each
   slider's current max: pointer pull `0.012`, brush `1.0`, steer `1.0`.
6. **Share links carry visual config only** (params/palette/shape). The global
   block is excluded from the URL hash, so opening a desktop link on a phone
   keeps the phone's own Quality/FPS/toggles.

## Data model: global vs per-sim

`state.settings` splits into two storage homes:

- **Global block — one shared, per-device localStorage key** (e.g.
  `claude-sims-global`):
  `quality`, `fps`, `simSpeed`, `resetOnRandomize`, `randomizeColor`,
  `randomizePattern`, `showRecord`, `showShareLink`, `showHideUI`.
  Identical across every sim; set once per device. localStorage is already
  per-device, so "per-device, shared across sims" falls out for free.
- **Per-sim block — existing keys, unchanged:** `state.params`,
  `state.palette`, and shape. The current paired-key quirk (gravity +
  particle-life share `plife-state`; reaction-diffusion + strange-attractors
  share `rd-state`) only ever affected params and is left as-is.

The shell becomes the owner of the global block: on boot it loads the shared
key and deep-merges it over the sim's defaults; on any global-settings change it
writes the shared key (debounced, alongside the per-sim write).

## Quality system

The shell owns:

- the 5-level enum `low / med / high / veryHigh / ultra`, and
- one canonical normalized **scalar ladder**, e.g.
  `{ low: 0.35, med: 0.6, high: 1, veryHigh: 1.6, ultra: 2.5 }` (tunable).

Each sim declares a single **baseline** for its dominant cost and multiplies it
by the ladder scalar for the active level:

- **Count sims** (gravity, flow-field, particle-life, boids): the scalar scales
  the count budget — both the default count and the `[min, max]` range
  `randomize()` draws from, clamped to each sim's hard `MAX`. Randomize still
  varies count freely inside the scaled range.
- **Grid sims** (slime-mold, reaction-diffusion, strange-attractors): the scalar
  scales the grid-resolution target. slime-mold already does this with absolute
  targets; those get re-expressed as `baseline × ladder`.

New optional contract hook **`sim.onQualityChange?()`** fires when the level
changes, so the sim reallocates its grid / reconciles its live count
immediately. slime-mold's current segmented-control `onChange` reallocation
becomes this hook.

Note: re-expressing slime-mold's targets as `baseline × ladder` will shift its
exact levels slightly from the current `60k/130k/220k/400k/800k`. This is
acceptable and can be retuned to taste by choosing the baseline and ladder.

## Settings modal — uniform shape everywhere

Every sim's Settings modal becomes exactly slime-mold's current shape:

- **Performance** (Quality segmented control + Max FPS slider) — promoted to a
  **shell-provided standard section**, like the auto Randomize/Sharing/Restore
  sections. Sims stop declaring it.
- Auto **Randomize behavior**, **Sharing tools**, **Restore** sections
  (already shell-provided).

Removed across all sims:

- **Zoom** slider.
- **Particle multiplier** (`countMult`) and **manual Resolution** sliders.
- **Interaction sliders** (pull / brush / steer) — strength hardcoded to max as
  a constant in the sim.

Net: sims declare **zero** custom Settings sections. `modals.settings` becomes
optional/empty for every sim; the shell renders Performance + the auto sections
unconditionally.

## Persistence, migration, share links

- **persistState** splits its write: the global subset → shared key; the
  per-sim remainder (params, palette, shape) → the existing per-sim key. Load
  restores both, with the shared key winning for the global block.
- **Migration:** if the shared key is absent on boot, seed it once from whatever
  global values are present in the sim's existing per-sim state (so current
  users keep their FPS/toggles); thereafter the shared key is the source of
  truth. Stale `zoom` / `countMult` / `resolution` / `pointerForce` / `brush`
  fields in old per-sim state are simply ignored (deepMerge tolerates extras).
- **Share links:** the URL hash encodes **only** params/palette/shape. The
  global block is excluded from both encode and decode.

## Shape of the work

- **`sim-shell.js`:**
  - Add the global-key store and split persistence (global subset ↔ shared key).
  - Add the Quality enum + scalar ladder, the standard Performance section
    (Quality segmented + Max FPS), and the `onQualityChange` hook dispatch.
  - Exclude the global block from the hash encode/decode codec.
  - Update the contract docs at the top of the file (global vs per-sim state,
    Quality contract, `onQualityChange`, the removed `modals.settings` custom
    sections).
- **Each `*.sim.js`:**
  - Delete its Settings `sections`.
  - Declare a Quality baseline for its dominant cost.
  - Wire `randomize()` / grid-sizing to `baseline × ladder`; add
    `onQualityChange` where a grid realloc or count reconcile is needed.
  - Hardcode interaction strengths to max; drop `zoom` / `countMult` /
    `resolution` / `pointerForce` / `brush` from `settings` and `defaultState`.
- **`sim-shell.css`:** segmented-control styling already exists; no change
  expected.

## Out of scope

- Cross-device settings sync (Quality is intentionally per-device).
- Any change to the Parameters or Color modals beyond removing the deleted
  Settings knobs.
- The landing gallery (`index.html`).
