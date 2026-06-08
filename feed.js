/* ============================================================================
 * feed.js — the invisible Discovery Feed host.
 *
 * Owns the durable state (history, taste model, sampler) and renders the
 * current item in a full-screen iframe (<sim>.html?feed=1#<recipe>). A second
 * paused, opacity-0 iframe keeps the next drawn item warm so a cross-sim draw is
 * a flash-free hard cut. Cap: 2 live iframes (the visible one + one warm
 * preload). Same-sim draws apply the recipe in place via postMessage — no
 * reload. The recipe is the existing share-hash payload — base64 of the sim's
 * stateWithoutGlobal() — so no new serialization is invented.
 *
 * The param manifest is harvested at runtime: each sim reports its own
 * modals.params ranges in its `ready` message, so the host never hand-maintains
 * per-sim ranges and they can't drift from the sims.
 *
 * Learning is passive (dwell, normalized to each viewer's own scroll pace),
 * measured here; the sims carry no telemetry code. The profile is per-(sim,
 * param-bucket) in localStorage. A
 * single "Taste influence" slider (in each sim's Settings, read here) linearly
 * blends the learned draw toward uniform random.
 *
 * The numbers in TUNING are starting guesses — wired as easily-changed
 * constants to dial in a later tuning round, not design decisions.
 * ========================================================================== */
