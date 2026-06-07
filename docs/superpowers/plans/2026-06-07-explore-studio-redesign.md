# Explore / Studio Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the one shared sim chrome into a lean-back **explore** mode (host-owned navigation, no world chrome) and a power **studio** mode (creative controls one click away), bridged in place — "take control" reveals studio around the still-running world with no reload, "return to explore" resumes the stream.

**Architecture:** The host (`feed.html` / `feed.js`) owns *stream* chrome (home, Back, Next, Take control, Return) and a `stopped` flag. The iframe (`sim-shell.js`) owns *world* chrome (creative launchers, operational toolbar, gear) and gains a runtime `mode` ('explore' | 'studio') replacing the boot-time `FEED` chrome gate. Two new host→sim messages (`takeControl`, `returnToExplore`) flip the mode without a reload; `returnToExplore` round-trips the iframe's current recipe back so the host's `current` stays truthful. No new serialization — the existing base64-of-`stateWithoutGlobal()` recipe carries state across the bridge.

**Tech Stack:** Vanilla ES (no build step, no module system), static HTML/CSS, `postMessage` host↔iframe protocol, `localStorage` persistence. Each sim is `<sim>.html` (e.g. `boids.html`) loading `sim-shell.js` + `<sim>.sim.js`; the spec's generic "`sim.html`" means any of these.

**Verification model:** This project has **no automated test runner** (only `playwright-core` for the OG-capture script). Per the project's established pattern, verification is **manual browser observation** against a local static server. Each task ends with a concrete "serve + observe" step listing exactly what to look for. Do not introduce a unit-test framework — that would be an unrequested restructure.

**Serving locally (used by every verification step):**
```bash
# from repo root, in a background terminal
python3 -m http.server 8000
# then open the URL named in the step, e.g. http://localhost:8000/feed.html
```
Use a desktop browser at a wide window for "desktop" checks and the browser devtools device-toolbar (or a window narrower than 720px) for "mobile" checks.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `feed.html` | Host page shell + stream chrome DOM/CSS | Add bottom stream bar (Back / Next-compass / Take control), a top-left "Return to explore" button, link `sim-shell.css` for `.fab` reuse, add `body.taken` styling |
| `feed.js` | Host state, sampler, taste, iframe lifecycle | Add `stopped` flag gating `prepareNext()`; wire host Back/Next/Take control/Return; bridge messages; adopt returned recipe; dwell commit/restart at the bridge |
| `sim-shell.js` | World chrome + sim runtime (one file, all sims) | `FEED` boot-constant → runtime `mode`; build both chrome sets at boot, reveal/hide by mode; `takeControl`/`returnToExplore` handlers; remove FEED Back FAB + FEED next-forward; promote Color/Shape/Parameters to direct launchers, Settings behind a gear; mode-gate keyboard; mobile modeless tray; `dragQuery` change listener |
| `sim-shell.css` | World chrome styling (shared by sims **and** now the host) | `.mode-explore` hides world chrome; direct-launcher cluster layout; gear; mobile modeless tray presentation of the existing `.modal` bodies |

No new files. No new serialization. No change to `*-explained.html`, the taste-learning math in `feed.js`, or `index.html` wayfinding.

---

## Task 1: Host stream chrome DOM (`feed.html`)

Add the host-owned navigation that explore needs, reusing the sim's `.fab` styling. No host *behavior* yet (Task 2 wires clicks) — this task is pure markup + CSS so the buttons render correctly. The iframe still shows its own toolbar at this point (temporary double-chrome; removed in Task 4).

**Files:**
- Modify: `feed.html` (head `<link>`, `<style>`, `<body>`)

- [ ] **Step 1: Link `sim-shell.css` so host buttons reuse `.fab`**

In `feed.html` head, after the existing `tokens.css` link (line 16), add the shell stylesheet:

```html
        <link rel="stylesheet" href="tokens.css" />
        <link rel="stylesheet" href="sim-shell.css" />
```

- [ ] **Step 2: Add stream-bar + return-button CSS**

