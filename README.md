# Slime mold v2

An interactive Physarum (slime-mold) agent simulation, deployed through GitHub Pages.

Thousands of agents each read a pheromone "trail" field just ahead of them, steer
toward the strongest reading, move, and deposit onto the field; the field then
diffuses + decays each step. Rendered by mapping field intensity through a palette
lookup table into a canvas `ImageData` buffer.

## Running it

Zero dependencies, no build step. Open `index.html` in a browser.

The page is split into three files:

- `index.html` — markup and `<head>` meta
- `slime-mold.css` — styles
- `slime-mold.js` — simulation, rendering, and UI

## Notes for contributors

- Verify changes in a real browser: the modals are built by JS at runtime, so
  static preview/thumbnail tools that don't execute scripts will show them empty.

- One `state` object holds params/pattern/palette/settings. It is always persisted
  to localStorage and is encoded (base64 JSON) into the URL hash for share links.
  `defaultState` is a snapshot used by "Restore defaults". Note: a returning
  visitor's saved state overrides the defaults in the code.

- User-facing copy is deliberately non-technical (a "critters leave glowing trails"
  mental model) — avoid the words agent / sensor / pheromone / diffusion in anything
  the user reads.

- Each enumerable option (patterns, headings, quality, palettes) lives in one
  ordered `registry()` of descriptor objects `{ id, label, ...metadata }`. The `id`
  is the single stable key: the sim branches on it and state serializes it. The
  `label` is the friendly chip text and the only field copy edits touch (e.g.
  heading "Tangential" → "Spinning", "TwoBlobs" → "Two Blobs"). Option-specific
  metadata rides on the same object (pattern `clustered`/`blobCount`, heading
  `usesAngle`, quality `target`, palette `stops`). The UI renders from `.label`, the
  sim switches on `.id`, and `registry.byId(id)` resolves a stored id to its
  descriptor with a safe fallback to the default. To rename what the user sees, edit
  only `.label`.

- UI layout: a top-right cogwheel opens a dropdown of the four modals (Color / Shape
  / Parameters / Settings); action buttons (record, share, hide-UI, speed, reset,
  pause, randomize) are the bottom-right FAB toolbar. Press **H** to hide all UI for
  clean recordings.
