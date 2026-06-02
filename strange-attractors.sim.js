/* ============================================================================
 * strange-attractors.sim.js — the Strange Attractors sim, driven through the
 * SimShell contract.
 *
 * Iterates a simple two-line map (Clifford / De Jong / Svensson / Fractal
 * Dream) hundreds of thousands of times from a running point, dropping hits
 * into a density accumulator that slowly fades, then maps the accumulated
 * density through a palette LUT (log-scaled) into a fractal "dust" image. The
 * coefficients drift on their own and dragging the canvas bends the first two
 * coefficients live. All chrome (modals, toolbar, persistence, share,
 * recording, the rAF loop) lives in sim-shell.js; this file owns only the
 * simulation + its palette/family data.
 *
 * NOTE: the parameter sliders are a FIXED set (a/b/c/d/morph/exposure) shared
 * by every family — switching family only changes which equation simulate()
 * uses, not the sliders — so the standard params.controls config suffices and
 * NO shell extension is needed.
 * ========================================================================== */

(() => {
    "use strict";

    const { registry, randItem, hexToRgb, hslHex, hexToHsl } = SimShell;

    // ------------------------------------------------------------------
    // STATE (JSON-serializable — the shell persists/serializes this verbatim)
    // ------------------------------------------------------------------
    const state = {
        params: {
            a: -1.7,
            b: 1.8,
            c: -1.9,
            d: -0.4,
            morph: 0.003,
            exposure: 26,
        },
        pattern: {
            name: "Clifford",
            regionSize: 0.5,
        },
        palette: {
            mode: "preset", // 'preset' | 'custom'
            name: "Iris",
            custom: { hue: 130, accentHue: 60, saturation: 85 },
        },
        settings: {
            resetOnRandomize: true,
            randomizeColor: true,
            randomizePattern: true,
            quality: "high",
            fps: 60,
            simSpeed: 1,
            showRecord: false,
            showShareLink: false,
            showHideUI: false,
        },
    };
    const defaultState = JSON.parse(JSON.stringify(state));

    // ------------------------------------------------------------------
    // STATIC DATA
    // ------------------------------------------------------------------
    const slidersDef = [
        {
            key: "a",
            group: "Coefficients",
            label: "A",
            hint: "First shape constant — small turns reshape the whole figure.",
            min: -3,
            max: 3,
            step: 0.01,
            fmt: (v) => v.toFixed(2),
        },
        {
            key: "b",
            group: "Coefficients",
            label: "B",
            hint: "Second shape constant.",
            min: -3,
            max: 3,
            step: 0.01,
            fmt: (v) => v.toFixed(2),
        },
        {
            key: "c",
            group: "Coefficients",
            label: "C",
            hint: "Third shape constant.",
            min: -3,
            max: 3,
            step: 0.01,
            fmt: (v) => v.toFixed(2),
        },
        {
            key: "d",
            group: "Coefficients",
            label: "D",
            hint: "Fourth shape constant.",
            min: -3,
            max: 3,
            step: 0.01,
            fmt: (v) => v.toFixed(2),
        },
        {
            key: "morph",
            group: "Look",
            label: "Drift",
            hint: "How fast the coefficients wander on their own, morphing the figure (0 freezes it).",
            min: 0,
            max: 0.02,
            step: 0.0005,
            fmt: (v) => (v * 1000).toFixed(1),
        },
        {
            key: "exposure",
            group: "Look",
            label: "Exposure",
            hint: "Brightness of the build-up — raise it if the figure is too dim, lower it if it blows out.",
            min: 5,
            max: 60,
            step: 1,
            fmt: (v) => v.toFixed(0),
        },
    ];

    const PALETTES = registry(
        [
            {
                id: "Acid",
                label: "Acid",
                stops: ["#000000", "#082a14", "#1a8a3c", "#7af066", "#f5ffa8"],
            },
            {
                id: "Coral",
                label: "Coral",
                stops: ["#0a0612", "#2b0a26", "#a83a5c", "#ff7da3", "#ffe3ea"],
            },
            {
                id: "Ember",
                label: "Ember",
                stops: ["#000000", "#2c0500", "#a02000", "#ff7a2e", "#ffde8a"],
            },
            {
                id: "Frost",
                label: "Frost",
                stops: ["#000814", "#0a2e58", "#3a86d0", "#9ed4ff", "#f0faff"],
            },
            {
                id: "Toxic",
                label: "Toxic",
                stops: ["#040010", "#1a0828", "#6a0aa8", "#c850f5", "#f8d4ff"],
            },
            {
                id: "Inferno",
                label: "Inferno",
                stops: ["#000000", "#1a0000", "#a00010", "#ff4020", "#ffec70"],
            },
            {
                id: "Cyber",
                label: "Cyber",
                stops: ["#000810", "#0a2030", "#0a8a98", "#5af0d8", "#fff088"],
            },
            {
                id: "Verdant",
                label: "Verdant",
                stops: ["#020808", "#0a2818", "#187058", "#54d8b8", "#dcfff0"],
            },
            {
                id: "Twilight",
                label: "Twilight",
                stops: ["#040208", "#280a40", "#8a2080", "#ff60c0", "#ffe098"],
            },
            {
                id: "Iris",
                label: "Iris",
                stops: ["#000018", "#0c1448", "#4a3ac0", "#c060e0", "#ffd0e0"],
            },
        ],
        "Inferno",
    );

    const PATTERNS = registry(
        [
            { id: "Clifford", label: "Clifford" },
            { id: "DeJong", label: "De Jong" },
            { id: "Svensson", label: "Svensson" },
            { id: "FractalDream", label: "Fractal Dream" },
        ],
        "Clifford",
    );

    const randomRanges = {
        a: [-2.6, 2.6],
        b: [-2.6, 2.6],
        c: [-2.6, 2.6],
        d: [-2.6, 2.6],
        morph: [0, 0.008],
        exposure: [16, 40],
    };

    // ------------------------------------------------------------------
    // CANVAS / BUFFERS (module-local — NEVER in state)
    // ------------------------------------------------------------------
    let canvas, ctx;
    let getSize = () => ({ W: 0, H: 0, dpr: 1 });
    let qualityScalar = () => 1;
    let W = 0,
        H = 0; // logical viewport (CSS px)
    let dpr = 1;

    // Quality baseline: the grid-cell target at the default level (high = 1.0);
    // allocateGrid multiplies it by ctx.qualityScalar() and derives the grid
    // from the viewport aspect (the shell owns the level enum + scalar ladder).
    const GRID_BASELINE = 140000;
    // Steer strength is fixed at the old slider's max (the per-sim slider was
    // removed).
    const STEER_STRENGTH = 1.0;

    const offscreen =
        typeof document !== "undefined"
            ? document.createElement("canvas")
            : null;
    const offCtx = offscreen ? offscreen.getContext("2d") : null;

    let Wg = 0,
        Hg = 0; // simulation grid
    let dens; // density accumulator (Float32Array)
    let offImage;
    // The continuously-iterated point and a clock for drift.
    let ptx = 0.1,
        pty = 0.1,
        driftT = 0;

    // ------------------------------------------------------------------
    // COLOR / PALETTE
    // ------------------------------------------------------------------
    let paletteLUT;
    let bgR = 0,
        bgG = 0,
        bgB = 0;

    function buildPaletteLUT(stops) {
        const lut = new Uint8ClampedArray(256 * 4);
        const segCount = stops.length - 1;
        for (let i = 0; i < 256; i++) {
            const t = i / 255;
            const sf = t * segCount;
            const seg = Math.min(Math.floor(sf), segCount - 1);
            const u = sf - seg;
            const c0 = hexToRgb(stops[seg]);
            const c1 = hexToRgb(stops[seg + 1]);
            lut[i * 4 + 0] = c0[0] + (c1[0] - c0[0]) * u;
            lut[i * 4 + 1] = c0[1] + (c1[1] - c0[1]) * u;
            lut[i * 4 + 2] = c0[2] + (c1[2] - c0[2]) * u;
            lut[i * 4 + 3] = 255;
        }
        return lut;
    }

    function generateCustomPalette(hue, accentHue, saturation) {
        return [
            hslHex(hue, saturation * 0.5, 2),
            hslHex(hue, saturation * 0.75, 10),
            hslHex(hue, saturation * 0.95, 36),
            hslHex(hue, saturation * 0.9, 65),
            hslHex(accentHue, saturation * 0.7, 86),
        ];
    }

    // Called by the shell whenever the resolved palette stops change.
    function refreshPalette(stops) {
        paletteLUT = buildPaletteLUT(stops);
        const bg = hexToRgb(stops[0]);
        bgR = bg[0];
        bgG = bg[1];
        bgB = bg[2];
    }

    // ------------------------------------------------------------------
    // GRID ALLOCATION & SEEDING
    // ------------------------------------------------------------------
    function allocateGrid() {
        // Size the grid to the Quality cell-count target at the current
        // viewport aspect (same approach as slime-mold).
        const aspect = W / H;
        const target = GRID_BASELINE * qualityScalar();
        Hg = Math.max(60, Math.round(Math.sqrt(target / aspect)));
        Wg = Math.max(80, Math.round(Hg * aspect));
        dens = new Float32Array(Wg * Hg);
        offscreen.width = Wg;
        offscreen.height = Hg;
        offImage = offCtx.createImageData(Wg, Hg);
    }

    // Clear the accumulated density and reseed the iterated point.
    function seedField() {
        if (dens) dens.fill(0);
        ptx = Math.random() * 0.2 - 0.1;
        pty = Math.random() * 0.2 - 0.1;
    }

    function clearCanvas() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "rgb(" + bgR + "," + bgG + "," + bgB + ")";
        ctx.fillRect(0, 0, W, H);
    }

    // Reset only re-seeds the existing grid (same grid size).
    function resetAll() {
        seedField();
        clearCanvas();
    }
    // Rebuild reallocates for a new viewport size / quality, then seeds.
    function rebuildGrid() {
        allocateGrid();
        seedField();
        clearCanvas();
    }

    // ------------------------------------------------------------------
    // INTERACTION (mouse / touch) — drag steers the attractor
    // ------------------------------------------------------------------
    let pointerActive = false;
    let pointerGX = 0,
        pointerGY = 0;
    function pointerToGrid(e) {
        const rect = canvas.getBoundingClientRect();
        const sx = ((e.clientX - rect.left) / rect.width) * W;
        const sy = ((e.clientY - rect.top) / rect.height) * H;
        pointerGX = Math.floor((sx / W) * Wg);
        pointerGY = Math.floor((sy / H) * Hg);
    }

    // ------------------------------------------------------------------
    // SIMULATION (iterated map → density accumulator)
    // ------------------------------------------------------------------
    // Each step iterates the chosen attractor map tens of thousands of times
    // from a running point, dropping a hit into a density grid, then fades the
    // grid so it breathes as the coefficients slowly drift. Dragging the canvas
    // bends the first two coefficients live.
    function simulate() {
        driftT += 1;
        const m = state.params.morph;
        let a = state.params.a + Math.sin(driftT * m) * 0.4;
        let b = state.params.b + Math.cos(driftT * m * 1.3) * 0.4;
        const c = state.params.c + Math.sin(driftT * m * 0.7) * 0.4;
        const d = state.params.d + Math.cos(driftT * m * 1.1) * 0.4;
        if (pointerActive) {
            const s = STEER_STRENGTH * 0.8;
            a += (pointerGX / Wg - 0.5) * s;
            b += (pointerGY / Hg - 0.5) * s;
        }
        const fam = state.pattern.name;
        const scale = 3.4;
        const halfW = Wg * 0.5,
            halfH = Hg * 0.5;
        const iters = Math.min(140000, Wg * Hg * 2);
        let x = ptx,
            y = pty;
        for (let k = 0; k < iters; k++) {
            let nx, ny;
            if (fam === "DeJong") {
                nx = Math.sin(a * y) - Math.cos(b * x);
                ny = Math.sin(c * x) - Math.cos(d * y);
            } else if (fam === "Svensson") {
                nx = d * Math.sin(a * x) - Math.sin(b * y);
                ny = c * Math.cos(a * x) + Math.cos(b * y);
            } else if (fam === "FractalDream") {
                nx = Math.sin(y * b) + c * Math.sin(x * b);
                ny = Math.sin(x * a) + d * Math.sin(y * a);
            } else {
                // Clifford
                nx = Math.sin(a * y) + c * Math.cos(a * x);
                ny = Math.sin(b * x) + d * Math.cos(b * y);
            }
            x = nx;
            y = ny;
            const gx = ((x / scale) * halfW + halfW) | 0;
            const gy = ((y / scale) * halfH + halfH) | 0;
            if (gx >= 0 && gx < Wg && gy >= 0 && gy < Hg)
                dens[gy * Wg + gx] += 1;
        }
        ptx = x;
        pty = y;
        const decay = 0.93;
        const cells = Wg * Hg;
        for (let i = 0; i < cells; i++) dens[i] *= decay;
    }

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------
    function render() {
        // Map accumulated density to color through the palette LUT,
        // log-scaled so faint filaments still show.
        const data = offImage.data;
        const cells = Wg * Hg;
        const expo = state.params.exposure;
        for (let i = 0; i < cells; i++) {
            let idx = (Math.log(1 + dens[i]) * expo) | 0;
            if (idx > 255) idx = 255;
            const q = idx * 4;
            const p = i * 4;
            data[p] = paletteLUT[q];
            data[p + 1] = paletteLUT[q + 1];
            data[p + 2] = paletteLUT[q + 2];
            data[p + 3] = 255;
        }
        offCtx.putImageData(offImage, 0, 0);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "rgb(" + bgR + "," + bgG + "," + bgB + ")";
        ctx.fillRect(0, 0, W, H);

        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(offscreen, 0, 0, W, H);
    }

    // ------------------------------------------------------------------
    // REGISTER
    // ------------------------------------------------------------------
    SimShell.registerSim({
        id: "strange-attractors",
        state,
        defaultState,
        // Preserve the original's storage keys verbatim. NOTE: "rd-state" /
        // "rd-windows" collide with reaction-diffusion — this is a pre-existing
        // copy-paste collision on the live site, faithfully reproduced here.
        config: {
            keys: { ls: "rd-state", win: "rd-windows" },
            modals: {
                color: {
                    intro:
                        "The palette maps how often the attractor's path crosses each pixel — dark where it rarely lands, bright along the lines it traces again and again. Tap a preset or mix your own.",
                    paletteRegistry: PALETTES,
                    generateCustomStops: (c) =>
                        generateCustomPalette(c.hue, c.accentHue, c.saturation),
                    presetToCustom: (stops) => {
                        const mid = hexToHsl(stops[2]);
                        const accent = hexToHsl(stops[4]);
                        return {
                            hue: Math.round(mid.h),
                            accentHue: Math.round(accent.h),
                            saturation: Math.round(Math.min(100, mid.s)),
                        };
                    },
                    // Original legend reads "Sparse"/"Dense", not "Slow"/"Fast".
                    legendHTML:
                        '<div class="palette-legend"><span>Sparse</span><span>Dense</span></div>',
                },
                shape: {
                    title: "Attractor family",
                    intro:
                        "Each family is a different two-line equation. They all trace fractal dust, but with very different character — pick one and drive it with the coefficient sliders in Parameters.",
                    chipLabel: "Family",
                    chips: PATTERNS,
                    getName: () => state.pattern.name,
                    onSelect: (id) => {
                        state.pattern.name = id;
                    },
                    onRandomize: () => {
                        state.pattern.name = randItem(PATTERNS.items).id;
                        state.pattern.regionSize = 0.25 + Math.random() * 0.65;
                    },
                    // "Seed size" slider. In the original this section is gated by
                    // PATTERNS.byId(name).clustered — no family sets that flag, so
                    // the section is ALWAYS hidden. Reproduced via visibleFor →
                    // false. The slider still re-seeds via the shell's
                    // onApply (set + requestReset), matching resetAll().
                    regionSlider: {
                        label: "Seed size",
                        min: 0.1,
                        max: 1,
                        step: 0.01,
                        fmt: (v) => v.toFixed(2),
                        get: () => state.pattern.regionSize,
                        set: (v) => {
                            state.pattern.regionSize = v;
                        },
                        visibleFor: (id) => !!PATTERNS.byId(id).clustered,
                    },
                },
                params: {
                    title: "Parameters",
                    intro:
                        "Four numbers feed a tiny pair of equations that get run millions of times; where the path lands builds up into fractal lace. Nudge a coefficient and the whole figure transforms — hit Randomize for an entirely new one.",
                    controls: slidersDef.map((def) => ({
                        type: "slider",
                        key: def.key,
                        group: def.group,
                        label: def.label,
                        hint: def.hint,
                        min: def.min,
                        max: def.max,
                        step: def.step,
                        fmt: def.fmt,
                        get: () => state.params[def.key],
                        set: (v) => {
                            state.params[def.key] = v;
                        },
                    })),
                },
            },
        },

        init(ctx2) {
            canvas = ctx2.canvas;
            ctx = canvas.getContext("2d");
            getSize = ctx2.getCanvasSize;
            qualityScalar = ctx2.qualityScalar;

            const s = getSize();
            W = s.W;
            H = s.H;
            dpr = s.dpr;

            // Pointer interaction is sim-specific; wire it to the canvas.
            canvas.addEventListener("pointerdown", (e) => {
                e.preventDefault();
                pointerActive = true;
                pointerToGrid(e);
            });
            canvas.addEventListener("pointermove", (e) => {
                if (!pointerActive) return;
                pointerToGrid(e);
            });
            window.addEventListener("pointerup", () => {
                pointerActive = false;
            });

            allocateGrid();
            seedField();
        },

        resize(rescale) {
            const s = getSize();
            W = s.W;
            H = s.H;
            dpr = s.dpr;
            // Grid is tied to viewport size, so rebuild and re-seed.
            rebuildGrid();
        },

        refreshPalette,

        // Quality sizes the grid, so a level change reallocates + re-seeds it
        // (a restart), like the old resolution change did.
        onQualityChange() {
            rebuildGrid();
        },

        // Restoring defaults can change the quality, which sizes the grid.
        // The shell resets state to defaults, calls this hook, then later calls
        // reset(). So reallocate the grid for the restored quality here; the
        // downstream reset() → resetAll() does the single seed + clear, exactly
        // reproducing the original restore's rebuildGrid() (allocate+seed+clear).
        onRestoreDefaults() {
            allocateGrid();
        },

        reset() {
            resetAll();
        },

        randomize() {
            slidersDef.forEach((def) => {
                const [lo, hi] = randomRanges[def.key] || [def.min, def.max];
                let v = lo + Math.random() * (hi - lo);
                v = Math.round(v / def.step) * def.step;
                if (v < def.min) v = def.min;
                if (v > def.max) v = def.max;
                state.params[def.key] = v;
            });
        },

        step() {
            simulate();
        },

        render() {
            render();
        },
    });
})();
