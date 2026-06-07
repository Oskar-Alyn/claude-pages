# Explore / Studio redesign

Date: 2026-06-07
Status: Design, pending implementation plan

## Problem

The explore page (`feed.html`) and the standalone sim pages (`boids.html`, etc.)
look almost identical, and users confuse them. They are nearly identical by
construction: explore loads the real sim full-screen inside an iframe with
`?feed=1`, and that mode is byte-for-byte the standalone page except for four
tweaks (home pill dropped, a Back FAB added, Randomize forwards `next` to the
host, a Taste-Influence slider added to Settings). Everything else is shared:
the full bottom FAB toolbar (record / share / hide-UI / speed / reset / pause /
randomize) and the cog -> dropdown -> modal path to Color / Shape / Parameters /
Settings.

Because one chrome serves two audiences, both modes are weaker than they could
be:

- **Explore is not lightweight.** A casual viewer is handed the entire studio
  plus two extra buttons.
- **The studio's creative controls are buried.** Color, Shape, and Parameters
  sit two clicks deep (cog -> dropdown -> modal), as undifferentiated peers of
  Settings.

"They look the same" and "the controls are buried" are the same problem seen
twice. The redesign splits the one chrome into two purpose-built modes and
bridges them.

## Goals

- **Explore** becomes a genuinely lightweight, lean-back way to experience the
  sims. The viewer watches, pokes the world with the pointer, and advances. The
  passive taste model shapes what comes next without the viewer touching any
  math.
- **Studio** (the former standalone sim page) becomes an unapologetic power
  mode where the creative controls (Color / Shape / Parameters) are first-class
  and reachable in one action.
- A **"take control"** action bridges explore -> studio in place: the world the
  viewer is watching stays running, mid-motion, and the studio chrome appears
  around it. No reload, no reseed.

## Non-goals

- No new serialization. The existing share-hash recipe (base64 of
  `stateWithoutGlobal()`) carries state across the bridge and shared links.
- No change to the explainer pages (`*-explained.html`).
- No change to the passive taste-learning model itself (dwell-based, in
  `feed.js`). We keep it; we just stop drowning it in chrome.
- No timed auto-advance in explore (it would flatten the dwell signal).

## The relationship between the two modes (B-live)

Explore and studio are two states of the same live page, bridged without a
reload. This is feasible cleanly because in explore the real sim is *already
running live, full-screen, in the iframe* — it is not a thumbnail or a preview.

- **Take control** sends a message to the running iframe to reveal its full
  studio chrome and drop its feed behaviors, and a message to the host
  (`feed.js`) to stop being a feed (stop preloading the next world, swap its
  top-left affordance). The canvas never blinks; the flock stays in formation,
  the reaction-diffusion pattern keeps the state it had been cooking.
- **Return to explore** reverses it: the studio chrome collapses and the stream
  resumes where it left off (Back / Next live again).

This requires turning `FEED` in `sim-shell.js` from a boot-time constant that
gates which chrome is built into a **runtime-toggleable mode**. All of it lives
in one file.

Direct studio entry (Poke It, or a shared link) loads the standalone
`sim.html`, which is not inside `feed.html`; it boots straight into studio mode
with no stream to return to.

## Explore mode

Pure lean-back. The world fills the screen. The only chrome:

- **Top-left: a home pill** ("Tiny Worlds") -> `index.html`. The casual viewer's
  way out.
- **Bottom: three controls** — **Back**, **Next**, and **Take control**. Next is
  the existing reroll (Randomize already forwards `next` to the host and works
  well), but in explore it carries a **compass** icon: the taste model is the
  viewer's compass, steering toward more of what they linger on, not a blind
  dice roll.

All taps and drags go to the **world**, not to UI. The pointer-push
interactivity added to boids / particle-life / flow-field is the centerpiece of
explore and must stay unambiguous, which is why advancing is an explicit button
rather than a swipe (a swipe would fight the drag-to-push gesture).

Advance is manual only. Dwell remains the taste signal; the viewer deciding when
to move on is exactly what makes that signal meaningful.

Everything else from today's feed chrome is removed in explore: no record, no
hide-UI, no speed, no reset, no pause, no cog. (Share is reached after taking
control.)

## Studio mode

The fix for "buried": **Color / Shape / Parameters become direct, always-visible
launchers** (using the existing icons), no cog dropdown in front of them.
**Settings** (the one remaining modal) moves behind a **gear**. This puts the
*creative* controls one action away and keeps Settings out of the way.

Responsive presentation, matching the platform split the modals already use:

- **Desktop:** the three launchers open the **existing movable/floating control
  windows**, which the owner wants to keep. The only change is the launcher
  (direct buttons instead of cog -> dropdown).