Append these rules inside the existing `<style>` block in `feed.html`, just before its closing `</style>` (after the `.feed-home` rules around line 95). The bottom bar is centered (distinct from the sim's bottom-right `.fab-toolbar`), and `body.taken` flips which chrome shows:

```css
            /* Bottom stream bar: Back / Next (compass) / Take control. Host-
               owned; explore only. Buttons reuse .fab from sim-shell.css. */
            .feed-bar {
                position: fixed;
                bottom: max(20px, env(safe-area-inset-bottom, 0px));
                left: 50%;
                transform: translateX(-50%);
                z-index: 10;
                display: flex;
                align-items: center;
                gap: 12px;
            }
            .feed-bar .label {
                /* optional text beside Take control; icon-only by default */
                display: none;
            }

            /* Top-left "Return to explore", studio only, hidden until taken. */
            .feed-return {
                position: fixed;
                top: max(20px, env(safe-area-inset-top, 0px));
                left: max(20px, env(safe-area-inset-left, 0px));
                z-index: 10;
                display: none;
                align-items: center;
                gap: 8px;
                height: 50px;
                padding: 0 16px;
                border-radius: 999px;
                background: var(--glass-bg);
                -webkit-backdrop-filter: var(--glass-blur);
                backdrop-filter: var(--glass-blur);
                border: 1px solid var(--glass-border);
                color: var(--ink);
                font-family: var(--font-sans);
                font-size: 13px;
                font-weight: 600;
                letter-spacing: -0.01em;
                white-space: nowrap;
                cursor: pointer;
                box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
            }
            .feed-return:hover {
                background: var(--glass-bg-strong);
            }

            /* Taken control: hide explore chrome, show the return affordance. */
            body.taken .feed-home,
            body.taken .feed-bar {
                display: none;
            }
            body.taken .feed-return {
                display: flex;
            }
```

- [ ] **Step 3: Add the stream-bar and return-button markup**

In `feed.html` body, after the existing `.feed-home` anchor (closes at line 105) and before `<div id="feed-stage">`, add the new chrome. The compass and take-control glyphs are drawn inline:

```html
        <a
            class="feed-return"
            id="feed-return"
            role="button"
            tabindex="0"
            aria-label="Return to explore"
        >
            <svg class="mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg><span>Explore</span>
        </a>

        <div class="feed-bar" id="feed-bar">
            <button class="fab" id="feed-back" title="Back" aria-label="Back">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button class="fab fab-primary" id="feed-take" title="Take control" aria-label="Take control">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="8" r="2.5" fill="rgba(20,25,35,0.95)"/><circle cx="15" cy="16" r="2.5" fill="rgba(20,25,35,0.95)"/></svg>
                <span class="label">Take control</span>
            </button>
            <button class="fab" id="feed-next" title="Next" aria-label="Next">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 10.5 10.5 8.5 15.5 13.5 13.5" fill="currentColor" stroke="none"/></svg>
            </button>
        </div>
```

- [ ] **Step 4: Verify markup renders**

Run: serve, open `http://localhost:8000/feed.html`.
Expected: a sim runs full-screen. Top-left shows the "Tiny Worlds" home pill. Bottom-center shows three round glass buttons — a back chevron, a highlighted (accent) take-control faders icon, and a compass. The iframe's own bottom-right toolbar is also still visible (expected here; removed in Task 4). No console errors.

- [ ] **Step 5: Commit**

```bash
git add feed.html
git commit -m "feat(feed): host stream-bar chrome (Back / Next-compass / Take control) + return affordance"
```

---

## Task 2: Host stream behavior + bridge driver (`feed.js`)

Wire the host buttons, add the `stopped` flag, and implement the take-control / return round-trip from the host side. The sim side of the bridge lands in Task 3; until then, take control posts a message the iframe ignores (harmless — verify only the host-side state changes here).

**Files:**
- Modify: `feed.js` (state declarations ~line 59, message handler ~337, `prepareNext` ~269, boot ~389)

- [ ] **Step 1: Add the `stopped` flag beside the other slots**

In `feed.js`, in the slot declarations (currently lines 59–64), add `stopped`:

```javascript
    // current/warm slots: { sim, recipe, iframe, ready }. nextItem: {sim,recipe}.
    let current = null;
    let warm = null;
    let nextItem = null;
    // When true the host is no longer a stream (the viewer took control of the
    // current world in studio); prepareNext() is a no-op until return.
    let stopped = false;
    // A cross-sim reveal awaiting an iframe's `ready` before the hard cut.
    let pendingReveal = null;
    const history = []; // back-stack of past items {sim, recipe}
```

- [ ] **Step 2: Gate `prepareNext()` on `stopped`**

Modify `prepareNext()` (currently line 269) to bail when stopped:

```javascript
    function prepareNext() {
        if (stopped) return;
        nextItem = drawItem();
        destroyWarm();
        if (nextItem.sim !== current.sim) {
            warm = { ...nextItem, iframe: null, ready: false };
            warm.iframe = makeFrame(warm, true); // paused, opacity-0
        }
    }
```

- [ ] **Step 3: Add take-control / return / recipe-reply functions**

Add these functions just after `onResetTaste()` (currently ends line 384). `takeControl` commits the in-progress dwell, stops the stream, tears down the warm frame, swaps the top-left affordance, and tells the iframe to reveal studio. `returnToExplore` asks the iframe for its current recipe; the reply (`onRecipe`) adopts it, clears `stopped`, restarts dwell, and resumes drawing:

```javascript
    function takeControl() {
        if (stopped || !current || !current.iframe) return;
        // Commit the dwell accumulated so far, then stop measuring: the studio
        // session is off the books so a long edit can't saturate the signal.
        commitDwell(current);
        stopped = true;
        destroyWarm(); // the visible frame is never touched — it keeps running
        document.body.classList.add("taken");
        current.iframe.contentWindow.postMessage({ type: "takeControl" }, "*");
    }

    function returnToExplore() {
        if (!stopped || !current || !current.iframe) return;
        // Ask the iframe to hide studio chrome and reply with its edited recipe.
        current.iframe.contentWindow.postMessage(
            { type: "returnToExplore" },
            "*",
        );
    }

    // The iframe's reply to returnToExplore: adopt its (possibly edited) recipe
    // as `current` so Back/history replay the world the viewer actually shaped,
    // then resume the stream with a fresh dwell.
    function onRecipe(d) {
        if (!stopped || !current) return;
        if (d.recipe) current.recipe = d.recipe;
        stopped = false;
        document.body.classList.remove("taken");
        startDwell();
        prepareNext();
    }
```

- [ ] **Step 4: Route the `recipe` reply in the message handler**

In the `window.addEventListener("message", ...)` block (currently lines 337–345), add a `recipe` case:

```javascript
    window.addEventListener("message", (e) => {
        const d = e.data;
        if (!d || typeof d !== "object" || !d.type) return;
        const src = e.source;
        if (d.type === "ready") onReady(src, d);
        else if (d.type === "next") onNext();
        else if (d.type === "back") onBack();
        else if (d.type === "resetTaste") onResetTaste();
        else if (d.type === "recipe") onRecipe(d);
    });
```

- [ ] **Step 5: Wire the host buttons at boot**

In `startFeed()` (currently lines 389–395), after `prepareNext();`, attach the host-button listeners. Back/Next call `onBack`/`onNext` directly (no postMessage round-trip); Take control / Return drive the bridge:

```javascript
    function startFeed() {
        current = { ...drawItem(), iframe: null, ready: false };
        current.iframe = makeFrame(current, false);
        current.iframe.classList.add("show");
        startDwell();
        prepareNext();

        document
            .getElementById("feed-back")
            .addEventListener("click", onBack);
        document
            .getElementById("feed-next")
            .addEventListener("click", onNext);
        document
            .getElementById("feed-take")
            .addEventListener("click", takeControl);
        const ret = document.getElementById("feed-return");
        ret.addEventListener("click", returnToExplore);
        ret.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                returnToExplore();
            }
        });
    }
```

- [ ] **Step 6: Verify host-side navigation and the take-control state swap**

Run: serve, open `http://localhost:8000/feed.html`.
Expected:
- Clicking the bottom-center **compass (Next)** advances to a new world; the **back chevron** returns to the previous one. (These now work via the host directly.)
- Clicking **Take control** (faders): the top-left swaps from "Tiny Worlds" to an "Explore" return pill, and the bottom stream bar disappears. The world keeps running (no blink/reseed). The iframe's own bottom-right toolbar is still visible (its studio reveal lands in Task 3).
- Clicking **Explore** (return): the home pill and stream bar come back; compass/back work again.
- In devtools, after Take control, confirm no new warm iframe is created (only the visible one remains under `#feed-stage`).

- [ ] **Step 7: Commit**

```bash
git add feed.js
git commit -m "feat(feed): stopped flag + take-control/return bridge driver, host-direct Back/Next"
```

---

## Task 3: `FEED` → runtime `mode` + bridge handlers (`sim-shell.js`, `sim-shell.css`)

Turn the boot-time `FEED` chrome gate into a runtime `mode`. Both chrome sets are built at boot (they already are — `CHROME_HTML` is injected unconditionally at line 600); explore simply *hides* world chrome via a body class. Add the `takeControl` / `returnToExplore` handlers that flip the mode and round-trip the recipe.

**Files:**
- Modify: `sim-shell.js` (FEED decl ~596, FEED message handler ~1616, boot ~1945)
- Modify: `sim-shell.css` (new `.mode-explore` rules)

- [ ] **Step 1: Introduce the runtime `mode` beside `FEED`**

In `sim-shell.js`, where `FEED`/`BOOT_PAUSED` are declared (lines 595–597), add a runtime mode and an `applyMode()` helper. `FEED` still means "embedded in the host"; `mode` is what chrome shows. A page without `?feed=1` boots straight to studio (its only mode):

```javascript
        const _q = new URLSearchParams(location.search);
        const FEED = _q.has("feed");
        const BOOT_PAUSED = _q.has("paused");
        // Runtime chrome mode. Embedded feed iframes start lean-back (explore,
        // no world chrome); a direct/standalone sim is always studio.
        let mode = FEED ? "explore" : "studio";
        function applyMode() {
            document.body.classList.toggle("mode-explore", mode === "explore");
            document.body.classList.toggle("mode-studio", mode === "studio");
        }
```

- [ ] **Step 2: Apply the mode at boot**

In the boot sequence near `if (FEED && BOOT_PAUSED) playing = false;` (line 1945), call `applyMode()`:

```javascript
        if (FEED && BOOT_PAUSED) playing = false;
        applyMode();
        updatePauseButton();
```

- [ ] **Step 3: Hide world chrome in explore (CSS)**

In `sim-shell.css`, after the hide-UI block (ends line 374), add explore-mode hiding. Explore shows *no* world chrome — only the host's overlay is visible:

```css
/* ---------- Explore mode (embedded in the feed host) ---------- */
/* The host owns all stream chrome; in explore the iframe shows only the bare
   canvas. The full world chrome is built but hidden until "take control". */
body.mode-explore .fab-toolbar,
body.mode-explore .settings-menu {
    display: none !important;
}
```

- [ ] **Step 4: Add the bridge handlers to the FEED message listener**

In the `if (FEED) { window.addEventListener("message", ...) }` block (lines 1616–1634), add `takeControl` and `returnToExplore`. The latter replies with the same recipe payload shape the `ready` message already sends:

```javascript
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
                } else if (d.type === "takeControl") {
                    mode = "studio";
                    applyMode();
                } else if (d.type === "returnToExplore") {
                    mode = "explore";
                    applyMode();
                    parent.postMessage(
                        { type: "recipe", recipe: stateWithoutGlobal() },
                        "*",
                    );
                }
            });
        }
```

- [ ] **Step 5: Verify the full bridge end-to-end**

Run: serve, open `http://localhost:8000/feed.html`.
Expected:
- On load, the feed iframe shows **no** bottom-right toolbar and **no** top-right cog (world chrome hidden). Only the host's home pill + bottom stream bar are visible. (The temporary double-chrome from Tasks 1–2 is gone.)
- Click **Take control**: the iframe's world chrome appears (cog/launchers + bottom-right toolbar) around the still-running world. Host top-left now reads "Explore".
- Click **Explore**: the world chrome disappears, the stream bar returns, and the world continues unchanged. Advance with the compass — the world you returned from is what **Back** now returns to (recipe adopted).
- Open a standalone sim `http://localhost:8000/boids.html`: full studio chrome shows immediately, top-left is the normal "Tiny Worlds" home pill. No console errors.

- [ ] **Step 6: Commit**

```bash
git add sim-shell.js sim-shell.css
git commit -m "feat(sims): runtime explore/studio mode + takeControl/returnToExplore bridge"
```

---

## Task 4: Remove FEED Back FAB and FEED next-forwarding (`sim-shell.js`)

Navigation is now host-owned and direct, so the iframe's FEED-gated Back FAB and the `fab-randomize` next-forward branch are dead paths. Remove them; the studio reroll always takes the local true-random path (the dice).

**Files:**
- Modify: `sim-shell.js` (FEED Back FAB ~1523, randomize FEED branch ~1548)

- [ ] **Step 1: Delete the FEED Back FAB block**

Remove the entire block at lines 1522–1537:

```javascript
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

Replace it with a one-line comment marking the ownership move:

```javascript
        // Back/Next are host-owned in the feed now; the iframe has no Back FAB.
```

- [ ] **Step 2: Remove the FEED next-forward branch in `fab-randomize`**

In the `fabRandomize` click handler (lines 1541–1576), delete the FEED branch (lines 1546–1551) so the reroll always runs the local true-random path:

```javascript
        const fabRandomize = byId("fab-randomize");
        fabRandomize.addEventListener("click", () => {
            fabRandomize.classList.remove("spin");
            void fabRandomize.offsetWidth;
            fabRandomize.classList.add("spin");

            sim.randomize();
            applyParamsToSliders();
```

(The rest of the handler — palette/pattern randomize, persist — is unchanged.)

- [ ] **Step 3: Verify studio reroll is a local true reroll**

Run: serve, open `http://localhost:8000/feed.html`, **Take control**, then click the bottom-right **dice** (randomize, the accent button).
Expected: the **same** sim rerolls to new random parameters/colors in place (no cross-sim jump, no host draw). There is no Back chevron inside the iframe toolbar. Standalone `boids.html` randomize still works as before.

- [ ] **Step 4: Commit**

```bash
git add sim-shell.js
git commit -m "refactor(sims): drop FEED Back FAB and next-forward; studio reroll is always local"
```

---

## Task 5: Mode-gate keyboard shortcuts (`sim-shell.js`)

Space / H / Esc are world-chrome shortcuts. In explore the world is shown bare and the viewer's focus moves into the iframe when they poke it, so these would fire over chrome explore doesn't show. Gate them: inert in explore, live in studio.

**Files:**
- Modify: `sim-shell.js` (keydown handler ~1819)

- [ ] **Step 1: Bail out of the keydown handler in explore**

Modify the handler (lines 1819–1831) to return early unless in studio:

```javascript
        document.addEventListener("keydown", (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
                return;
            // Chrome shortcuts are studio-only. In explore the world is bare and
            // these would fire over chrome that isn't shown.
            if (mode !== "studio") return;
            if (e.key === "Escape") {
                closeAllModals();
                closeDropdown();
            } else if (e.key === "h" || e.key === "H") toggleUI();
            else if (e.key === " ") {
                e.preventDefault();
                playing = !playing;
                updatePauseButton();
            }
        });
```

- [ ] **Step 2: Verify the gate flips with mode**

Run: serve, open `http://localhost:8000/feed.html`. Click the canvas once (move focus into the iframe), then press **Space** and **H**.
Expected (explore): nothing happens — the sim keeps running, no controls toggle. Now **Take control**, press **Space**: the sim pauses; press **H**: chrome hides (press **H** again to restore). On standalone `boids.html`, Space/H/Esc work as before.

- [ ] **Step 3: Commit**

```bash
git add sim-shell.js
git commit -m "feat(sims): mode-gate Space/H/Esc shortcuts (inert in explore, live in studio)"
```

---

## Task 6: Direct creative launchers + Settings behind a gear (`sim-shell.js`, `sim-shell.css`)

The "buried controls" fix: Color / Shape / Parameters become always-visible direct launchers (no cog→dropdown in front), and Settings moves behind a gear that opens the Settings modal directly. The dropdown mechanism is removed.

**Files:**
- Modify: `sim-shell.js` (`CHROME_HTML` settings-menu ~324–364, dropdown logic ~1785–1814, `openModal`/`refreshDropdownActive` ~797–824)
- Modify: `sim-shell.css` (settings-menu / dropdown rules ~244–333)

- [ ] **Step 1: Restructure the `settings-menu` markup into direct launchers + gear**

Replace the entire `settings-menu` block in `CHROME_HTML` (lines 324–364) with three direct `data-modal` launchers (color / pattern / params) followed by a gear that opens `data-modal="settings"`. The faders icon stays on Parameters; the gear glyph (the existing `M19.4 15…` path) moves onto Settings:

```javascript
        <div class="settings-menu" id="settings-menu">
            <button class="fab launcher" id="launch-color" data-modal="color" title="Color" aria-label="Color">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 3a9 9 0 1 0 0 18 1.5 1.5 0 0 0 1.5-1.5c0-.4-.15-.78-.43-1.06A1.5 1.5 0 0 1 14.13 16h2.37A4.5 4.5 0 0 0 21 11.5C21 7 16.97 3 12 3z" />
                    <circle cx="8" cy="11" r="1" fill="currentColor" />
                    <circle cx="11" cy="7" r="1" fill="currentColor" />
                    <circle cx="15" cy="7" r="1" fill="currentColor" />
                    <circle cx="17" cy="11" r="1" fill="currentColor" />
                </svg>
            </button>
            <button class="fab launcher" id="launch-pattern" data-modal="pattern" title="Shape" aria-label="Shape">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
                    <rect x="4" y="4" width="11" height="11" rx="1.5" />
                    <circle cx="15" cy="15" r="5.5" />
                </svg>
            </button>
            <button class="fab launcher" id="launch-params" data-modal="params" title="Parameters" aria-label="Parameters">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                    <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
                    <circle cx="9" cy="6" r="2.5" fill="rgba(20,25,35,0.95)" />
                    <circle cx="16" cy="12" r="2.5" fill="rgba(20,25,35,0.95)" />
                    <circle cx="7" cy="18" r="2.5" fill="rgba(20,25,35,0.95)" />
                </svg>
            </button>
            <button class="fab" id="settings-trigger" data-modal="settings" title="Settings" aria-label="Settings">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
            </button>
        </div>
```

- [ ] **Step 2: Remove the dropdown open/close logic**

Replace the DROPDOWN MENU block (lines 1785–1814) — `openDropdown`/`closeDropdown`/`settingsTrigger` toggle/outside-click — with no-op-safe stubs so the rest of the file (which calls `closeDropdown()` in `openModal` and the keyboard handler) keeps working without a dropdown:

```javascript
        // DROPDOWN MENU — removed. Color/Shape/Parameters are now direct
        // launchers and Settings opens via the gear (all use [data-modal]
        // wiring below). closeDropdown() is kept as a no-op so existing callers
        // (openModal, the keyboard handler) need no changes.
        function closeDropdown() {}
```

- [ ] **Step 3: Drop the `closeDropdown()` call and dropdown-active sync from `openModal`**

`openModal` (line 807) calls `closeDropdown()` (now a harmless no-op — leave it) and `refreshDropdownActive()`. Repoint the active-state sync from `.dropdown-item` to `.launcher`. Update `refreshDropdownActive` (lines 797–805):

```javascript
        function refreshDropdownActive() {
            document.querySelectorAll(".launcher, #settings-trigger").forEach(
                (f) => {
                    const m = byId("modal-" + f.dataset.modal);
                    f.classList.toggle(
                        "active",
                        !!(m && m.classList.contains("open")),
                    );
                },
            );
        }
```

- [ ] **Step 4: Restyle the cluster — launchers always visible, drop the fan-out animation**

In `sim-shell.css`, replace the dropdown rules. The `.menu-dropdown` fan-out (lines 266–333, which animated items out of the cog) is gone. Replace the `.dropdown-item` rules with `.launcher` rules that are always visible, and keep the gear's `.active` affordance. Replace lines 265–333 (`.menu-dropdown` through the end of the `.dropdown-item` rules) with:

```css
/* Creative launchers — always visible, stacked above the gear. */
.launcher {
    /* inherits .fab sizing/glass; no extra rules needed for the resting state */
}
.launcher.active,
#settings-trigger.active {
    background: var(--glass-bg-strong);
    color: #fff;
    border-color: rgba(var(--accent-rgb), 0.45);
}
#settings-trigger svg {
    transition: transform 0.3s ease;
}
#settings-trigger.active svg {
    transform: rotate(60deg);
}
```

(The `.settings-menu` flex-column container rules at lines 244–253 are unchanged and already stack its children top-to-bottom, right-aligned.)

- [ ] **Step 5: Verify launchers open directly and the gear opens Settings**

Run: serve, open `http://localhost:8000/boids.html` on a **wide desktop** window.
Expected: top-right shows four stacked round buttons — color, shape, faders (Parameters), gear (Settings) — all visible at rest (no cog to expand first). Clicking each opens its floating window in one action; the launcher shows an active state while open. Parameters keeps the faders icon; Settings is the gear. Dragging a floating window still works. No console errors. Now open `feed.html`, **Take control**: the same four launchers appear.

- [ ] **Step 6: Commit**

```bash
git add sim-shell.js sim-shell.css
git commit -m "feat(sims): direct Color/Shape/Parameters launchers, Settings behind a gear"
```

---

## Task 7: Mobile modeless tray + `dragQuery` change listener (`sim-shell.css`, `sim-shell.js`)

On mobile the three launchers open a **modeless** inline tray — a CSS presentation of the existing `.modal` bodies anchored above the launcher bar, with no dimming backdrop, so the world stays visible and pokeable. No second render target. Also fix the latent bug where crossing the 720px boundary doesn't re-sync `body.floating-windows`.

**Files:**
- Modify: `sim-shell.css` (mobile `@media (max-width: 719px)` block ~451–465, backdrop)
- Modify: `sim-shell.js` (`dragQuery` setup ~740–743, `floating-windows` toggle ~845)

- [ ] **Step 1: Present the mobile modal as a tray above the launchers (no backdrop)**

In `sim-shell.css`, inside the existing `@media (max-width: 719px)` block (lines 451–465), the modal is a bottom sheet. Add modeless-tray rules that anchor it just above the bottom of the launcher cluster and disable the dimming backdrop on mobile. Append to that media block:

```css
@media (max-width: 719px) {
    /* (existing .modal bottom-sheet rules stay above this) */

    /* Modeless tray: anchored above the launcher bar, world stays pokeable.
       Same .modal DOM, re-presented — no second render target. */
    .modal {
        bottom: calc(
            var(--fab-size) + 36px + env(safe-area-inset-bottom, 0px)
        );
        left: 12px;
        right: 12px;
        border-radius: 18px;
        max-height: 60vh;
    }
    /* Modeless: the backdrop never dims or captures the pointer on mobile, so
       taps fall through to the world. Collapse is explicit (re-tap a launcher
       or the modal's close button). */
    .backdrop.open {
        background: rgba(0, 0, 0, 0);
        pointer-events: none;
    }
}
```

- [ ] **Step 2: Keep `body.floating-windows` in sync across the 720px boundary**

In `sim-shell.js`, where `body.floating-windows` is toggled once (line 845), add a `dragQuery` change listener so resizing/rotating across 720px updates it (the latent bug the tray makes visible). Replace line 845:

```javascript
        document.body.classList.toggle("floating-windows", floating());
        dragQuery.addEventListener("change", () => {
            document.body.classList.toggle("floating-windows", floating());
            // Drop any inline floating positions when leaving floating mode so
            // the mobile tray/bottom-sheet presentation takes over cleanly.
            if (!floating()) {
                document.querySelectorAll(".modal").forEach((m) => {
                    m.style.left = "";
                    m.style.top = "";
                    m.style.right = "";
                    m.style.bottom = "";
                    m.style.transform = "";
                    delete m.dataset.placed;
                });
            }
        });
```

- [ ] **Step 3: Verify the mobile tray is modeless and one-at-a-time**

Run: serve, open `http://localhost:8000/boids.html` in the devtools **device toolbar** (or a window < 720px wide).
Expected:
- Tap **Parameters**: a panel rises as a tray above the launcher bar with the sliders. The world behind is **not** dimmed and stays visible.
- Tap on the **world** (not the tray): the sim responds to the poke (pointer falls through — no backdrop blocking).
- Tap **Color**: the Parameters tray closes and Color opens (one-at-a-time preserved).
- Re-tap the open launcher (or its close button): the tray collapses.
- Resize the window across 720px in both directions a few times, opening a panel after each: it presents correctly as floating window (wide) vs. tray (narrow) each time, with no stuck/duplicated panels. No console errors.

- [ ] **Step 4: Commit**

```bash
git add sim-shell.css sim-shell.js
git commit -m "feat(sims): modeless mobile control tray + 720px floating-windows resync"
```

---

## Task 8: Final integration pass + glyph polish

Tie it together: confirm the whole explore→studio→explore loop, sharing, and dwell behavior, and refine the two new host glyphs (compass, take-control) for clarity. Sharing requires **no code change** (verify only).

**Files:**
- Modify: `feed.html` (refine compass / take-control SVGs only if Step 1 finds them unclear)

- [ ] **Step 1: Verify sharing copies a clean studio URL**

Run: serve, open `http://localhost:8000/feed.html`, **Take control**, click the bottom-right **share** FAB, then paste the clipboard somewhere.
Expected: the copied URL is `http://localhost:8000/boids.html#<hash>` (or whichever sim) — clean `sim.html` form, **no** `?feed=1`, even though the address bar still reads `feed.html`. Opening that URL in a new tab loads the standalone sim in studio with the shared world. (This works because `buildShareURL()` uses `location.pathname` only — no change needed.)

- [ ] **Step 2: Verify dwell commits at take control and restarts on return**

Run: serve, open `http://localhost:8000/feed.html` with devtools console open. Add a temporary log to confirm, then remove it:
- Temporarily, in `feed.js` `commitDwell`, add `console.log("commitDwell", item && item.sim, dwellMs());` as the first line after the `if (!item) return;` guard.
- Reload, watch one world for a few seconds, click **Take control**.

Expected: a `commitDwell` line logs **once** at take control with a non-trivial dwell. Edit the world for 30+ seconds, **Return to explore** — no `commitDwell` fires during the studio session (the long edit can't saturate the signal). After return, advancing with the compass logs a fresh `commitDwell` for the now-edited world.
Then **remove the temporary `console.log`** and reload to confirm it's gone.

- [ ] **Step 3: Verify the full bridge loop once more, all five sims**

Run: serve, open `http://localhost:8000/feed.html`.
Expected, for several compass-advances spanning different sims (boids, flow-field, particle-life, reaction-diffusion, slime-mold):
- Explore shows only host chrome (home pill + stream bar), world edge-to-edge, pointer pokes the world.
- Take control reveals studio chrome around the *same* running world (no reseed); launchers + gear + toolbar present.
- Return resumes the stream at that world; Back returns to it with edits intact.
- No console errors on any sim.

- [ ] **Step 4: Refine the compass / take-control glyphs if needed**

If Step 3 showed either host glyph reading ambiguously (e.g. the take-control faders looking too much like the Parameters launcher, or the compass needle unclear), adjust the inline SVGs in `feed.html` (`#feed-next`, `#feed-take`). Keep them single-purpose and distinct from the studio dice and Parameters icons. Example clearer take-control glyph (a pointer entering a frame) if the faders read poorly:

```html
            <button class="fab fab-primary" id="feed-take" title="Take control" aria-label="Take control">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h6M4 4v6M20 20h-6M20 20v-6"/><path d="M9 13l4 4 1-3 3-1z" fill="currentColor" stroke="none"/></svg>
            </button>
```

Re-verify the affected page renders the new glyph after any change.

- [ ] **Step 5: Commit (only if Step 4 changed a glyph)**

```bash
git add feed.html
git commit -m "polish(feed): clearer compass / take-control glyphs"
```

---

## Self-Review Notes (for the implementer)

- **Copy is an open decision (owner's call).** The spec leaves final labels to the owner: "Take control" vs. "Tweak it" vs. "Open studio"; "Explore" vs. "Back to the stream"; and whether Take control carries a text label (the `.feed-bar .label` rule defaults it to hidden). Don't invent final copy — keep the working strings and flag the choice to the owner. Voice constraint: calm, no-hype, **no em/en-dashes**.
- **Out of scope (do not add):** timed auto-advance in explore; keyboard stream navigation (arrows for Back/Next); `history.pushState` to sync the address bar; treating take-control as an explicit stronger-than-dwell signal; any change to the taste-learning math or `*-explained.html`.
- **Tray animation mechanism** (CSS max-height vs. measured px) is an impl detail, not a design decision — the plan uses simple positioning; refine only if the collapse feels abrupt.
- **`closeDropdown()` stub:** kept deliberately as a no-op so the Esc keyboard branch and `openModal` need no edits. Don't delete its remaining callers.
