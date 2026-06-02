/* ============================================================================
 * sim-shell.js — the shared chrome + the shell↔sim contract
 * ============================================================================
 *
 * claude-pages is a set of single-canvas sims that all share the same chrome:
 * a settings cogwheel + dropdown, a FAB toolbar (record / share / hide-UI /
 * speed / reset / pause / randomize), a recording indicator, a hide banner,
 * and four modals (Color, Shape, Parameters, Settings) with desktop floating-
 * window + mobile bottom-sheet behavior. All of that — DOM, styling hooks,
 * persistence, share links, recording, the rAF loop — lives here. A sim is just
 * a state object + a config describing its modals + a few callbacks.
 *
 * Build-free: this file is plain JS served as-is. No bundler, no modules.
 * It exposes one global: `SimShell`, with `SimShell.registerSim(sim)`.
 *
 * ----------------------------------------------------------------------------
 * THE CONTRACT (this is what the other sims inherit — keep it stable)
 * ----------------------------------------------------------------------------
 *
 * A sim object passed to registerSim(sim):
 *
 *   sim.state            REQUIRED. The single JSON-serializable state object.
 *                        The shell reads AND writes it directly (persistence +
 *                        share links serialize exactly this). Must stay plain
 *                        data — no functions, no typed arrays, no DOM refs.
 *                        Conventionally shaped as:
 *                          { params:{...}, pattern:{...}, palette:{...},
 *                            settings:{...} }
 *                        but the shell only hard-depends on `state.settings`
 *                        (see the settings keys the toolbar/loop read below).
 *
 *   sim.defaultState     OPTIONAL. A pristine snapshot used by "Restore default
 *                        settings". If omitted, the shell snapshots sim.state
 *                        at registration time.
 *
 *   sim.config           REQUIRED. Declarative description of the modals:
 *     .keys              OPTIONAL { ls, win } — localStorage keys. Defaults to
 *                        derive from sim.id. Gravity passes its legacy keys.
 *     .modals.color      { intro?, paletteRegistry, presetToCustom(stops),
 *                          generateCustomStops(custom) } — the shell tracks
 *                          mode/name/custom in state.palette directly and never
 *                          calls getter functions on colorCfg. See "color modal"
 *                          notes below. Two OPTIONAL, additive, backward-
 *                          compatible fields: `legendHTML` overrides the default
 *                          Slow/Fast legend markup, and `extra` { render(host),
 *                          sync() } injects sim-specific content into the Custom
 *                          section (host) — render() is called once when the
 *                          modal is built, sync() after every palette change and
 *                          on initial sync. particle-life uses these to render
 *                          its #type-swatches row. Sims that set neither (gravity/
 *                          boids/flow-field) are completely unaffected.
 *     .modals.shape      { title, intro?, chipLabel?, chips (registry),
 *                          getName(), onSelect(id), onRandomize?(), regionSlider?
 *                          {label,min,max,step,fmt,get,set,visibleFor(id)} }
 *                          Optional SECOND control axis (a sim may need a second
 *                          chip row + a slider gated by it — e.g. boids' heading
 *                          direction): secondaryChips? {label, chips (registry),
 *                          getName(), onSelect(id)} and secondarySlider? {label,
 *                          min,max,step,fmt,get,set,visibleFor(secondaryId)}.
 *                          Sims that omit these (e.g. gravity) are unaffected.
 *     .modals.params     { title, intro?, controls:[ {type:'slider', key, group,
 *                          label, hint, min, max, step, fmt, get(), set(v),
 *                          onApply?(v)} ] }
 *     .modals.settings   { sections:[ {label, controls:[...], hint?} ] } where a
 *                          control is {type:'slider'|'toggle', ...} like params.
 *                          The shell auto-appends the standard "Randomize
 *                          behavior", "Sharing tools" and "Restore" sections,
 *                          so a sim only lists its own (Simulation/Performance)
 *                          sections. The randomize/sharing toggles bind to fixed
 *                          state.settings keys (see below).
 *
 *   sim.init(ctx)        REQUIRED. Called once after chrome is built and the
 *                        canvas is sized. Do canvas/buffer setup + initial seed
 *                        here. `ctx` shape documented below.
 *   sim.step()           REQUIRED. Advance the simulation one fixed timestep.
 *                        The shell's rAF loop drives a fixed-timestep
 *                        accumulator and calls step() 0..N times per rendered
 *                        frame (0 while paused), so motion stays constant
 *                        regardless of render FPS. Sims never call rAF.
 *   sim.render()         REQUIRED. Draw the current state to the canvas. Called
 *                        once per rendered frame (capped by the FPS setting).
 *   sim.reset()          REQUIRED. Re-seed / restart the simulation.
 *   sim.randomize()      REQUIRED. Randomize the sim's own params (NOT palette/
 *                        pattern — the shell handles those via settings toggles,
 *                        calling sim.refreshPalette / sim.reset as needed).
 *                        Return value ignored.
 *   sim.onRestoreDefaults()  OPTIONAL. Called by the shell during "Restore
 *                        default settings", AFTER state is reset to defaults and
 *                        BEFORE syncColorControls / applyPalette / reset. Use it
 *                        to rebuild NON-COLOR derived state that depends on
 *                        state.params (e.g. interaction matrices, species
 *                        assignments). Do NOT rebuild per-species colors or
 *                        repaint swatches here — the downstream applyPalette()
 *                        → refreshPalette() → colorCfg.extra.sync() sequence
 *                        handles all color/swatch work. Sims that omit this hook
 *                        (gravity, boids, flow-field) are completely unaffected.
 *   sim.refreshPalette(stops)  REQUIRED. Rebuild color LUTs from an array of hex
 *                        stop strings. The shell owns the hue/accent/sat UI and
 *                        passes the resolved stops; the sim never touches that UI.
 *   sim.resize(rescale)  REQUIRED. Called on genuine window resize / orientation
 *                        change AFTER the shell has resized the canvas backing
 *                        store. The sim rescales its own world-space buffers.
 *                        `rescale` is true here. NOT called for the first layout
 *                        — the sim reads the size in init() and seeds there.
 *
 * The `ctx` the shell hands sim.init(ctx):
 *
 *   ctx.canvas          The <canvas id="canvas"> element.
 *   ctx.getCanvasSize() -> { W, H, dpr } current logical size + device ratio.
 *   ctx.getPalette()    -> current resolved stops array (same as last
 *                          refreshPalette argument).
 *   ctx.requestReset()  Ask the shell to re-seed (equivalent to sim.reset()).
 *   ctx.persist()       Debounced save of sim.state to localStorage.
 *   ctx.isPlaying()     -> the shell's current play state (the same `playing`
 *                          the rAF loop uses). For sims that need play state for
 *                          RENDERING or INTERACTION — e.g. RD paints the brush
 *                          once per frame while PAUSED (render() can't tell that
 *                          from a playing-but-zero-step frame otherwise). Sims
 *                          must NOT use this to gate their own stepping: the
 *                          shell already calls step() only while playing. Purely
 *                          additive — sims that ignore it are unaffected.
 *
 * Fixed state.settings keys the SHELL reads/writes (every sim must carry these,
 * JSON-serializable, so the shared toolbar/settings/loop work):
 *   fps, simSpeed, resetOnRandomize, randomizeColor, randomizePattern,
 *   showRecord, showShareLink, showHideUI
 *
 * ----------------------------------------------------------------------------
 * Color modal (boundary case 1): ~90% generic and owned by the shell. The sim
 * supplies only palette *data*: a preset registry, a generateCustomStops(custom)
 * that turns {hue,accentHue,saturation} into stop hexes, and a presetToCustom
 * (stops) that derives hue/accent/sat from a preset (so picking a preset seeds
 * the custom sliders). The shell renders the preset chips, the hue/accent/sat
 * sliders, the preview + legend, tracks mode/name/custom in sim.state.palette,
 * and calls sim.refreshPalette(stops) whenever the resolved stops change.
 *
 * Persistence + share (boundary case 2): the shell serializes sim.state to
 * localStorage (debounced) and to the URL hash (base64) on demand. deepMerge
 * applies partial restores so adding state fields stays backward-compatible.
 *
 * Per-control onApply (boundary case 3): a params/settings slider may carry an
 * onApply(v) hook. When present the shell calls it on input INSTEAD of a plain
 * set(); use it for sliders that mutate live structures (e.g. gravity's mass
 * count reconciling the particle pool). With no onApply the shell calls set(v).
 * ========================================================================== */

