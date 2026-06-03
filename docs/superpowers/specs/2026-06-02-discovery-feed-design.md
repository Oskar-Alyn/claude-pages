# Discovery Feed — Design

**Date:** 2026-06-02
**Status:** Approved — ready for implementation

A personal, client-only "scroll for fun" feed over the existing sims, on **one new page**.
Pressing the existing randomize button shows a new item — a sim with tuned params, drawn at
random and weighted by what you've watched. A new Back button steps back through what you've
seen. The feed learns your taste from how long you watch. Not a product — a toy for one user.
**Sim changes must be seamless: instant, like today's randomize, with no reload flash and no
crossfade — even when the draw lands on a different sim.**

## Item

An **item** (recipe) = `{ sim, params, pattern, palette }`, serialized as the existing
share-hash payload (`base64(stateWithoutGlobal())`). No new format. No RNG seed is captured —
returning to an item replays the same recipe as a fresh instance.

## UI — unchanged except one button

The sim's entire existing UI stays exactly as today: every FAB (speed, reset, pause,
**randomize**) and every modal (color, pattern, params, settings), same look and behavior. The
**only** visible addition is a **Back FAB**, styled identically to the others, in the existing
FAB row. Randomize looks and feels identical to today; only its behavior is extended (below).

## Architecture — invisible host + iframe

`feed.html` is an **invisible**, full-screen host with no UI of its own. It owns the durable
state that must survive sim swaps: the history buffer, the taste model, the sampler, and the
param manifest. The current item renders in an `<iframe src="<sim>.html?feed=1#<recipe>">`. To
the user it looks like a normal sim page plus a Back button. The 7 sims remain unchanged as
standalone pages.

The host keeps the *next* drawn item warm in a second, paused, off-screen iframe so a draw is
always flash-free instant — even across sims (the shell is a singleton, so two warm sims need
two iframes). Only the visible iframe runs its loop.

- **Draw stays on the current sim:** host messages the live iframe to apply the recipe in
  place — instant, identical to today's randomize.
- **Draw lands on a different sim:** host reveals the preloaded warm iframe instantly (a hard
  cut, no crossfade), then discards the outgoing one.
- **History** is a bounded back-stack of recipes held by the host (never live iframes). Back
  steps to older items — applied in place when it's the same sim, instant swap when not.
  Randomize always draws fresh; there is **no Forward button**, so stepping back then pressing
  randomize discards what was ahead (standard back-stack behavior). This is per requirements:
  Back is the only way to revisit, and you can't jump forward to a specific item you passed.

## Sampler

A host-side taste-weighted draw: pick `sim`, then `params | sim`. Recipes are synthesized from
a per-sim **param manifest** (`{ sim: { param: {min,max} } }`) extracted from each sim's
existing `modals.params` slider config.

A single **Taste Influence** slider (new control in the existing settings modal, persisted as a
device-wide setting the host reads) controls how much the draw follows the learned profile:

- **0% = pure uniform random** — the profile is ignored entirely.
- **100% = full taste** — draw purely from learned weights.
- **In between** — linearly blend the learned distribution toward uniform.

Cold start (no history) is uniform regardless of the slider.

## Learning

Passive signals only, measured by the host, written to a taste profile in `localStorage`:

- **Dwell:** time on an item before leaving (capped, paused when the tab is hidden). Long dwell
  → positive.
- **Fast-skip:** leaving almost immediately → negative.

The profile is per-(sim, param-bucket): both *which sims* and *which regions of each sim's
param space* you favor, resettable from settings. No favoriting; the params modal stays
available for the current sim, but adjusting it is treated as debugging and ignored. Note: on a
single-user toy the per-param-bucket signal converges slowly, so early on the feed will lean
mostly on sim-level taste and feel subtle — that's expected, not a bug.

## Shell contract (the deliberate edits to `sim-shell.js`)

A `?feed=1` query flag puts a sim page in **feed mode**. It does **not** hide chrome. It:

- Adds the **Back FAB** to the existing FAB row.
- Re-routes **randomize** and **Back** from acting locally to forwarding intent to the host.
- Adds an **apply-recipe-in-place** path: set the given params/palette/pattern into state, sync
  the controls, and re-seed — without a reload.
- Supports a paused boot (`?paused=1`) and play/pause for preloading.
- `postMessage` handshake:
  - sim → host: `{type:"ready"}` after `init()` + first render; `{type:"next"}` / `{type:"back"}`
    when those FABs are pressed.
  - host → sim: `{type:"apply", recipe}`, `{type:"play"}`, `{type:"pause"}`.

**Hard rule:** with no `?feed=1`, behavior is byte-for-byte identical to today — standalone
pages are unaffected. The shared `sim-shell.js` *is* edited, but every change is gated behind
the flag. Dwell is tracked entirely by the host (foreground iframe + document visibility), so
the sims need no telemetry code.

## Tuning knobs

These are set during the tuning round, **not design decisions**. Initial guesses only:

- History back-stack cap (~20 recipes).
- Live-iframe cap (2: the visible one + one warm preload).
- Dwell cap (~30s) and fast-skip threshold (~1.5s).
- Default Taste Influence slider value (~mid).
- Param-bucket granularity per sim.

## Out of scope

No backend, accounts, or sync. No recorded clips (sims run live). No swipe/keyboard nav. No
exact-seed replay. No Forward button. No in-page sim-swap (iframes provide the isolation
instead). No changes to the 7 sims beyond the apply-in-place path, the Back FAB, and what the
manifest reads.

## Build approach

Built in-session: the shell edits need existing context, and the feel needs live tuning. Param-
manifest extraction may be fanned out to a subagent. One live tuning round after v1 dials the
knobs above.