(() => {
    "use strict";

    const TUNING = {
        HISTORY_CAP: 20, // back-stack depth
        DWELL_CAP_MS: 30000, // dwell saturates here
        DWELL_PRIOR_MS: 4000, // cold-start guess for a viewer's average dwell
        DWELL_AVG_DECAY: 0.95, // EMA decay for the per-viewer average dwell
        BUCKETS_PER_PARAM: 4, // taste granularity per param axis
        DEFAULT_INFLUENCE: 0.5, // Taste Influence slider default (0..1)
        DECAY: 0.9, // EMA decay applied to a score before adding reward
        SOFTMAX_TEMP: 1.5, // sharpness of the learned distribution
    };
    const FEED_SIMS = [
        "boids",
        "flow-field",
        "gravity",
        "particle-life",
        "reaction-diffusion",
        "slime-mold",
    ];

    const LS_TASTE = "claude-feed-taste";
    const LS_SETTINGS = "claude-feed-settings";

    const stage = document.getElementById("feed-stage");
    const randItem = (a) => a[Math.floor(Math.random() * a.length)];
    const encodeRecipe = (r) =>
        btoa(unescape(encodeURIComponent(JSON.stringify(r))));

    // Per-sim harvested manifest + default recipe template, cached across draws.
    // { simId: { manifest, template } }
    const manifests = {};

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
    const forward = []; // redo-stack: items backed away from, replayed by Next

    // ====================================================================
    // TASTE PROFILE (passive learning, persisted to localStorage)
    // ====================================================================
    function freshTaste() {
        // params keyed "sim|param" -> bucket array; dwellAvg is the running
        // average dwell used to normalize reward to this viewer's pace.
        return { sims: {}, params: {}, dwellAvg: TUNING.DWELL_PRIOR_MS };
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
        const live =
            !document.hidden && dwellStart ? performance.now() - dwellStart : 0;
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

    // Reward in [-1, 1], normalized to the viewer's own pace: an item watched
    // for the running-average dwell scores 0; an instant skip (dwell -> 0)
    // scores -1; anything at or above 2x the average saturates at +1. Relative
    // framing means fast and slow scrollers both yield a balanced signal
    // instead of being judged against one absolute threshold. Scores are an
    // EMA: score = score*DECAY + r.
    function rewardFor(ms, mean) {
        const m = Math.max(mean, 1); // guard divide-by-zero
        return Math.max(-1, Math.min(1, (ms - m) / m));
    }
    function commitDwell(item) {
        if (!item) return;
        const ms = dwellMs();
        const mean = taste.dwellAvg || TUNING.DWELL_PRIOR_MS;
        const r = rewardFor(ms, mean);
        // Fold this dwell into the running average AFTER scoring against it, so
        // the item is judged against prior habit, not partly against itself.
        taste.dwellAvg =
            mean * TUNING.DWELL_AVG_DECAY + ms * (1 - TUNING.DWELL_AVG_DECAY);
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

    // ====================================================================
    // SAMPLER (taste-weighted draw, linearly blended toward uniform)
    // ====================================================================
    function currentInfluence() {
        try {
            const s = JSON.parse(localStorage.getItem(LS_SETTINGS));
            if (s && typeof s.influence === "number")
                return Math.max(0, Math.min(1, s.influence));
        } catch (_) {}
        return TUNING.DEFAULT_INFLUENCE;
    }

    const haveAnyHistory = () => Object.values(taste.sims).some((v) => v !== 0);

    // softmax over scores -> probability array
    function softmax(scores) {
        const m = Math.max(...scores);
        const ex = scores.map((s) => Math.exp((s - m) * TUNING.SOFTMAX_TEMP));
        const sum = ex.reduce((a, b) => a + b, 0) || 1;
        return ex.map((e) => e / sum);
    }
    // Blend a learned distribution toward uniform by influence
    // (0 = uniform, 1 = learned).
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

    // Build a full, valid recipe by overlaying sampled values on the sim's own
    // default template (which carries any sim-specific fields, e.g. boids'
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

    function drawItem() {
        const sim = sampleSim();
        return { sim, recipe: synthesizeRecipe(sim) }; // recipe null until harvested
    }

    // ====================================================================
    // IFRAME LIFECYCLE
    // ====================================================================
    function makeFrame(item, paused) {
        const f = document.createElement("iframe");
        f.className = "feed-frame";
        const hash = item.recipe ? "#" + encodeRecipe(item.recipe) : "";
        f.src = `${item.sim}.html?feed=1${paused ? "&paused=1" : ""}${hash}`;
        stage.appendChild(f);
        return f;
    }

    function destroyWarm() {
        if (warm && warm.iframe) warm.iframe.remove();
        warm = null;
    }

    // Draw the upcoming item and warm a paused iframe ONLY when it's a different
    // sim than current (same-sim draws apply in place and need no second
    // iframe — this keeps live iframes <= 2).
    function prepareNext() {
        if (stopped) return;
        nextItem = drawItem();
        destroyWarm();
        if (nextItem.sim !== current.sim) {
            warm = { ...nextItem, iframe: null, ready: false };
            warm.iframe = makeFrame(warm, true); // paused, opacity-0
        }
    }

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
            warm = null; // consume; don't let prepareNext destroy it
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

    function pushHistory(item) {
        if (!item) return;
        history.push({ sim: item.sim, recipe: item.recipe });
        while (history.length > TUNING.HISTORY_CAP) history.shift();
    }

    // ====================================================================
    // MESSAGE PROTOCOL (sim -> host)
    // ====================================================================
    window.addEventListener("message", (e) => {
        const d = e.data;
        if (!d || typeof d !== "object" || !d.type) return;
        const src = e.source;
        if (d.type === "ready") onReady(src, d);
        else if (d.type === "resetTaste") onResetTaste();
        else if (d.type === "recipe") onRecipe(d);
    });

    function onReady(src, d) {
        // Cache the manifest the first time we see this sim.
        if (!manifests[d.sim]) {
            manifests[d.sim] = { manifest: d.manifest, template: d.recipe };
        }
        const slot =
            current && current.iframe && src === current.iframe.contentWindow
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
        // A cross-sim reveal that wasn't pre-warmed (e.g. Back) cuts over the
        // moment its frame is ready.
        if (pendingReveal && src === pendingReveal.iframe.contentWindow) {
            const inc = pendingReveal;
            pendingReveal = null;
            hardCut(inc);
        }
    }

    function onNext() {
        if (stopped) return;
        // After going Back, Next replays the exact item we backed away from
        // (moving "forward" through history) before drawing anything fresh.
        if (forward.length) {
            goTo(forward.pop(), true);
            return;
        }
        if (!nextItem) return;
        goTo(nextItem, true);
    }
    function onBack() {
        if (stopped || !history.length) return;
        // Stash the world we're leaving so Next can return to it.
        forward.push({ sim: current.sim, recipe: current.recipe });
        goTo(history.pop(), false);
    }
    function onResetTaste() {
        taste = freshTaste();
        saveTaste();
    }

    function takeControl() {
        if (stopped || !current || !current.iframe) return;
        // Commit the dwell accumulated so far, then stop measuring: the studio
        // session is off the books so a long edit can't saturate the signal.
        commitDwell(current);
        stopped = true;
        destroyWarm(); // the visible frame is never touched — it keeps running
        // Discard any in-flight cross-sim load too: otherwise its later `ready`
        // would hardCut over the world we just took control of and restart dwell.
        if (pendingReveal && pendingReveal.iframe) pendingReveal.iframe.remove();
        pendingReveal = null;
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

    // ====================================================================
    // BOOT — show one uniform-random item, then warm the next draw.
    // ====================================================================
    function startFeed() {
        current = { ...drawItem(), iframe: null, ready: false };
        current.iframe = makeFrame(current, false);
        current.iframe.classList.add("show");
        startDwell();
        prepareNext();

        document.getElementById("feed-back").addEventListener("click", onBack);
        document.getElementById("feed-next").addEventListener("click", onNext);
        document
            .getElementById("feed-take")
            .addEventListener("click", takeControl);
        document
            .getElementById("feed-return")
            .addEventListener("click", returnToExplore);
    }

    startFeed();
})();