- **Mobile:** the three launchers open an **expanding inline tray** (mockup
  option C): one bar expands in place into the active control group with its
  sliders, and collapses back when done. This replaces the stacked bottom-sheets
  and beats them on a small screen.

The existing operational FAB toolbar (record / share / hide-UI / speed / reset /
pause / randomize) is retained. In practice only the reroll sees frequent use;
the rest are genuinely niche but harmless to keep out front. Here the reroll
carries a **dice** icon: in the studio it does a true random reroll of the
current world, the counterpart to explore's taste-guided compass. Settings is
reached via the gear.

Exact placement and spacing of the creative cluster vs. the operational toolbar
vs. the gear is an implementation-plan detail; the intent is: creative controls
prominent and labeled-by-icon, housekeeping behind the gear, world stays clear.

## The bridge and the round-trip

- In **explore**, "Take control" reveals studio chrome around the live world
  (no reload). The host swaps its top-left home pill for a **"Return to
  explore"** affordance.
- **Return to explore** collapses the studio chrome and resumes the stream at
  the current world; Back / Next work again. (Getting to `index.html` from a
  taken-control world is then two steps: return to explore, then home. This is
  acceptable.)
- In a **direct** studio (standalone `sim.html`), there is no stream, so the
  top-left is the normal "Tiny Worlds" home pill -> `index.html`. The host owns
  the top-left swap; the iframe sim suppresses its own home pill in feed mode as
  it does today.

### Sharing

No extra work. `buildShareURL()` builds from `location.origin +
location.pathname`, which inside the iframe is `/sim.html` (the query string is
excluded). So the share FAB already copies a clean studio URL
(`origin/sim.html#<recipe>`) even while the address bar still reads `feed.html`.
`history.pushState` to make the address bar / browser-back match is optional
polish, explicitly out of scope for v1.

## Icon fix: Parameters vs. Settings

Today the Parameters icon (faders / equalizer) and the Settings icon (stacked
toggle switches) read as cousins because both are "horizontal rows with dots,"
and they sit side by side in the dropdown. Two changes fix this:

1. **Physical separation (free):** Parameters joins the creative cluster;
   Settings lives behind the gear. They are never adjacent again.
2. **Symbol:** Settings adopts a plain **gear** glyph (it is becoming the
   housekeeping menu). Parameters keeps its faders icon. Faders for "tune the
   values," gear for "everything else."

The reroll button also splits its glyph by mode: a **compass** in explore (the
taste model steers the draw) and a **dice** in the studio (a true random
reroll). Same underlying button, two meanings made legible.

All other existing icons are kept.

## Visual differentiation

Density only. The control set is the entire tell: explore is conspicuously bare
(home pill + three controls, world edge-to-edge); studio carries the creative
cluster + operational toolbar + gear. No color/theme shift, no extra wordmark.
This is the least gimmicky option and trusts the layout to do the work, in
keeping with the project's calm, no-hype aesthetic.

## Entry and wayfinding (largely unchanged)

`index.html` already encodes the split; we refine, not reinvent:

- Top nav + hero + about card -> **"Explore"** -> `feed.html` (the casual
  stream).
- Each world card -> **"Poke It"** -> `sim.html` (direct studio) and
  **"Understand It"** -> the explainer.

The casual door and the power door already exist as separate entries. The
redesign makes each *feel* like what it is and adds the take-control bridge
between them.

## Technical approach (summary)

- `sim-shell.js`: refactor `FEED` from a boot constant into a runtime mode that
  can be toggled. Build both chrome sets so the mode can flip without reload;
  reveal/hide rather than create-at-boot. Add a `takeControl` host->sim message
  (reveal studio chrome) and keep the existing `apply` / `play` / `pause`
  messages.
- `feed.js`: on take-control, stop preloading/feeding and swap the host's
  top-left to "Return to explore"; on return, resume the sampler/stream at the
  current item.
- Explore chrome: strip to home pill + Back / Next / Take control; route
  pointer to the world.
- Studio chrome: promote Color / Shape / Parameters to direct launchers; gear
  for Settings + housekeeping; desktop floating windows kept; mobile expanding
  tray (C). Swap Settings icon to a gear.
- Sharing: no change.

## Open decisions (copy, for the owner)

- The **"Take control"** button label and the **"Return to explore"** label are
  working strings; the owner sets final copy (calm, no-hype, no em/en-dashes).
  Candidates: "Take control" / "Tweak it" / "Open studio"; "Explore" / "Back to
  the stream."
- Whether "Take control" carries a small label alongside its icon, or is
  icon-only like the rest of the cluster.