const SimShell = (() => {
    "use strict";

    const byId = (id) => document.getElementById(id);

    // --------------------------------------------------------------------
    // SHARED COLOR HELPERS (used by the standard color modal + sims)
    // --------------------------------------------------------------------
    function hexToRgb(h) {
        return [
            parseInt(h.slice(1, 3), 16),
            parseInt(h.slice(3, 5), 16),
            parseInt(h.slice(5, 7), 16),
        ];
    }

    // HSL -> hex
    function hslHex(h, s, l) {
        h = ((h % 360) + 360) % 360;
        s = Math.max(0, Math.min(100, s)) / 100;
        l = Math.max(0, Math.min(100, l)) / 100;
        const k = (n) => (n + h / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = (n) =>
            l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        const r = Math.round(f(0) * 255);
        const g = Math.round(f(8) * 255);
        const b = Math.round(f(4) * 255);
        return (
            "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")
        );
    }

    // hex -> HSL ({ h: 0-360, s: 0-100, l: 0-100 })
    function hexToHsl(hex) {
        const [r0, g0, b0] = hexToRgb(hex);
        const r = r0 / 255,
            g = g0 / 255,
            b = b0 / 255;
        const max = Math.max(r, g, b),
            min = Math.min(r, g, b);
        const l = (max + min) / 2;
        let h = 0,
            s = 0;
        const d = max - min;
        if (d !== 0) {
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
        }
        return { h, s: s * 100, l: l * 100 };
    }

    // One ordered registry per enumeration. `id` is the stable key the sim
    // branches on and that state serializes; `label` is the only field copy
    // edits touch. byId() falls back to the default if an unknown id turns up.
    function registry(items, defaultId) {
        return {
            items,
            byId: (id) =>
                items.find((d) => d.id === id) ||
                items.find((d) => d.id === defaultId),
        };
    }
    const randItem = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // --------------------------------------------------------------------
    // deepMerge — apply a partial restore onto a target (persistence/share)
    // --------------------------------------------------------------------
    function deepMerge(target, src) {
        if (!src || typeof src !== "object") return;
        for (const k of Object.keys(src)) {
            const sv = src[k];
            if (sv && typeof sv === "object" && !Array.isArray(sv)) {
                if (!target[k] || typeof target[k] !== "object") target[k] = {};
                deepMerge(target[k], sv);
            } else {
                target[k] = sv;
            }
        }
    }

    // --------------------------------------------------------------------
    // CHROME DOM — built once at registration. Markup matches the previous
    // static HTML exactly (ids/classes) so sim-shell.css applies unchanged.
    // --------------------------------------------------------------------
    const CHROME_HTML = `
        <div class="settings-menu" id="settings-menu">
            <button class="fab" id="settings-trigger" title="Menu" aria-label="Menu" aria-haspopup="true" aria-expanded="false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
            </button>
            <div class="menu-dropdown" id="menu-dropdown" role="menu">
                <button class="dropdown-item" data-modal="color" role="menuitem" title="Color" aria-label="Color">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 3a9 9 0 1 0 0 18 1.5 1.5 0 0 0 1.5-1.5c0-.4-.15-.78-.43-1.06A1.5 1.5 0 0 1 14.13 16h2.37A4.5 4.5 0 0 0 21 11.5C21 7 16.97 3 12 3z" />
                        <circle cx="8" cy="11" r="1" fill="currentColor" />
                        <circle cx="11" cy="7" r="1" fill="currentColor" />
                        <circle cx="15" cy="7" r="1" fill="currentColor" />
                        <circle cx="17" cy="11" r="1" fill="currentColor" />
                    </svg>
                </button>
                <button class="dropdown-item" data-modal="pattern" role="menuitem" title="Shape" aria-label="Shape">
                    <svg viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="5" cy="5" r="1.6" /><circle cx="12" cy="5" r="1.6" /><circle cx="19" cy="5" r="1.6" />
                        <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
                        <circle cx="5" cy="19" r="1.6" /><circle cx="12" cy="19" r="1.6" /><circle cx="19" cy="19" r="1.6" />
                    </svg>
                </button>
                <button class="dropdown-item" data-modal="params" role="menuitem" title="Parameters" aria-label="Parameters">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                        <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
                        <circle cx="9" cy="6" r="2.5" fill="rgba(20,25,35,0.95)" />
                        <circle cx="16" cy="12" r="2.5" fill="rgba(20,25,35,0.95)" />
                        <circle cx="7" cy="18" r="2.5" fill="rgba(20,25,35,0.95)" />
                    </svg>
                </button>
                <button class="dropdown-item" data-modal="settings" role="menuitem" title="Settings" aria-label="Settings">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="3" y="5" width="18" height="6" rx="3" />
                        <circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" />
                        <rect x="3" y="13" width="18" height="6" rx="3" />
                        <circle cx="16" cy="16" r="1.7" fill="currentColor" stroke="none" />
                    </svg>
                </button>
            </div>
        </div>

        <div id="rec-indicator" class="rec-indicator hidden">
            <span class="rec-dot"></span>
            <span id="rec-time">0:00</span>
        </div>

        <div id="hide-banner" class="hide-banner hidden">
            Press <kbd>H</kbd> to bring back the controls
        </div>

        <div class="fab-toolbar" id="fab-toolbar">
            <button class="fab fab-record" id="fab-record" title="Record video" aria-label="Record video">
                <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6" /></svg>
            </button>
            <button class="fab" id="fab-share" title="Copy share link" aria-label="Copy share link">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
            </button>
            <button class="fab" id="fab-hide" title="Hide controls (H)" aria-label="Hide controls">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
            </button>
            <button class="fab" id="fab-speed" title="Simulation speed" aria-label="Simulation speed">
                <span class="speed-label" id="speed-label">1×</span>
            </button>
            <button class="fab" id="fab-reset" title="Reset" aria-label="Reset">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
            </button>
            <button class="fab" id="fab-pause" title="Pause / play" aria-label="Pause">
                <svg class="icon-pause" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="7" y="5" width="3.5" height="14" rx="1" />
                    <rect x="13.5" y="5" width="3.5" height="14" rx="1" />
                </svg>
                <svg class="icon-play" viewBox="0 0 24 24" fill="currentColor" style="display: none">
                    <polygon points="7,4 19,12 7,20" />
                </svg>
            </button>
            <button class="fab fab-primary" id="fab-randomize" title="Randomize" aria-label="Randomize">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="16" cy="8" r="1" fill="currentColor" />
                    <circle cx="12" cy="12" r="1" fill="currentColor" />
                    <circle cx="8" cy="16" r="1" fill="currentColor" /><circle cx="16" cy="16" r="1" fill="currentColor" />
                </svg>
            </button>
        </div>

        <div class="backdrop" id="backdrop"></div>

        <div class="modal" id="modal-color"><div class="modal-body" id="body-color"></div></div>
        <div class="modal" id="modal-pattern"><div class="modal-body" id="body-pattern"></div></div>
        <div class="modal" id="modal-params"><div class="modal-body" id="body-params"></div></div>
        <div class="modal" id="modal-settings"><div class="modal-body" id="body-settings"></div></div>

        <div class="toast" id="toast">Link copied</div>
    `;

    const CLOSE_SVG = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
        </svg>`;

    function modalHeader(title) {
        const head = document.createElement("div");
        head.className = "modal-header";
        const t = document.createElement("div");
        t.className = "modal-title";
        t.textContent = title;
        const close = document.createElement("button");
        close.className = "modal-close";
        close.setAttribute("data-close", "");
        close.setAttribute("aria-label", "Close");
        close.innerHTML = CLOSE_SVG;
        head.append(t, close);
        return head;
    }

    // --------------------------------------------------------------------
    // CONTROL PRIMITIVES
    // --------------------------------------------------------------------
    function elFromHTML(html) {
        const tpl = document.createElement("template");
        tpl.innerHTML = html.trim();
        return tpl.content.firstElementChild;
    }

    function sectionEl(label) {
        const sec = document.createElement("div");
        sec.className = "section";
        if (label != null) {
            const lab = document.createElement("div");
            lab.className = "section-label";
            lab.textContent = label;
            sec.appendChild(lab);
        }
        return sec;
    }

    function hintEl(text, marginTop) {
        const h = document.createElement("div");
        h.className = "ctrl-hint";
        if (marginTop) h.style.marginTop = "8px";
        h.textContent = text;
        return h;
    }

    function introEl(text) {
        const p = document.createElement("div");
        p.className = "panel-intro";
        p.textContent = text;
        return p;
    }

    // A range slider control. def: { label, min, max, step, fmt, get, set,
    // onApply? }. Returns { wrap, sync }.
    function slider(def, onPersist) {
        const wrap = document.createElement("div");
        wrap.className = "ctrl";
        wrap.innerHTML = `
            <div class="ctrl-head">
                <span class="ctrl-name">${def.label}</span>
                <span class="ctrl-val"></span>
            </div>
            <input type="range" min="${def.min}" max="${def.max}" step="${def.step}">
        `;
        const inp = wrap.querySelector("input");
        const val = wrap.querySelector(".ctrl-val");
        const fmt = def.fmt || ((v) => String(v));

        function sync() {
            const v = def.get();
            inp.value = v;
            val.textContent = fmt(v);
        }
        inp.addEventListener("input", () => {
            const v = parseFloat(inp.value);
            if (def.onApply) def.onApply(v);
            else def.set(v);
            val.textContent = fmt(v);
            if (onPersist) onPersist();
        });
        sync();
        return { wrap, sync };
    }

    // A toggle (checkbox). def: { label, hint, get, set }.
    function toggle(def, onChange) {
        const label = document.createElement("label");
        label.className = "toggle";
        label.innerHTML = `
            <input type="checkbox">
            <span class="toggle-track"><span class="toggle-thumb"></span></span>
            <span class="toggle-label">${def.label}</span>
            <span class="toggle-hint">${def.hint || ""}</span>
        `;
        const input = label.querySelector("input");
        function sync() {
            input.checked = !!def.get();
        }
        input.addEventListener("change", () => {
            def.set(input.checked);
            if (onChange) onChange();
        });
        sync();
        return { label, input, sync };
    }

    // A row of selectable chips. def: { chips:[{id,label,swatch?}], isActive(id),
    // onSelect(id) }. swatch is an optional CSS background-image for a swatch span.
    function chipRow(def) {
        const row = document.createElement("div");
        row.className = "chip-row";
        const buttons = [];
        def.chips.forEach((c) => {
            const btn = document.createElement("button");
            btn.className = "chip";
            if (c.swatch) {
                const sw = document.createElement("span");
                sw.className = "swatch";
                sw.style.backgroundImage = c.swatch;
                btn.appendChild(sw);
            }
            btn.appendChild(document.createTextNode(c.label));
            btn.dataset.id = c.id;
            btn.addEventListener("click", () => def.onSelect(c.id));
            row.appendChild(btn);
            buttons.push(btn);
        });
        function sync() {
            buttons.forEach((b) =>
                b.classList.toggle("active", def.isActive(b.dataset.id)),
            );
        }
        sync();
        return { row, sync };
    }

    // ====================================================================
    // registerSim — the one entry point
    // ====================================================================
    function registerSim(sim) {
        const state = sim.state;
        const cfg = sim.config || {};
        const modalsCfg = cfg.modals || {};
        const simId =
            sim.id ||
            (document.title || "sim").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const LS_KEY = (cfg.keys && cfg.keys.ls) || "plife-state";
        const WIN_KEY = (cfg.keys && cfg.keys.win) || "plife-windows";
        const defaultState =
            sim.defaultState || JSON.parse(JSON.stringify(state));

        // ---- inject chrome DOM --------------------------------------
        document.body.insertAdjacentHTML("beforeend", CHROME_HTML);

        const canvas = byId("canvas");
        const backdrop = byId("backdrop");

        // ============================================================
        // PERSISTENCE + SHARE
        // ============================================================
        let persistTimer = null;
        function persistState() {
            if (persistTimer) clearTimeout(persistTimer);
            persistTimer = setTimeout(() => {
                try {
                    localStorage.setItem(LS_KEY, JSON.stringify(state));
                } catch (e) {}
            }, 200);
        }
        function loadPersistedState() {
            try {
                const raw = localStorage.getItem(LS_KEY);
                if (raw) deepMerge(state, JSON.parse(raw));
            } catch (e) {}
        }
        function buildShareURL() {
            const json = JSON.stringify(state);
            const encoded = btoa(unescape(encodeURIComponent(json)));
            return location.origin + location.pathname + "#" + encoded;
        }
        function loadFromHash() {
            const h = location.hash.slice(1);
            if (!h) return false;
            try {
                const json = decodeURIComponent(escape(atob(h)));
                deepMerge(state, JSON.parse(json));
                return true;
            } catch (e) {
                return false;
            }
        }
        function showToast(msg) {
            const f = byId("toast");
            f.textContent = msg || "Link copied";
            f.classList.add("show");
            setTimeout(() => f.classList.remove("show"), 1200);
        }

        // ============================================================
        // CANVAS RESIZE (generic half; sim does its own world rescale)
        // ============================================================
        let W = 0,
            H = 0,
            dpr = 1;
        let booted = false; // gate the sim.resize callback until after init()
        const ctx2d = canvas.getContext("2d");
        function resizeCanvas(rescale) {
            const newW = window.innerWidth;
            const newH = window.innerHeight;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            W = newW;
            H = newH;
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
            canvas.style.width = W + "px";
            canvas.style.height = H + "px";
            ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
            // On first layout the sim hasn't initialized its buffers yet — it
            // reads the size in init() and seeds there. Only forward genuine
            // resizes (post-boot) to the sim's rescale path.
            if (booted) sim.resize(rescale);
        }
        let resizeTimer = null;
        function onResize() {
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                resizeCanvas(true);
            }, 150);
        }
        window.addEventListener("resize", onResize);
        window.addEventListener("orientationchange", onResize);

        // ============================================================
        // MODAL WINDOWING
        // ============================================================
        const dragQuery = window.matchMedia(
            "(min-width: 720px) and (pointer: fine)",
        );
        const floating = () => dragQuery.matches;

        let savedWindows = {};
        try {
            savedWindows = JSON.parse(localStorage.getItem(WIN_KEY)) || {};
        } catch (_) {}
        function saveWindows() {
            if (!floating()) return;
            const data = {};
            document.querySelectorAll(".modal").forEach((m) => {
                if (m.style.left)
                    data[m.id] = { left: m.style.left, top: m.style.top };
            });
            try {
                localStorage.setItem(WIN_KEY, JSON.stringify(data));
            } catch (_) {}
        }

        let zStack = [];
        function bringToFront(modal) {
            zStack = zStack.filter((x) => x !== modal.id);
            zStack.push(modal.id);
            zStack.forEach((id, i) => {
                const m = byId(id);
                if (m) m.style.zIndex = 111 + i;
            });
        }

        let cascadeIdx = 0;
        function placeFloating(modal) {
            if (modal.dataset.placed) return;
            const saved = savedWindows[modal.id];
            let left, top;
            if (saved) {
                left = parseFloat(saved.left);
                top = parseFloat(saved.top);
            } else {
                const off = (cascadeIdx++ % 6) * 34;
                left = Math.max(20, window.innerWidth / 2 - 230) + off;
                top = 76 + off;
            }
            modal.style.right = "auto";
            modal.style.bottom = "auto";
            modal.style.transform = "none";
            modal.style.left = left + "px";
            modal.style.top = top + "px";
            const rect = modal.getBoundingClientRect();
            const maxX = window.innerWidth - rect.width - 8;
            const maxY = window.innerHeight - rect.height - 8;
            modal.style.left = Math.max(8, Math.min(left, maxX)) + "px";
            modal.style.top = Math.max(8, Math.min(top, maxY)) + "px";
            modal.dataset.placed = "1";
        }

        function refreshDropdownActive() {
            document.querySelectorAll(".dropdown-item").forEach((f) => {
                const m = byId("modal-" + f.dataset.modal);
                f.classList.toggle(
                    "active",
                    !!(m && m.classList.contains("open")),
                );
            });
        }

        function openModal(id) {
            const modal = byId(id);
            if (!modal) return;
            closeDropdown();
            if (floating()) {
                if (!modal.classList.contains("open")) {
                    placeFloating(modal);
                    modal.classList.add("open");
                }
                bringToFront(modal);
            } else {
                closeAllModals();
                modal.classList.add("open");
                backdrop.classList.add("open");
            }
            if (id === "modal-color") syncColorControls();
            refreshDropdownActive();
        }

        function closeModal(id) {
            const modal = byId(id);
            if (!modal || !modal.classList.contains("open")) return;
            modal.classList.remove("open");
            if (!document.querySelector(".modal.open"))
                backdrop.classList.remove("open");
            saveWindows();
            refreshDropdownActive();
        }

        function closeAllModals() {
            document
                .querySelectorAll(".modal.open")
                .forEach((m) => m.classList.remove("open"));
            backdrop.classList.remove("open");
            saveWindows();
            refreshDropdownActive();
        }

        document.body.classList.toggle("floating-windows", floating());

        backdrop.addEventListener("click", closeAllModals);

        // ============================================================
        // BUILD MODALS FROM CONFIG
        // ============================================================
        // -- COLOR MODAL (shell-owned chrome; sim supplies palette data) --
        const colorCfg = modalsCfg.color;
        let colorRowCtl = null,
            hueSlider,
            accentSlider,
            satSlider,
            hueVal,
            accentVal,
            satVal,
            palettePreview;

        function currentStops() {
            const p = state.palette;
            if (p.mode === "custom")
                return colorCfg.generateCustomStops(p.custom);
            return colorCfg.paletteRegistry.byId(p.name).stops;
        }
        function applyPalette() {
            sim.refreshPalette(currentStops());
            updatePalettePreview();
            // Optional sim-specific extra content in the color modal (e.g.
            // particle-life's per-species swatches) re-syncs on every palette
            // change. Sims that set no color.extra are unaffected.
            if (colorCfg.extra && colorCfg.extra.sync) colorCfg.extra.sync();
        }
        function updatePalettePreview() {
            if (!palettePreview) return;
            const stops = currentStops().slice(1);
            palettePreview.style.backgroundImage = `linear-gradient(90deg, ${stops.join(", ")})`;
        }
        function markActiveColor() {
            if (colorRowCtl) colorRowCtl.sync();
        }
        function updateSatSliderBg() {
            let h = state.palette.custom.hue;
            if (state.palette.mode === "preset") {
                const pal = colorCfg.paletteRegistry.byId(state.palette.name);
                if (pal) h = Math.round(hexToHsl(pal.stops[2]).h);
            }
            satSlider.style.backgroundImage = `linear-gradient(90deg, hsl(${h}, 0%, 55%), hsl(${h}, 85%, 55%))`;
        }
        function onCustomColorChange() {
            state.palette.mode = "custom";
            state.palette.custom.hue = parseFloat(hueSlider.value);
            state.palette.custom.accentHue = parseFloat(accentSlider.value);
            state.palette.custom.saturation = parseFloat(satSlider.value);
            hueVal.textContent = state.palette.custom.hue + "°";
            accentVal.textContent = state.palette.custom.accentHue + "°";
            satVal.textContent = state.palette.custom.saturation + "%";
            updateSatSliderBg();
            applyPalette();
            markActiveColor();
            persistState();
        }
        function syncColorControls() {
            hueSlider.value = state.palette.custom.hue;
            accentSlider.value = state.palette.custom.accentHue;
            satSlider.value = state.palette.custom.saturation;
            hueVal.textContent = state.palette.custom.hue + "°";
            accentVal.textContent = state.palette.custom.accentHue + "°";
            satVal.textContent = state.palette.custom.saturation + "%";
            updateSatSliderBg();
            markActiveColor();
            updatePalettePreview();
            if (colorCfg.extra && colorCfg.extra.sync) colorCfg.extra.sync();
        }

        function buildColorModal() {
            const body = byId("body-color");
            body.appendChild(modalHeader("Color"));
            if (colorCfg.intro) body.appendChild(introEl(colorCfg.intro));

            const presetSec = sectionEl("Presets");
            colorRowCtl = chipRow({
                chips: colorCfg.paletteRegistry.items.map((pal) => ({
                    id: pal.id,
                    label: pal.label,
                    swatch: `linear-gradient(90deg, ${pal.stops[1]}, ${pal.stops[3]})`,
                })),
                isActive: (id) =>
                    state.palette.mode === "preset" &&
                    id === state.palette.name,
                onSelect: (id) => {
                    const pal = colorCfg.paletteRegistry.byId(id);
                    state.palette.mode = "preset";
                    state.palette.name = id;
                    const c = colorCfg.presetToCustom(pal.stops);
                    state.palette.custom.hue = c.hue;
                    state.palette.custom.accentHue = c.accentHue;
                    state.palette.custom.saturation = c.saturation;
                    applyPalette();
                    syncColorControls();
                    persistState();
                },
            });
            presetSec.appendChild(colorRowCtl.row);
            body.appendChild(presetSec);

            const customSec = sectionEl("Custom");
            customSec.appendChild(
                elFromHTML(`
                <div class="ctrl">
                    <div class="ctrl-head"><span class="ctrl-name">Base hue</span><span class="ctrl-val" id="v-hue">130°</span></div>
                    <input type="range" id="s-hue" min="0" max="360" step="1" value="130" />
                </div>`),
            );
            customSec.appendChild(
                elFromHTML(`
                <div class="ctrl">
                    <div class="ctrl-head"><span class="ctrl-name">Accent hue</span><span class="ctrl-val" id="v-accent">60°</span></div>
                    <input type="range" id="s-accent" min="0" max="360" step="1" value="60" />
                </div>`),
            );
            customSec.appendChild(
                elFromHTML(`
                <div class="ctrl">
                    <div class="ctrl-head"><span class="ctrl-name">Saturation</span><span class="ctrl-val" id="v-sat">85%</span></div>
                    <input type="range" id="s-sat" min="0" max="100" step="1" value="85" />
                </div>`),
            );
            customSec.appendChild(
                elFromHTML(`<div class="palette-preview" id="palette-preview"></div>`),
            );
            customSec.appendChild(
                elFromHTML(
                    colorCfg.legendHTML ||
                        `<div class="palette-legend"><span>Slow</span><span>Fast</span></div>`,
                ),
            );
            // Optional sim-specific extra content rendered into the color modal
            // body (e.g. particle-life's per-species swatch row). Appended into
            // the Custom section so it sits with the palette preview/legend, and
            // re-synced after every palette change (see applyPalette /
            // syncColorControls). Sims that omit color.extra are unaffected.
            if (colorCfg.extra && colorCfg.extra.render)
                colorCfg.extra.render(customSec);
            body.appendChild(customSec);

            hueSlider = byId("s-hue");
            accentSlider = byId("s-accent");
            satSlider = byId("s-sat");
            hueVal = byId("v-hue");
            accentVal = byId("v-accent");
            satVal = byId("v-sat");
            palettePreview = byId("palette-preview");
            hueSlider.addEventListener("input", onCustomColorChange);
            accentSlider.addEventListener("input", onCustomColorChange);
            satSlider.addEventListener("input", onCustomColorChange);
        }

        // -- SHAPE (PATTERN) MODAL --
        // The shape modal always has a primary chip row ("Starting shape") plus
        // an optional `regionSlider` gated by the active shape. Some sims need a
        // SECOND control axis (boids: "Which way they head" — a heading chip row
        // plus a heading-angle slider gated by the active heading). Those are
        // expressed via the optional `secondaryChips` + `secondarySlider` config
        // below; sims without them (e.g. gravity) are unaffected.
        const shapeCfg = modalsCfg.shape;
        let patternRowCtl = null,
            regionSection = null,
            regionSliderCtl = null,
            secondaryRowCtl = null,
            secondarySection = null,
            secondarySliderCtl = null;
        function updateRegionVisibility() {
            if (regionSection && shapeCfg.regionSlider) {
                regionSection.style.display = shapeCfg.regionSlider.visibleFor(
                    shapeCfg.getName(),
                )
                    ? ""
                    : "none";
            }
        }
        function updateSecondaryVisibility() {
            if (!secondarySection || !shapeCfg.secondarySlider || !shapeCfg.secondaryChips) return;
            secondarySection.style.display = shapeCfg.secondarySlider.visibleFor(
                shapeCfg.secondaryChips.getName(),
            )
                ? ""
                : "none";
        }
        function syncPatternControls() {
            if (patternRowCtl) patternRowCtl.sync();
            if (secondaryRowCtl) secondaryRowCtl.sync();
            updateRegionVisibility();
            updateSecondaryVisibility();
            if (secondarySliderCtl) secondarySliderCtl.sync();
            if (regionSliderCtl) regionSliderCtl.sync();
        }
        function buildShapeModal() {
            const body = byId("body-pattern");
            body.appendChild(modalHeader(shapeCfg.title));
            if (shapeCfg.intro) body.appendChild(introEl(shapeCfg.intro));

            const sec = sectionEl(shapeCfg.chipLabel || "Starting shape");
            patternRowCtl = chipRow({
                chips: shapeCfg.chips.items.map((p) => ({
                    id: p.id,
                    label: p.label,
                })),
                isActive: (id) => id === shapeCfg.getName(),
                onSelect: (id) => {
                    shapeCfg.onSelect(id);
                    patternRowCtl.sync();
                    updateRegionVisibility();
                    requestReset();
                    persistState();
                },
            });
            sec.appendChild(patternRowCtl.row);
            body.appendChild(sec);

            // Optional secondary chip row + its gated slider (boids' heading).
            if (shapeCfg.secondaryChips) {
                const sc = shapeCfg.secondaryChips;
                const secSec = sectionEl(sc.label);
                secondaryRowCtl = chipRow({
                    chips: sc.chips.items.map((p) => ({
                        id: p.id,
                        label: p.label,
                    })),
                    isActive: (id) => id === sc.getName(),
                    onSelect: (id) => {
                        sc.onSelect(id);
                        secondaryRowCtl.sync();
                        updateSecondaryVisibility();
                        requestReset();
                        persistState();
                    },
                });
                secSec.appendChild(secondaryRowCtl.row);
                body.appendChild(secSec);

                if (shapeCfg.secondarySlider) {
                    const ss = shapeCfg.secondarySlider;
                    secondarySection = sectionEl(null);
                    secondarySliderCtl = slider(
                        {
                            label: ss.label,
                            min: ss.min,
                            max: ss.max,
                            step: ss.step,
                            fmt: ss.fmt,
                            get: ss.get,
                            onApply: (v) => {
                                ss.set(v);
                                requestReset();
                            },
                        },
                        persistState,
                    );
                    secondarySection.appendChild(secondarySliderCtl.wrap);
                    body.appendChild(secondarySection);
                }
            }

            if (shapeCfg.regionSlider) {
                const rs = shapeCfg.regionSlider;
                regionSection = sectionEl(null);
                regionSliderCtl = slider(
                    {
                        label: rs.label,
                        min: rs.min,
                        max: rs.max,
                        step: rs.step,
                        fmt: rs.fmt,
                        get: rs.get,
                        onApply: (v) => {
                            rs.set(v);
                            requestReset();
                        },
                    },
                    persistState,
                );
                regionSection.appendChild(regionSliderCtl.wrap);
                body.appendChild(regionSection);
            }
        }

        // -- PARAMS MODAL --
        const paramsCfg = modalsCfg.params;
        const paramSliders = {};
        function applyParamsToSliders() {
            Object.keys(paramSliders).forEach((k) => paramSliders[k].sync());
        }
        function buildParamsModal() {
            const body = byId("body-params");
            body.appendChild(modalHeader(paramsCfg.title));
            if (paramsCfg.intro) body.appendChild(introEl(paramsCfg.intro));

            const groups = {};
            const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
            function groupContainer(name) {
                if (!groups[name]) {
                    const sec = sectionEl(name);
                    const sliders = document.createElement("div");
                    const desc = document.createElement("div");
                    desc.className = "section-desc";
                    sec.append(sliders, desc);
                    body.appendChild(sec);
                    groups[name] = { sliders, desc };
                }
                return groups[name];
            }
            paramsCfg.controls.forEach((def) => {
                const g = groupContainer(def.group);
                const ctl = slider(
                    {
                        label: def.label,
                        min: def.min,
                        max: def.max,
                        step: def.step,
                        fmt: def.fmt,
                        get: def.get,
                        set: def.set,
                        onApply: def.onApply,
                    },
                    persistState,
                );
                paramSliders[def.key] = ctl;
                g.sliders.appendChild(ctl.wrap);
                if (def.hint) {
                    const p = document.createElement("p");
                    p.innerHTML = `<strong>${def.label}</strong> — ${lcFirst(def.hint)}`;
                    g.desc.appendChild(p);
                }
            });
        }

        // -- SETTINGS MODAL --
        const settingsCfg = modalsCfg.settings || {};
        const settingSliders = [];
        const settingToggles = [];
        // Fixed shell toggles for the standard "Randomize" + "Sharing" sections.
        const RAND_TOGGLES = [
            {
                key: "randomizeColor",
                label: "Randomize color",
                hint: "Pick a new palette when randomizing.",
            },
            {
                key: "resetOnRandomize",
                label: "Reset on randomize",
                hint: "Re-spawn the particles each time you randomize.",
            },
            {
                key: "randomizePattern",
                label: "Randomize shape",
                hint: "Pick a new starting shape when randomizing (auto-resets).",
            },
        ];
        const SHARE_TOGGLES = [
            {
                key: "showRecord",
                label: "Record button",
                hint: "Show the record-to-WebM button in the toolbar.",
            },
            {
                key: "showShareLink",
                label: "Share link button",
                hint: "Show a button that copies a shareable link.",
            },
            {
                key: "showHideUI",
                label: "Hide-UI button",
                hint: "Show a button that hides the interface for clean recordings.",
            },
        ];

        function buildSettingsControl(def) {
            if (def.type === "toggle") {
                const ctl = toggle(
                    {
                        label: def.label,
                        hint: def.hint,
                        get: def.get,
                        set: def.set,
                    },
                    () => {
                        if (def.onChange) def.onChange();
                        persistState();
                    },
                );
                settingToggles.push(ctl);
                return ctl.label;
            }
            const ctl = slider(
                {
                    label: def.label,
                    min: def.min,
                    max: def.max,
                    step: def.step,
                    fmt: def.fmt,
                    get: def.get,
                    set: def.set,
                    onApply: def.onApply,
                },
                () => {
                    // FPS is a standard setting the shell's loop reads; keep the
                    // render cadence reactive to any settings-slider change.
                    frameInterval = 1000 / (state.settings.fps || 60);
                    persistState();
                },
            );
            settingSliders.push(ctl);
            return ctl.wrap;
        }

        function makeToggleSection(label, toggleDefs) {
            const sec = sectionEl(label);
            const list = document.createElement("div");
            list.className = "toggle-list";
            toggleDefs.forEach((td) => {
                const ctl = toggle(
                    {
                        label: td.label,
                        hint: td.hint,
                        get: () => !!state.settings[td.key],
                        set: (v) => {
                            state.settings[td.key] = v;
                        },
                    },
                    () => {
                        updateToolbarVisibility();
                        persistState();
                    },
                );
                settingToggles.push(ctl);
                list.appendChild(ctl.label);
            });
            sec.appendChild(list);
            return sec;
        }

        function buildSettingsModal() {
            const body = byId("body-settings");
            body.appendChild(modalHeader("Settings"));

            (settingsCfg.sections || []).forEach((s) => {
                const sec = sectionEl(s.label);
                (s.controls || []).forEach((def) => {
                    sec.appendChild(buildSettingsControl(def));
                });
                if (s.hint) sec.appendChild(hintEl(s.hint, true));
                body.appendChild(sec);
            });

            body.appendChild(
                makeToggleSection("Randomize behavior", RAND_TOGGLES),
            );
            body.appendChild(makeToggleSection("Sharing tools", SHARE_TOGGLES));

            const restoreSec = sectionEl("Restore");
            const actions = document.createElement("div");
            actions.className = "modal-actions";
            actions.style.marginTop = "6px";
            const btn = document.createElement("button");
            btn.className = "btn";
            btn.id = "btn-restore-defaults";
            btn.textContent = "Restore default settings";
            actions.appendChild(btn);
            restoreSec.appendChild(actions);
            body.appendChild(restoreSec);

            btn.addEventListener("click", restoreDefaults);
        }

        function syncSettings() {
            settingSliders.forEach((c) => c.sync());
            settingToggles.forEach((c) => c.sync());
            frameInterval = 1000 / (state.settings.fps || 60);
            updateToolbarVisibility();
        }

        // ============================================================
        // TOOLBAR + CHROME WIRING
        // ============================================================
        let playing = true;
        let frameInterval = 1000 / 60;

        const fabPause = byId("fab-pause");
        const iconPause = fabPause.querySelector(".icon-pause");
        const iconPlay = fabPause.querySelector(".icon-play");
        function updatePauseButton() {
            iconPause.style.display = playing ? "" : "none";
            iconPlay.style.display = playing ? "none" : "";
            fabPause.title = playing ? "Pause" : "Play";
            fabPause.setAttribute("aria-label", playing ? "Pause" : "Play");
        }
        fabPause.addEventListener("click", () => {
            playing = !playing;
            updatePauseButton();
        });

        byId("fab-reset").addEventListener("click", () => requestReset());

        const SPEED_STEPS = [1, 2, 4, 8];
        const speedLabel = byId("speed-label");
        function updateSpeedLabel() {
            speedLabel.textContent = state.settings.simSpeed + "×";
        }
        byId("fab-speed").addEventListener("click", () => {
            const curIdx = SPEED_STEPS.indexOf(state.settings.simSpeed);
            const nextIdx = (curIdx + 1) % SPEED_STEPS.length;
            state.settings.simSpeed = SPEED_STEPS[nextIdx];
            updateSpeedLabel();
            persistState();
        });

        function updateToolbarVisibility() {
            byId("fab-record").classList.toggle(
                "hidden",
                !state.settings.showRecord,
            );
            byId("fab-share").classList.toggle(
                "hidden",
                !state.settings.showShareLink,
            );
            byId("fab-hide").classList.toggle(
                "hidden",
                !state.settings.showHideUI,
            );
        }

        // ---- randomize -----------------------------------------------
        const fabRandomize = byId("fab-randomize");
        fabRandomize.addEventListener("click", () => {
            fabRandomize.classList.remove("spin");
            void fabRandomize.offsetWidth;
            fabRandomize.classList.add("spin");

            sim.randomize();
            applyParamsToSliders();

            if (state.settings.randomizeColor) {
                state.palette.mode = "preset";
                state.palette.name = randItem(
                    colorCfg.paletteRegistry.items,
                ).id;
                applyPalette();
                markActiveColor();
            }

            if (state.settings.randomizePattern && shapeCfg) {
                shapeCfg.onRandomize
                    ? shapeCfg.onRandomize()
                    : shapeCfg.onSelect(randItem(shapeCfg.chips.items).id);
                syncPatternControls();
                requestReset();
            } else if (state.settings.resetOnRandomize) {
                requestReset();
            }

            persistState();
        });

        // ---- restore defaults ----------------------------------------
        function restoreDefaults() {
            const fresh = JSON.parse(JSON.stringify(defaultState));
            Object.keys(fresh).forEach((k) => {
                state[k] = fresh[k];
            });
            try {
                localStorage.removeItem(LS_KEY);
            } catch (e) {}
            if (location.hash)
                history.replaceState(
                    null,
                    "",
                    location.pathname + location.search,
                );
            // Optional, additive hook: let a sim rebuild NON-COLOR derived
            // state — e.g. interaction matrices, species assignments — now that
            // `state` holds its defaults again. Fires BEFORE syncColorControls
            // and applyPalette, so per-species colors and swatch repaints must
            // NOT be done here; the downstream applyPalette() → refreshPalette()
            // → colorCfg.extra.sync() sequence handles all color/swatch work.
            if (typeof sim.onRestoreDefaults === "function")
                sim.onRestoreDefaults();
            applyParamsToSliders();
            syncColorControls();
            syncPatternControls();
            syncSettings();
            updateSpeedLabel();
            applyPalette();
            requestReset();
            persistState();
            showToast("Defaults restored");
        }

        // ---- recording -----------------------------------------------
        const fabRecord = byId("fab-record");
        const recIndicator = byId("rec-indicator");
        const recTimeEl = byId("rec-time");
        let mediaRecorder = null;
        let recordChunks = [];
        let recordStart = 0;
        let recTimer = null;

        function pickWebmMime() {
            const candidates = [
                "video/webm;codecs=vp9",
                "video/webm;codecs=vp8",
                "video/webm",
            ];
            for (const c of candidates) {
                if (
                    typeof MediaRecorder !== "undefined" &&
                    MediaRecorder.isTypeSupported(c)
                )
                    return c;
            }
            return "";
        }
        function startRecording() {
            if (typeof MediaRecorder === "undefined") {
                alert("MediaRecorder is not supported in this browser.");
                return;
            }
            const stream = canvas.captureStream(30);
            const mime = pickWebmMime();
            try {
                mediaRecorder = mime
                    ? new MediaRecorder(stream, { mimeType: mime })
                    : new MediaRecorder(stream);
            } catch (e) {
                alert("Could not start recording: " + e.message);
                return;
            }
            recordChunks = [];
            mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) recordChunks.push(e.data);
            };
            mediaRecorder.onstop = () => {
                const blob = new Blob(recordChunks, { type: "video/webm" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${simId}-${Date.now()}.webm`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            };
            mediaRecorder.start();
            recordStart = Date.now();
            fabRecord.classList.add("recording");
            recIndicator.classList.remove("hidden");
            recTimer = setInterval(() => {
                const sec = Math.floor((Date.now() - recordStart) / 1000);
                const mm = Math.floor(sec / 60);
                const ss = sec % 60;
                recTimeEl.textContent = mm + ":" + (ss < 10 ? "0" : "") + ss;
            }, 250);
        }
        function stopRecording() {
            if (mediaRecorder && mediaRecorder.state !== "inactive") {
                mediaRecorder.stop();
            }
            mediaRecorder = null;
            fabRecord.classList.remove("recording");
            recIndicator.classList.add("hidden");
            if (recTimer) {
                clearInterval(recTimer);
                recTimer = null;
            }
        }
        fabRecord.addEventListener("click", () => {
            if (mediaRecorder && mediaRecorder.state !== "inactive")
                stopRecording();
            else startRecording();
        });

        // ---- share ----------------------------------------------------
        byId("fab-share").addEventListener("click", () => {
            const url = buildShareURL();
            navigator.clipboard
                .writeText(url)
                .then(() => showToast())
                .catch(() => window.prompt("Copy this link:", url));
        });

        // ---- hide UI --------------------------------------------------
        let uiHidden = false;
        let hideBannerTimer = null;
        function toggleUI() {
            uiHidden = !uiHidden;
            document.body.classList.toggle("ui-hidden", uiHidden);
            if (uiHidden) {
                const banner = byId("hide-banner");
                banner.classList.remove("hidden");
                if (hideBannerTimer) clearTimeout(hideBannerTimer);
                hideBannerTimer = setTimeout(
                    () => banner.classList.add("hidden"),
                    2200,
                );
            } else {
                byId("hide-banner").classList.add("hidden");
            }
        }
        byId("fab-hide").addEventListener("click", toggleUI);

        // ============================================================
        // DROPDOWN MENU
        // ============================================================
        const settingsMenu = byId("settings-menu");
        const settingsTrigger = byId("settings-trigger");
        const menuDropdown = byId("menu-dropdown");
        let dropdownOpen = false;
        function openDropdown() {
            if (dropdownOpen) return;
            if (!floating()) closeAllModals();
            dropdownOpen = true;
            menuDropdown.classList.add("open");
            settingsTrigger.classList.add("open");
            settingsTrigger.setAttribute("aria-expanded", "true");
        }
        function closeDropdown() {
            if (!dropdownOpen) return;
            dropdownOpen = false;
            menuDropdown.classList.remove("open");
            settingsTrigger.classList.remove("open");
            settingsTrigger.setAttribute("aria-expanded", "false");
        }
        settingsTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            if (dropdownOpen) closeDropdown();
            else openDropdown();
        });
        document.addEventListener("click", (e) => {
            if (dropdownOpen && !settingsMenu.contains(e.target))
                closeDropdown();
        });

        // ============================================================
        // KEYBOARD SHORTCUTS
        // ============================================================
        document.addEventListener("keydown", (e) => {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
                return;
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

        // ============================================================
        // ctx given to the sim
        // ============================================================
        function requestReset() {
            sim.reset();
        }
        const ctx = {
            canvas,
            getCanvasSize: () => ({ W, H, dpr }),
            getPalette: () => currentStops(),
            requestReset,
            persist: persistState,
            isPlaying: () => playing,
        };

        // ============================================================
        // BOOT
        // ============================================================
        loadPersistedState();
        loadFromHash();

        buildColorModal();
        if (shapeCfg) buildShapeModal();
        buildParamsModal();
        buildSettingsModal();

        // Build the modal-id -> open/close wiring now that bodies exist.
        document.querySelectorAll("[data-close]").forEach((b) => {
            b.addEventListener("click", () => {
                const m = b.closest(".modal");
                if (m) closeModal(m.id);
            });
        });
        document.querySelectorAll("[data-modal]").forEach((f) => {
            f.addEventListener("click", () => {
                const id = "modal-" + f.dataset.modal;
                const m = byId(id);
                if (m && m.classList.contains("open")) closeModal(id);
                else openModal(id);
            });
        });

        // Drag modals by their header (floating mode only).
        document.querySelectorAll(".modal").forEach((modal) => {
            modal.addEventListener("pointerdown", () => {
                if (floating()) bringToFront(modal);
            });
            const header = modal.querySelector(".modal-header");
            if (!header) return;
            let dragging = false;
            let startX = 0,
                startY = 0,
                baseLeft = 0,
                baseTop = 0;
            header.addEventListener("pointerdown", (e) => {
                if (!floating()) return;
                if (e.button !== 0) return;
                if (e.target.closest(".modal-close")) return;
                const rect = modal.getBoundingClientRect();
                baseLeft = rect.left;
                baseTop = rect.top;
                modal.style.left = baseLeft + "px";
                modal.style.top = baseTop + "px";
                modal.style.right = "auto";
                modal.style.bottom = "auto";
                modal.style.transform = "none";
                modal.dataset.placed = "1";
                startX = e.clientX;
                startY = e.clientY;
                dragging = true;
                modal.classList.add("dragging");
                header.setPointerCapture(e.pointerId);
            });
            header.addEventListener("pointermove", (e) => {
                if (!dragging) return;
                const rect = modal.getBoundingClientRect();
                const maxX = window.innerWidth - rect.width;
                const maxY = window.innerHeight - rect.height;
                let nx = baseLeft + (e.clientX - startX);
                let ny = baseTop + (e.clientY - startY);
                nx = Math.max(0, Math.min(nx, maxX));
                ny = Math.max(0, Math.min(ny, maxY));
                modal.style.left = nx + "px";
                modal.style.top = ny + "px";
            });
            function endDrag(e) {
                if (!dragging) return;
                dragging = false;
                modal.classList.remove("dragging");
                try {
                    header.releasePointerCapture(e.pointerId);
                } catch (_) {}
                saveWindows();
            }
            header.addEventListener("pointerup", endDrag);
            header.addEventListener("pointercancel", endDrag);
        });

        // Initial canvas layout (sizes the backing store; the sim reads the
        // size and seeds in init). After init, genuine resizes flow to the sim.
        resizeCanvas(false);
        applyPalette();
        sim.init(ctx);
        booted = true;

        applyParamsToSliders();
        syncColorControls();
        syncPatternControls();
        syncSettings();
        updatePauseButton();
        updateSpeedLabel();

        // ============================================================
        // MAIN LOOP — the shell owns rAF; sims never call it.
        // The FPS slider caps render rate; the sim advances on its own
        // fixed timestep (SIM_FPS steps/sec × speed), caught up via an
        // accumulator so motion stays constant regardless of render rate.
        // ============================================================
        const SIM_FPS = 60;
        const MAX_CATCHUP_MS = 100;
        let lastFrame = 0;
        let lastSim = 0;
        let simAccumulator = 0;
        function loop(now) {
            requestAnimationFrame(loop);
            if (now - lastFrame < frameInterval) return;
            lastFrame = now - ((now - lastFrame) % frameInterval);

            if (playing) {
                const stepMs =
                    1000 / (SIM_FPS * (state.settings.simSpeed || 1));
                simAccumulator += now - (lastSim || now);
                if (simAccumulator > MAX_CATCHUP_MS)
                    simAccumulator = MAX_CATCHUP_MS;
                while (simAccumulator >= stepMs) {
                    sim.step();
                    simAccumulator -= stepMs;
                }
            } else {
                simAccumulator = 0;
            }
            lastSim = now;

            sim.render();
        }
        requestAnimationFrame(loop);
    }

    return {
        registerSim,
        // shared helpers exposed for sims to build palette data with
        registry,
        randItem,
        hexToRgb,
        hslHex,
        hexToHsl,
    };
})();
