# Discovery Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single new page, `feed.html`, an invisible iframe host that turns the existing sims into a personal, taste-learning "scroll for fun" feed — without changing any standalone sim page's behavior.

**Architecture:** `feed.html` + `feed.js` is a chrome-less host. It owns the durable state (history back-stack, taste profile, sampler) and renders the current item in a full-screen `<iframe src="<sim>.html?feed=1#<recipe>">`. A second, paused, opacity-0 iframe keeps the *next* drawn item warm so cross-sim draws are a flash-free hard cut (cap: 2 live iframes). Same-sim draws apply the recipe in place via `postMessage`. `sim-shell.js` gains a feed mode behind a `?feed=1` query flag; **every** added line is gated by that flag, so a sim with no `?feed=1` is byte-for-byte identical to today. The recipe format is the *existing* share-hash payload — `base64(stateWithoutGlobal())` — so no new serialization is invented. The param manifest is harvested at runtime: the shell reports its own `modals.params` ranges in its `ready` message, so the host never hand-maintains per-sim ranges and they can never drift.

**Tech Stack:** Plain build-free ES (no bundler, no modules), `postMessage`, `localStorage`, `<iframe>`. Static site: **no build step and no automated test harness.** "Verification" in each task is a concrete manual browser check; ship `python3 -m http.server` locally to test (file:// also works because all `postMessage` uses `"*"` and same-origin localStorage is shared).

---

## Repo facts this plan relies on (verified)

- Six sims exist: `boids`, `gravity`, `flow-field`, `particle-life`, `reaction-diffusion`, `slime-mold`. (The spec says 7; "Strange Attractors" was removed in commit `0ab78bb`.) Each is a `<sim>.html` that loads `sim-shell.js` then `<sim>.sim.js`.
- `sim-shell.js` exposes `SimShell.registerSim(sim)`. Relevant internals already present and reused by this plan:
  - `stateWithoutGlobal()` — clones `state` minus the 9 global settings keys. **This is the recipe payload.**
  - `buildShareURL()` already does `btoa(unescape(encodeURIComponent(json)))` on it — same encoding the host will use.
  - `deepMerge(target, src)` — partial restore; tolerant of missing/extra keys.
  - `loadFromHash()` — decodes a `#<base64>` recipe and `deepMerge`s it, stripping global keys. Already runs at boot, so a cross-sim iframe load with `#<recipe>` Just Works.
  - `restoreDefaults()` — the template for `applyRecipe`: it `deepMerge`s state, calls `sim.onRestoreDefaults?.()` (rebuilds derived state like particle-life's attraction matrix), then `applyParamsToSliders / syncColorControls / syncPatternControls / syncSettings / applyPalette / requestReset`.
  - `modalsCfg.params.controls` is `[{key,min,max,step,...}]` — the manifest source.
  - `colorCfg.paletteRegistry.items` → palette preset ids; `shapeCfg.chips.items` → shape ids (shapeCfg may be absent — gravity has it, all current sims do, but guard anyway).
  - The FAB toolbar is `#fab-toolbar` with children ending in `#fab-randomize` (`.fab.fab-primary`). Every FAB is a `<button class="fab">`. The Back FAB reuses `.fab` — **no CSS change required.**
- particle-life's `state.matrix` is derived; it is re-randomized by its `onRestoreDefaults`. The recipe does not capture a seed (per spec), so a synthesized particle-life recipe leaves `matrix: []` and the apply/boot path rebuilds it. This is intended ("replays as a fresh instance").

---

## File Structure

- **Create `feed.html`** — minimal invisible host shell: full-screen `#feed-stage`, inline `<style>` for the stage + iframe layering, loads `feed.js`. No chrome of its own.
- **Create `feed.js`** — all host logic: tuning constants, sim list, taste profile (load/save/update), sampler (`sampleSim` + `synthesizeRecipe`), iframe lifecycle (current + one warm), the `postMessage` protocol handler, dwell tracking, history back-stack.
- **Modify `sim-shell.js`** — add feed mode, every line gated behind a `FEED` flag parsed from `location.search`: parse flags; inject Back FAB; re-route randomize + Back to `postMessage`; `applyRecipe()`; play/pause messages; `buildFeedManifest()`; send `ready` after first render; inject the "Feed" settings section (Taste Influence slider + Reset taste button).
- **No change** to the 6 `*.sim.js` files, `sim-shell.css`, or `index.html`. (Spec: sims need no telemetry code; Back FAB needs no new CSS.)

---

## Shared definitions (used across tasks — single source of truth)

**The postMessage protocol** (sim ↔ host, all `targetOrigin: "*"`):

- sim → host:
  - `{ type:"ready", sim:"<id>", manifest:{params:{key:{min,max,step}}, palettes:[id], patterns:[id]}, recipe:<stateWithoutGlobal> }`
  - `{ type:"next" }` (randomize pressed)
  - `{ type:"back" }` (Back pressed)
  - `{ type:"resetTaste" }` (Reset-taste button)
- host → sim:
  - `{ type:"apply", recipe:<recipe> }`
  - `{ type:"play" }` / `{ type:"pause" }`

**Recipe** = an object shaped like `stateWithoutGlobal()`: `{ params, pattern, palette, settings, ...sim-specific }`. Encoded for a hash with `btoa(unescape(encodeURIComponent(JSON.stringify(recipe))))`.

**TUNING constants** (guesses per spec — wired as easily-changed constants, tuned in a later round):

```js
const TUNING = {
    HISTORY_CAP: 20,        // back-stack depth
    DWELL_CAP_MS: 30000,    // dwell saturates here
    FAST_SKIP_MS: 1500,     // below this = negative signal
    BUCKETS_PER_PARAM: 4,   // taste granularity per param axis
    DEFAULT_INFLUENCE: 0.5, // Taste Influence slider default (0..1)
    DECAY: 0.9,             // EMA decay applied to a score before adding reward
    SOFTMAX_TEMP: 1.5,      // sharpness of the learned distribution
};
```

---

## Task 1: Feed-mode flag + Back FAB in the shell (gated, no behavior change without `?feed=1`)

**Files:**
- Modify: `sim-shell.js` (inside `registerSim`, near the top after `const WIN_KEY = ...`, and in the toolbar-wiring section near `#fab-randomize`).

- [ ] **Step 1: Parse the flags once, near the top of `registerSim`** (right after the `LS_KEY`/`WIN_KEY`/`defaultState` lines, before `// ---- inject chrome DOM ----`):

```js
        // ---- feed mode (all behavior below is gated on FEED; a page with no
        // ?feed=1 is byte-for-byte identical to before) -----------------
        const _q = new URLSearchParams(location.search);
        const FEED = _q.has("feed");
        const BOOT_PAUSED = _q.has("paused");
```

- [ ] **Step 2: Inject the Back FAB in feed mode.** Find the randomize wiring (`const fabRandomize = byId("fab-randomize");`). Immediately *before* it, add:

```js
        // ---- feed: Back FAB (styled identically; reuses .fab) ---------
        if (FEED) {
            const back = document.createElement("button");
            back.className = "fab";
            back.id = "fab-back";
            back.title = "Back";
            back.setAttribute("aria-label", "Back");
            back.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                </svg>`;
            byId("fab-toolbar").insertBefore(back, byId("fab-randomize"));
            back.addEventListener("click", () => {
                parent.postMessage({ type: "back" }, "*");
            });
        }
```

- [ ] **Step 3: Manual verify.** Serve the repo (`python3 -m http.server 8000`) and open:
  - `http://localhost:8000/boids.html` — toolbar unchanged, **no** Back FAB. Randomize still randomizes locally.
  - `http://localhost:8000/boids.html?feed=1` — a Back (chevron-left) FAB appears immediately left of Randomize, identical glass styling. Clicking it does nothing visible yet (no host listening) and throws no error.
  Expected: standalone page visually unchanged; feed page shows exactly one new FAB.

- [ ] **Step 4: Commit**

```bash
git add sim-shell.js
git commit -m "feat(feed): add gated feed-mode flag and Back FAB to shell"
```

---

## Task 2: Re-route randomize/Back + apply-recipe-in-place + play/pause + ready (shell)

**Files:**
- Modify: `sim-shell.js` (randomize handler; a new `applyRecipe`; a `message` listener; `buildFeedManifest`; the main loop's first-render hook; the `BOOT_PAUSED` initial play state).

- [ ] **Step 1: Re-route the randomize click in feed mode.** In the existing `fabRandomize.addEventListener("click", () => { ... })`, keep the spin animation but short-circuit the local behavior when in feed mode. Change the start of the handler from:

```js
        fabRandomize.addEventListener("click", () => {
            fabRandomize.classList.remove("spin");
            void fabRandomize.offsetWidth;
            fabRandomize.classList.add("spin");

            sim.randomize();
```

to:

```js
        fabRandomize.addEventListener("click", () => {
            fabRandomize.classList.remove("spin");
            void fabRandomize.offsetWidth;
            fabRandomize.classList.add("spin");

            // Feed mode: randomize forwards intent to the host, which owns the
            // draw. The local randomize path below is skipped entirely.
            if (FEED) {
                parent.postMessage({ type: "next" }, "*");
                return;
            }

            sim.randomize();
```

- [ ] **Step 2: Add `applyRecipe` + the host-message listener + manifest builder.** Place this block just after the randomize handler (before `// ---- restore defaults ----`):

```js
        // ---- feed: apply a recipe in place (no reload) ----------------
        // Mirrors restoreDefaults() minus the localStorage clear: merge the
        // recipe into state, let the sim rebuild non-color derived state
        // (e.g. particle-life's matrix), then resync controls + reseed.
        function applyRecipe(recipe) {
            if (!recipe) return;
            if (recipe.settings) {
                for (const k of GLOBAL_SETTING_KEYS) delete recipe.settings[k];
            }
            deepMerge(state, recipe);
            if (typeof sim.onRestoreDefaults === "function")
                sim.onRestoreDefaults();
            applyParamsToSliders();
            syncColorControls();
            syncPatternControls();
            applyPalette();
            requestReset();
        }

        // ---- feed: manifest the host harvests from this sim's own config --
        function buildFeedManifest() {
            const p = {};
            (paramsCfg.controls || []).forEach((c) => {
                p[c.key] = { min: c.min, max: c.max, step: c.step };
            });
            return {
                params: p,
                palettes: (colorCfg.paletteRegistry.items || []).map(
                    (x) => x.id,
                ),
                patterns:
                    shapeCfg && shapeCfg.chips
                        ? shapeCfg.chips.items.map((x) => x.id)
                        : [],
            };
        }

        // ---- feed: host -> sim messages -------------------------------
        if (FEED) {
            window.addEventListener("message", (e) => {
                const d = e.data;
                if (!d || typeof d !== "object") return;
                if (d.type === "apply") {
                    applyRecipe(d.recipe);
                } else if (d.type === "play") {
                    if (!playing) {
                        playing = true;
                        updatePauseButton();
                    }
                } else if (d.type === "pause") {
                    if (playing) {
                        playing = false;
                        updatePauseButton();
                    }
                }
            });
        }
```

(Note: `playing` and `updatePauseButton` are declared just below in the current source; this listener only *runs* on message, long after boot, so the forward reference is fine. If load order ever matters, the listener body resolves them lazily at call time anyway.)

- [ ] **Step 3: Honor `BOOT_PAUSED`.** The shell declares `let playing = true;`. Right after `updatePauseButton();` runs at the end of boot (in the boot sequence near `updateSpeedLabel();`), add a feed gate. Find:

```js
        updatePauseButton();
        updateSpeedLabel();
```

and change to:

```js
        if (FEED && BOOT_PAUSED) playing = false;
        updatePauseButton();
        updateSpeedLabel();
```

- [ ] **Step 4: Send `ready` after the first real render.** In the main `loop(now)`, after `sim.render();`, add a one-shot feed signal. Add a flag declaration near `let lastFrame = 0;`:

```js
        let lastFrame = 0;
        let lastSim = 0;
        let simAccumulator = 0;
        let feedReadySent = false;
```

and change the tail of `loop`:

```js
            sim.render();

            if (FEED && !feedReadySent) {
                feedReadySent = true;
                parent.postMessage(
                    {
                        type: "ready",
                        sim: simId,
                        manifest: buildFeedManifest(),
                        recipe: stateWithoutGlobal(),
                    },
                    "*",
                );
            }
        }
```

- [ ] **Step 5: Manual verify (with a throwaway host).** Create a scratch file `scratch-host.html` at repo root:

```html
<!doctype html><meta charset="utf-8">
<iframe id="f" src="boids.html?feed=1" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>
<script>
addEventListener("message", (e) => {
    console.log("MSG", e.data.type, e.data.sim || "", e.data);
    if (e.data.type === "next") console.log("host got NEXT");
    if (e.data.type === "back") console.log("host got BACK");
});
</script>
```

Open `http://localhost:8000/scratch-host.html` with the console open. Expected:
  - One `MSG ready boids {manifest:{params:{count,speed,...}}, recipe:{...}}` log shortly after load.
  - Clicking Randomize logs `host got NEXT` (and the sim does **not** locally randomize).
  - Clicking Back logs `host got BACK`.
  Then delete the scratch file: `rm scratch-host.html`.

- [ ] **Step 6: Re-verify no standalone regression.** Open `http://localhost:8000/boids.html` (no `?feed=1`): Randomize randomizes locally as before; no `ready`/`next` messages; console clean.

- [ ] **Step 7: Commit**

```bash
git add sim-shell.js
git commit -m "feat(feed): reroute randomize/back, add apply-recipe, play/pause, ready handshake"
```

---

## Task 3: The invisible host page + iframe lifecycle (boot one item, no draws yet)

**Files:**
- Create: `feed.html`
- Create: `feed.js`

- [ ] **Step 1: Create `feed.html`** (chrome-less, full-screen stage, layered iframes):

```html
<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta
            name="viewport"
            content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
        />
        <meta name="theme-color" content="#0a0d14" />
        <title>Discovery Feed</title>
        <meta name="description" content="A personal discovery feed over the sims." />
        <link rel="icon" type="image/svg+xml" href="favicon.svg" />
        <style>
            html, body { margin: 0; height: 100%; background: #0a0d14; overflow: hidden; }
            #feed-stage { position: fixed; inset: 0; }
            .feed-frame {
                position: absolute;
                inset: 0;
                width: 100%;
                height: 100%;
                border: 0;
                opacity: 0;          /* warm/loading frames are invisible... */
                pointer-events: none;/* ...and non-interactive */
                z-index: 0;
            }
            .feed-frame.show {
                opacity: 1;          /* the one visible item */
                pointer-events: auto;
                z-index: 1;
            }
        </style>
    </head>
    <body>
        <div id="feed-stage"></div>
        <script src="feed.js"></script>
    </body>
</html>
```

- [ ] **Step 2: Create `feed.js` with constants, sim list, and the iframe lifecycle. Boot a single uniform-random item; no sampler/taste/history yet** (those land in Tasks 4–6). This is the minimal walking skeleton:

```js
/* ============================================================================
 * feed.js — the invisible Discovery Feed host.
 *
 * Owns durable state (history, taste, sampler) and renders the current item in
 * a full-screen iframe (<sim>.html?feed=1#<recipe>). A second paused, opacity-0
 * iframe keeps the next drawn item warm so cross-sim draws are a flash-free hard
 * cut. Cap: 2 live iframes (visible + one warm). Same-sim draws apply the recipe
 * in place via postMessage. The recipe is the existing share-hash payload.
 * ========================================================================== */
(() => {
    "use strict";

    const TUNING = {
        HISTORY_CAP: 20,
        DWELL_CAP_MS: 30000,
        FAST_SKIP_MS: 1500,
        BUCKETS_PER_PARAM: 4,
        DEFAULT_INFLUENCE: 0.5,
        DECAY: 0.9,
        SOFTMAX_TEMP: 1.5,
    };
    const FEED_SIMS = [
        "boids",
        "gravity",
        "flow-field",
        "particle-life",
        "reaction-diffusion",
        "slime-mold",
    ];

    const stage = document.getElementById("feed-stage");
    const randItem = (a) => a[Math.floor(Math.random() * a.length)];
    const encodeRecipe = (r) =>
        btoa(unescape(encodeURIComponent(JSON.stringify(r))));

    // Per-sim harvested manifest + default recipe template, cached across draws.
    // { simId: { manifest, template } }
    const manifests = {};

    // current/warm: { sim, recipe, iframe, ready }. nextItem: { sim, recipe }.
    let current = null;
    let warm = null;
    let nextItem = null;
    // A reveal awaiting an iframe's `ready` before the hard cut.
    let pendingReveal = null;

    function makeFrame(item, paused) {
        const f = document.createElement("iframe");
        f.className = "feed-frame";
        const hash = item.recipe ? "#" + encodeRecipe(item.recipe) : "";
        f.src = `${item.sim}.html?feed=1${paused ? "&paused=1" : ""}${hash}`;
        stage.appendChild(f);
        return f;
    }

    // --- draw: uniform for now; replaced by the sampler in Task 5 ---------
    function drawItem() {
        const sim = randItem(FEED_SIMS);
        const cached = manifests[sim];
        // synthesizeRecipe arrives in Task 5; until then recipe is null (the
        // sim boots at its own default and we harvest its manifest on ready).
        const recipe = cached ? null : null;
        return { sim, recipe };
    }

    function startFeed() {
        current = { ...drawItem(), iframe: null, ready: false };
        current.iframe = makeFrame(current, false);
        current.iframe.classList.add("show");
    }

    // --- message protocol -------------------------------------------------
    window.addEventListener("message", (e) => {
        const d = e.data;
        if (!d || typeof d !== "object" || !d.type) return;
        const src = e.source;
        if (d.type === "ready") onReady(src, d);
        else if (d.type === "next") onNext();
        else if (d.type === "back") onBack();
        else if (d.type === "resetTaste") onResetTaste();
    });

    function onReady(src, d) {
        // Cache the manifest the first time we see this sim.
        if (!manifests[d.sim]) {
            manifests[d.sim] = { manifest: d.manifest, template: d.recipe };
        }
        const slot =
            current && src === current.iframe.contentWindow
                ? current
                : warm && warm.iframe && src === warm.iframe.contentWindow
                  ? warm
                  : null;
        if (slot) {
            slot.ready = true;
            // If we loaded this slot without a recipe, adopt the sim's default
            // so history/back can replay it.
            if (!slot.recipe) slot.recipe = d.recipe;
        }
        // Task 6 wires pendingReveal hard-cuts here.
    }

    // Stubs filled in by later tasks.
    function onNext() {}
    function onBack() {}
    function onResetTaste() {}

    startFeed();
})();
```

- [ ] **Step 3: Manual verify.** Open `http://localhost:8000/feed.html`. Expected:
  - A random one of the 6 sims fills the screen and animates, looking like a normal sim page **with** a Back FAB.
  - Console clean. In devtools → Application → Frames, exactly **one** iframe `<sim>.html?feed=1`.
  - Reloading sometimes shows a different sim.
  - Randomize/Back do nothing yet (stubs) but throw no errors.

- [ ] **Step 4: Commit**

```bash
git add feed.html feed.js
git commit -m "feat(feed): invisible host page boots a single uniform-random item"
```

---

## Task 4: Dwell tracking + taste profile persistence (measured by host)

**Files:**
- Modify: `feed.js`

- [ ] **Step 1: Add taste storage + dwell + the update rule.** Insert after the `manifests` declaration:

```js
    const LS_TASTE = "claude-feed-taste";

    function freshTaste() {
        return { sims: {}, params: {} }; // params keyed "sim|param" -> bucket array
    }
    function loadTaste() {
        try {
            return JSON.parse(localStorage.getItem(LS_TASTE)) || freshTaste();
        } catch (_) {
            return freshTaste();
        }
    }
    function saveTaste() {
        try {
            localStorage.setItem(LS_TASTE, JSON.stringify(taste));
        } catch (_) {}
    }
    let taste = loadTaste();

    // --- dwell: time the current item is foregrounded (paused when hidden) -
    let dwellStart = 0; // timestamp of last visible-start for current item
    let dwellAccum = 0; // ms accumulated while visible
    function startDwell() {
        dwellAccum = 0;
        dwellStart = document.hidden ? 0 : performance.now();
    }
    function dwellMs() {
        const live = !document.hidden && dwellStart ? performance.now() - dwellStart : 0;
        return Math.min(TUNING.DWELL_CAP_MS, dwellAccum + live);
    }
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            if (dwellStart) dwellAccum += performance.now() - dwellStart;
            dwellStart = 0;
        } else {
            dwellStart = performance.now();
        }
    });

    function bucketOf(value, range) {
        const t = (value - range.min) / (range.max - range.min || 1);
        const b = Math.floor(t * TUNING.BUCKETS_PER_PARAM);
        return Math.max(0, Math.min(TUNING.BUCKETS_PER_PARAM - 1, b));
    }

    // Reward in [-1, 1]: fast-skip is -1; otherwise 0 at the skip threshold
    // rising to +1 at the dwell cap. Scores are an EMA: score = score*DECAY + r.
    function rewardFor(ms) {
        if (ms < TUNING.FAST_SKIP_MS) return -1;
        return (
            (Math.min(ms, TUNING.DWELL_CAP_MS) - TUNING.FAST_SKIP_MS) /
            (TUNING.DWELL_CAP_MS - TUNING.FAST_SKIP_MS)
        );
    }
    function commitDwell(item) {
        if (!item) return;
        const r = rewardFor(dwellMs());
        taste.sims[item.sim] = (taste.sims[item.sim] || 0) * TUNING.DECAY + r;
        const man = manifests[item.sim] && manifests[item.sim].manifest;
        if (item.recipe && item.recipe.params && man) {
            Object.keys(man.params).forEach((k) => {
                const v = item.recipe.params[k];
                if (typeof v !== "number") return;
                const key = item.sim + "|" + k;
                const arr =
                    taste.params[key] ||
                    (taste.params[key] = new Array(
                        TUNING.BUCKETS_PER_PARAM,
                    ).fill(0));
                const b = bucketOf(v, man.params[k]);
                arr[b] = arr[b] * TUNING.DECAY + r;
            });
        }
        saveTaste();
    }
```

- [ ] **Step 2: Start dwell when the first item shows.** In `startFeed()`, after `current.iframe.classList.add("show");` add `startDwell();`.

- [ ] **Step 3: Wire reset-taste.** Replace the `onResetTaste` stub:

```js
    function onResetTaste() {
        taste = freshTaste();
        saveTaste();
    }
```

- [ ] **Step 4: Manual verify.** Open `feed.html`, leave it ~3s, then in the console run `JSON.parse(localStorage.getItem("claude-feed-taste"))` — it stays `{sims:{},params:{}}` for now (no item-change has committed dwell yet; that happens on draw in Task 6). Switch tabs and back: no errors. This task is mostly validated transitively in Task 6; the explicit check here is only that the code loads with no console error and `localStorage` has no malformed write.

- [ ] **Step 5: Commit**

```bash
git add feed.js
git commit -m "feat(feed): host-side dwell tracking and taste profile persistence"
```

---

## Task 5: Taste-weighted sampler — `sampleSim` + `synthesizeRecipe` + Taste Influence read

**Files:**
- Modify: `feed.js`

- [ ] **Step 1: Add the influence read, softmax/blend helpers, and the sampler.** Insert after the taste helpers:

```js
    const LS_SETTINGS = "claude-feed-settings";
    function currentInfluence() {
        try {
            const s = JSON.parse(localStorage.getItem(LS_SETTINGS));
            if (s && typeof s.influence === "number")
                return Math.max(0, Math.min(1, s.influence));
        } catch (_) {}
        return TUNING.DEFAULT_INFLUENCE;
    }

    const haveAnyHistory = () =>
        Object.values(taste.sims).some((v) => v !== 0);

    // softmax over scores -> probability array
    function softmax(scores) {
        const m = Math.max(...scores);
        const ex = scores.map((s) => Math.exp((s - m) * TUNING.SOFTMAX_TEMP));
        const sum = ex.reduce((a, b) => a + b, 0) || 1;
        return ex.map((e) => e / sum);
    }
    // Blend a learned distribution toward uniform by influence (0=uniform,1=learned).
    function blendUniform(learned, influence) {
        const n = learned.length;
        return learned.map((p) => (1 - influence) * (1 / n) + influence * p);
    }
    function sampleIndex(probs) {
        let r = Math.random();
        for (let i = 0; i < probs.length; i++) {
            r -= probs[i];
            if (r <= 0) return i;
        }
        return probs.length - 1;
    }

    function sampleSim() {
        const influence = currentInfluence();
        // Cold start (no signal yet) or influence 0 -> pure uniform.
        if (influence === 0 || !haveAnyHistory()) return randItem(FEED_SIMS);
        const scores = FEED_SIMS.map((s) => taste.sims[s] || 0);
        return FEED_SIMS[sampleIndex(blendUniform(softmax(scores), influence))];
    }

    function snap(v, range) {
        const step = range.step || (range.max - range.min) / 100;
        const n = Math.round((v - range.min) / step);
        return Math.max(range.min, Math.min(range.max, range.min + n * step));
    }
    function sampleParam(sim, key, range, influence) {
        const arr = taste.params[sim + "|" + key];
        let lo = range.min,
            hi = range.max;
        if (influence > 0 && arr && arr.some((v) => v !== 0)) {
            const b = sampleIndex(blendUniform(softmax(arr), influence));
            const span = (range.max - range.min) / TUNING.BUCKETS_PER_PARAM;
            lo = range.min + span * b;
            hi = lo + span;
        }
        return snap(lo + Math.random() * (hi - lo), range);
    }

    // Build a full, valid recipe by overlaying sampled values on the sim's
    // own default template (which carries any sim-specific fields, e.g. boids'
    // heading or particle-life's empty matrix that the sim re-randomizes).
    function synthesizeRecipe(sim) {
        const cached = manifests[sim];
        if (!cached) return null; // not harvested yet -> caller loads defaults
        const influence = currentInfluence();
        const recipe = JSON.parse(JSON.stringify(cached.template));
        recipe.params = recipe.params || {};
        Object.keys(cached.manifest.params).forEach((k) => {
            recipe.params[k] = sampleParam(
                sim,
                k,
                cached.manifest.params[k],
                influence,
            );
        });
        if (cached.manifest.palettes.length) {
            recipe.palette = recipe.palette || {};
            recipe.palette.mode = "preset";
            recipe.palette.name = randItem(cached.manifest.palettes);
        }
        if (cached.manifest.patterns.length) {
            recipe.pattern = recipe.pattern || {};
            recipe.pattern.name = randItem(cached.manifest.patterns);
        }
        return recipe;
    }
```

- [ ] **Step 2: Use the sampler in `drawItem`.** Replace the placeholder body:

```js
    function drawItem() {
        const sim = sampleSim();
        return { sim, recipe: synthesizeRecipe(sim) }; // recipe null until harvested
    }
```

- [ ] **Step 3: Manual verify.** Open `feed.html`. First load of a never-seen sim shows its defaults (recipe `null` → harvest on ready). Reload several times; in the console, after a sim has been seen once, run `manifests` is internal — instead verify indirectly: open `boids.html?feed=1#...` is exercised in Task 6. For now confirm: no console errors, and `JSON.parse(localStorage.getItem("claude-feed-settings"))` is `null` (slider not built yet) so `currentInfluence()` returns the default 0.5 — check by temporarily running `localStorage.setItem("claude-feed-settings", JSON.stringify({influence:0}))` and reloading: still boots fine. Clean up with `localStorage.removeItem("claude-feed-settings")`.

- [ ] **Step 4: Commit**

```bash
git add feed.js
git commit -m "feat(feed): taste-weighted sampler with linear taste-influence blend"
```

---

## Task 6: Draws — warm preload, hard cut across sims, apply-in-place same sim, history + Back

**Files:**
- Modify: `feed.js`

- [ ] **Step 1: Add history + the draw/reveal state machine.** Add a history array near the other host state (`let nextItem = null;`):

```js
    const history = []; // back-stack of past items {sim, recipe}
    function pushHistory(item) {
        if (!item) return;
        history.push({ sim: item.sim, recipe: item.recipe });
        while (history.length > TUNING.HISTORY_CAP) history.shift();
    }
```

- [ ] **Step 2: Add `prepareNext`, called after every item becomes current.** It draws the upcoming item and warms a paused iframe **only** when the next item is a different sim (same-sim draws apply in place and need no second iframe — keeps live iframes ≤ 2):

```js
    function destroyWarm() {
        if (warm && warm.iframe) warm.iframe.remove();
        warm = null;
    }
    function prepareNext() {
        nextItem = drawItem();
        destroyWarm();
        if (nextItem.sim !== current.sim) {
            warm = { ...nextItem, iframe: null, ready: false };
            warm.iframe = makeFrame(warm, true); // paused, opacity-0
        }
    }
```

- [ ] **Step 3: Call `prepareNext()` once the first item is showing.** In `startFeed()`, after `startDwell();` add `prepareNext();`.

- [ ] **Step 4: Add the hard-cut + cross-sim reveal.** Add:

```js
    // Hard cut: reveal `incoming` (a ready, paused frame), play it, drop current.
    function hardCut(incoming) {
        incoming.iframe.contentWindow.postMessage({ type: "play" }, "*");
        incoming.iframe.classList.add("show");
        if (current && current.iframe) current.iframe.remove();
        current = incoming;
        startDwell();
        prepareNext();
    }

    // Reveal an item on a *different* sim than current. Use the warm frame if it
    // already holds this item and is ready; otherwise load it paused and cut
    // once it signals ready (flash-free: we never show an un-rendered frame).
    function revealCrossSim(item) {
        if (
            warm &&
            warm.sim === item.sim &&
            warm.recipe === item.recipe &&
            warm.ready
        ) {
            const w = warm;
            warm = null; // consume; do not let prepareNext destroy it
            hardCut(w);
            return;
        }
        destroyWarm();
        const incoming = { ...item, iframe: null, ready: false };
        incoming.iframe = makeFrame(incoming, true);
        pendingReveal = incoming;
    }

    // Core transition. pushCurrent=true for forward (randomize), false for back.
    function goTo(item, pushCurrent) {
        commitDwell(current);
        if (pushCurrent) pushHistory(current);
        if (item.sim === current.sim) {
            // same sim: apply in place, no reload
            current.recipe = item.recipe;
            if (item.recipe)
                current.iframe.contentWindow.postMessage(
                    { type: "apply", recipe: item.recipe },
                    "*",
                );
            startDwell();
            prepareNext();
        } else {
            revealCrossSim(item);
        }
    }
```

- [ ] **Step 5: Wire the hard-cut into `onReady`** so a `pendingReveal` (a cross-sim target that wasn't pre-warmed, e.g. Back) cuts over the moment its frame is ready. At the end of `onReady`, replace the `// Task 6 wires...` comment with:

```js
        if (pendingReveal && src === pendingReveal.iframe.contentWindow) {
            const inc = pendingReveal;
            pendingReveal = null;
            hardCut(inc);
        }
```

Also, when a warm frame finishes loading, `onReady`'s `slot` branch already sets `warm.ready = true` and adopts its recipe — no extra code needed.

- [ ] **Step 6: Implement `onNext` / `onBack`.** Replace the stubs:

```js
    function onNext() {
        if (!nextItem) return;
        goTo(nextItem, true);
    }
    function onBack() {
        if (!history.length) return;
        goTo(history.pop(), false);
    }
```

- [ ] **Step 7: Manual verify — the core experience.** Open `feed.html`:
  1. **Same-sim draw is instant in place.** Press Randomize repeatedly; when consecutive draws land on the same sim, params/colors change with **no reload flash** (the canvas never blanks white). Frames panel still shows ≤ 2 iframes.
  2. **Cross-sim draw is a flash-free hard cut.** When a draw lands on a different sim, the swap is instant with no white flash and no crossfade (the next sim was pre-warmed). Frames panel: the old iframe is gone, a new warm one appears.
  3. **Live-iframe cap.** At any moment, devtools → Application → Frames shows at most 2 `?feed=1` iframes.
  4. **Back.** After several randomizes, press Back: it returns to the previous item (in place if same sim, hard cut if not — the latter may take a beat to load but never flashes white). Pressing Back past the start does nothing.
  5. **No Forward.** Back, then Randomize → draws a fresh item (the thing you backed away from is gone). Correct per spec.
  6. **Taste accrues.** Linger on items of one sim for >2s each and fast-skip others; run `JSON.parse(localStorage.getItem("claude-feed-taste"))` in console — `sims` scores for lingered sims trend positive, skipped ones negative.

- [ ] **Step 8: Commit**

```bash
git add feed.js
git commit -m "feat(feed): warm preload, hard-cut across sims, apply-in-place, history/back"
```

---

## Task 7: Taste Influence slider + Reset-taste button in the Settings modal (shell, feed-gated)

**Files:**
- Modify: `sim-shell.js` (the `buildSettingsModal` function + a small feed-settings section builder).

- [ ] **Step 1: Add a feed Settings section builder.** Just before `function buildSettingsModal()`, add:

```js
        // ---- feed: Taste Influence slider + Reset-taste button --------
        // Persists to the shared claude-feed-settings key the host reads each
        // draw; Reset clears claude-feed-taste and tells the host to drop its
        // in-memory copy. Only built when FEED.
        const FEED_SETTINGS_KEY = "claude-feed-settings";
        const FEED_TASTE_KEY = "claude-feed-taste";
        function readFeedInfluence() {
            try {
                const s = JSON.parse(
                    localStorage.getItem(FEED_SETTINGS_KEY),
                );
                if (s && typeof s.influence === "number") return s.influence;
            } catch (e) {}
            return 0.5; // matches host TUNING.DEFAULT_INFLUENCE
        }
        function writeFeedInfluence(v) {
            try {
                localStorage.setItem(
                    FEED_SETTINGS_KEY,
                    JSON.stringify({ influence: v }),
                );
            } catch (e) {}
        }
        function makeFeedSection() {
            const sec = sectionEl("Feed");
            const ctl = slider(
                {
                    label: "Taste influence",
                    min: 0,
                    max: 1,
                    step: 0.05,
                    fmt: (v) => Math.round(v * 100) + "%",
                    get: readFeedInfluence,
                    set: writeFeedInfluence,
                },
                () => {}, // slider() persists via set(); no per-sim persist needed
            );
            sec.appendChild(ctl.wrap);
            sec.appendChild(
                hintEl(
                    "How strongly the feed follows what you watch. 0% is pure random; 100% leans fully on your taste.",
                    true,
                ),
            );
            const actions = document.createElement("div");
            actions.className = "modal-actions";
            actions.style.marginTop = "6px";
            const reset = document.createElement("button");
            reset.className = "btn";
            reset.textContent = "Reset taste profile";
            reset.addEventListener("click", () => {
                try {
                    localStorage.removeItem(FEED_TASTE_KEY);
                } catch (e) {}
                parent.postMessage({ type: "resetTaste" }, "*");
                showToast("Taste profile reset");
            });
            actions.appendChild(reset);
            sec.appendChild(actions);
            return sec;
        }
```

Note: `slider()` calls `def.set(v)` on input, so moving the slider writes `claude-feed-settings` immediately; the empty `onPersist` is intentional (no per-sim state to persist).

- [ ] **Step 2: Inject the section in `buildSettingsModal`.** After `body.appendChild(makePerformanceSection());`, add:

```js
            if (FEED) body.appendChild(makeFeedSection());
```

- [ ] **Step 3: Manual verify.**
  - `boids.html` (no feed): open Settings → **no** "Feed" section. Standalone unaffected.
  - `feed.html`: open the current sim's Settings (cog → Settings) → a "Feed" section with a "Taste influence" slider (shows a %) and a "Reset taste profile" button.
    - Drag the slider; run `JSON.parse(localStorage.getItem("claude-feed-settings"))` → `{influence:<value>}` updates live.
    - Set it to 0%, then press Randomize many times — draws are uniform across all 6 sims regardless of prior taste.
    - Set it to 100% after building some taste — draws concentrate on favored sims/param regions.
    - Press "Reset taste profile" → toast appears; `localStorage.getItem("claude-feed-taste")` is gone; subsequent draws are cold/uniform again.

- [ ] **Step 4: Commit**

```bash
git add sim-shell.js
git commit -m "feat(feed): Taste Influence slider + Reset-taste in Settings (feed-gated)"
```

---

## Task 8: Final regression sweep + README note

**Files:**
- Modify: `README.md` (add a short "Discovery Feed" subsection near the sim-shell architecture notes).

- [ ] **Step 1: Standalone byte-for-byte check.** For each of the 6 sims, open `<sim>.html` (no query): toolbar has the original 7 FABs (no Back), Randomize randomizes locally, Settings has no "Feed" section, share link still works, console clean. Spot-check at least `boids`, `particle-life` (matrix rebuild), and `slime-mold`.

- [ ] **Step 2: Feed end-to-end check.** Open `feed.html`: confirm Task 6 Step 7 items 1–6 plus Task 7 still hold together. Confirm cross-sim into `particle-life` shows a coherent attraction-matrix sim (not a frozen/blank field) — proves `onRestoreDefaults` ran on apply and matrix rebuilt on cross-sim load.

- [ ] **Step 3: Add a README subsection.** Under the sim-shell architecture section, add:

```markdown
### Discovery Feed (`feed.html`)

`feed.html` is an invisible, chrome-less host (`feed.js`) that turns the sims into
a personal "scroll for fun" feed. It renders the current item in a full-screen
`<iframe src="<sim>.html?feed=1#<recipe>">` and keeps the next draw warm in a
second paused, off-screen iframe (cap: 2 live iframes) so cross-sim draws are a
flash-free hard cut; same-sim draws apply the recipe in place via `postMessage`.
The recipe is the existing share-hash payload (`base64(stateWithoutGlobal())`) —
no new format. Randomize and a new Back FAB forward intent to the host. Taste is
learned passively from dwell/fast-skip (per sim + per param-bucket, in
`localStorage`); a single "Taste influence" slider in Settings linearly blends the
learned draw toward uniform random. All of this lives behind a `?feed=1` flag in
`sim-shell.js`; a sim opened without the flag is unchanged. Tuning constants live
in `TUNING` at the top of `feed.js`.
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(feed): document the Discovery Feed host in the README"
```

---

## Self-Review (spec coverage)

- ONE new page, invisible iframe host → Task 3 (`feed.html`/`feed.js`). ✓
- Sim pages identical without `?feed=1`; every shell edit gated → Tasks 1,2,7 all behind `FEED`; Task 8 Step 1 verifies. ✓
- Recipe = existing `base64(stateWithoutGlobal())` → `encodeRecipe` mirrors `buildShareURL`; `loadFromHash`/`applyRecipe` consume it. No new format. ✓
- Cross-sim flash-free hard cut, next kept warm, cap 2 iframes, no crossfade → Task 6 (`prepareNext`/`revealCrossSim`/`hardCut`); opacity-0 warm frame; `destroyWarm` enforces the cap. ✓
- Same-sim apply in place via postMessage, no reload → Task 2 `applyRecipe` + Task 6 `goTo` same-sim branch. ✓
- One Back FAB, identical styling, no Forward → Task 1 (`.fab` reuse); Task 6 `onBack` pops history; randomize after back discards-ahead (no forward stack). ✓
- Single Taste Influence slider, 0%=uniform … 100%=full taste, linear blend → Task 5 `blendUniform`; Task 7 slider. Not an adventurousness model. ✓
- Passive learning (dwell + fast-skip) measured by host; per-(sim, param-bucket) in localStorage; sims need no telemetry → Task 4. ✓
- Tuning numbers as easily-changed constants → `TUNING` in `feed.js`; mirrored default in shell `readFeedInfluence`. ✓
- Static site, manual verification → every task ends in a browser check, not a test runner. ✓

**Open follow-up (for the post-v1 tuning round, not v1):** palette/pattern are currently drawn uniformly (taste is params + sim only, per spec's per-(sim,param-bucket) model); bucket granularity, dwell cap, skip threshold, history cap, default influence all live in `TUNING` for that round.
