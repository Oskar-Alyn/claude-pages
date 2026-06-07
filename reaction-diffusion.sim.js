/* ============================================================================
 * reaction-diffusion.sim.js — the Reaction–Diffusion sim, driven through the
 * SimShell contract.
 *
 * A Gray-Scott reaction-diffusion system on a wrapping (toroidal) grid: two
 * chemicals A and B react and diffuse at different rates, self-organizing into
 * living Turing patterns (spots, stripes, mazes). Unlike the particle sims this
 * is a GRID/cellular simulation — it keeps 2D Float32 concentration buffers and
 * writes pixels through an offscreen ImageData, not particle arrays. All chrome
 * (modals, toolbar, persistence, share, recording, the rAF loop) lives in
 * sim-shell.js; this file owns only the grid simulation + its palette/seed data.
 *
 * Buffers (A/B/A2/B2 Float32 grids, the offscreen canvas + ImageData) are
 * module-locals, NEVER in state — state stays JSON-serializable.
 * ========================================================================== */

(() => {
    "use strict";

    const { registry, randItem, hexToRgb, hslHex, hexToHsl } = SimShell;

    const TAU = Math.PI * 2;

    // ------------------------------------------------------------------
    // STATE (JSON-serializable — the shell persists/serializes this verbatim)
    // ------------------------------------------------------------------
    const state = {
        params: {
            feed: 0.0545,
            kill: 0.062,
            dA: 1.0,
            dB: 0.5,
        },
        pattern: {
            name: "Scatter",
            regionSize: 0.5,
        },
        palette: {
            mode: "preset",
            name: "Acid",
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
            key: "feed",
            group: "Feed & kill",
            label: "Feed rate",
            hint: "How fast chemical A is replenished.",
            min: 0.005,
            max: 0.1,
            step: 0.001,
            fmt: (v) => v.toFixed(3),
        },
        {
            key: "kill",
            group: "Feed & kill",
            label: "Kill rate",
            hint: "How fast chemical B is removed.",
            min: 0.03,
            max: 0.075,
            step: 0.001,
            fmt: (v) => v.toFixed(3),
        },
        {
            key: "dA",
            group: "Diffusion",
            label: "Diffusion A",
            hint: "How quickly chemical A spreads.",
            min: 0.2,
            max: 1.2,
            step: 0.01,
            fmt: (v) => v.toFixed(2),
        },
        {
            key: "dB",
            group: "Diffusion",
            label: "Diffusion B",
            hint: "How quickly chemical B spreads — usually about half of A.",
            min: 0.1,
            max: 0.8,
            step: 0.01,
            fmt: (v) => v.toFixed(2),
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
            { id: "Scatter", label: "Scatter" },
            { id: "Ring", label: "Ring", clustered: true },
            { id: "Disc", label: "Disc", clustered: true },
            { id: "Center", label: "Center", clustered: true },
            { id: "Edges", label: "Edges" },
            { id: "Grid", label: "Grid" },
            {
                id: "TwoBlobs",
                label: "Two Blobs",
                clustered: true,
                blobCount: 2,
            },
            {
                id: "FourBlobs",
                label: "Four Blobs",
                clustered: true,
                blobCount: 4,
            },
        ],
        "Scatter",
    );

    // Stay inside the band of feed/kill values that actually
    // produce living patterns rather than a flat wash.
    const randomRanges = {
        feed: [0.014, 0.062],
        kill: [0.045, 0.066],
        dA: [0.9, 1.05],
        dB: [0.34, 0.55],
    };

    // ------------------------------------------------------------------
    // CANVAS & GRID (module-locals — NOT in state)
    // ------------------------------------------------------------------
    let canvas, ctx, getSize, isPlaying, qualityScalar = () => 1;

    // Quality baseline: the grid-cell target at the default level (high = 1.0);
    // allocateGrid multiplies it by ctx.qualityScalar() and derives the grid
    // from the viewport aspect (the shell owns the level enum + scalar ladder).
    const GRID_BASELINE = 80000;
    // Brush strength is fixed at the old slider's max (the per-sim slider was
    // removed).
    const BRUSH_STRENGTH = 1.0;
    const offscreen =
        typeof document !== "undefined"
            ? document.createElement("canvas")
            : null;
    const offCtx = offscreen ? offscreen.getContext("2d") : null;

    let W = 0,
        H = 0; // logical viewport (CSS px)
    let dpr = 1;
    let Wg = 0,
        Hg = 0; // simulation grid
    let A, B, A2, B2; // chemical fields (Float32 grids)
    let offImage;

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

    // The shell owns the hue/accent/sat UI and hands us the resolved stops.
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
        const cells = Wg * Hg;
        A = new Float32Array(cells);
        B = new Float32Array(cells);
        A2 = new Float32Array(cells);
        B2 = new Float32Array(cells);
        offscreen.width = Wg;
        offscreen.height = Hg;
        offImage = offCtx.createImageData(Wg, Hg);
    }

    // Drop a filled circle of reagent B (clearing A) at a grid cell.
    function splat(gx, gy, r) {
        const r2 = r * r;
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > r2) continue;
                let ix = gx + dx,
                    iy = gy + dy;
                ix -= Math.floor(ix / Wg) * Wg;
                iy -= Math.floor(iy / Hg) * Hg;
                const i = iy * Wg + ix;
                B[i] = 1;
                A[i] = 0;
            }
        }
    }

    // Lay down the initial reagent: a medium full of A, with B seeded
    // in the chosen shape so the reaction grows from there.
    function seedField() {
        A.fill(1);
        B.fill(0);
        const cx = Wg / 2,
            cy = Hg / 2;
        const reg = state.pattern.regionSize;
        const maxR = Math.min(Wg, Hg) * 0.45 * reg;

        switch (state.pattern.name) {
            case "Scatter": {
                const count = Math.round(20 + 60 * reg);
                for (let k = 0; k < count; k++)
                    splat(
                        Math.floor(Math.random() * Wg),
                        Math.floor(Math.random() * Hg),
                        3,
                    );
                break;
            }
            case "Ring": {
                const rr = maxR * 0.7;
                const steps = Math.max(24, Math.round(rr * 2));
                for (let k = 0; k < steps; k++) {
                    const th = (k / steps) * TAU;
                    splat(
                        Math.round(cx + Math.cos(th) * rr),
                        Math.round(cy + Math.sin(th) * rr),
                        2,
                    );
                }
                break;
            }
            case "Disc": {
                const rr = Math.round(maxR * 0.5);
                splat(Math.round(cx), Math.round(cy), rr);
                break;
            }
            case "Center": {
                splat(
                    Math.round(cx),
                    Math.round(cy),
                    Math.max(3, Math.round(maxR * 0.12)),
                );
                break;
            }
            case "Edges": {
                const t = 3;
                for (let x = 0; x < Wg; x++) {
                    for (let d = 0; d < t; d++) {
                        B[d * Wg + x] = 1;
                        A[d * Wg + x] = 0;
                        B[(Hg - 1 - d) * Wg + x] = 1;
                        A[(Hg - 1 - d) * Wg + x] = 0;
                    }
                }
                for (let y = 0; y < Hg; y++) {
                    for (let d = 0; d < t; d++) {
                        B[y * Wg + d] = 1;
                        A[y * Wg + d] = 0;
                        B[y * Wg + (Wg - 1 - d)] = 1;
                        A[y * Wg + (Wg - 1 - d)] = 0;
                    }
                }
                break;
            }
            case "Grid": {
                const n = Math.max(2, Math.round(3 + reg * 5));
                for (let r = 0; r < n; r++) {
                    for (let c = 0; c < n; c++) {
                        splat(
                            Math.round(((c + 0.5) * Wg) / n),
                            Math.round(((r + 0.5) * Hg) / n),
                            3,
                        );
                    }
                }
                break;
            }
            case "TwoBlobs":
            case "FourBlobs": {
                const bc = PATTERNS.byId(state.pattern.name).blobCount;
                const bd = Math.min(Wg, Hg) * 0.28 * reg;
                const rr = Math.max(4, Math.round(Math.min(Wg, Hg) * 0.08));
                for (let b = 0; b < bc; b++) {
                    const ba = (b / bc) * TAU;
                    splat(
                        Math.round(cx + Math.cos(ba) * bd),
                        Math.round(cy + Math.sin(ba) * bd),
                        rr,
                    );
                }
                break;
            }
            default:
                splat(Math.round(cx), Math.round(cy), 6);
        }
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
    // SIMULATION (Gray-Scott, toroidal)
    // ------------------------------------------------------------------
    // Laplacian kernel: orthogonal neighbors 0.2, diagonals 0.05,
    // center -1. Interior cells use a fast branch-free loop; the
    // perimeter wraps toroidally so the medium is seamless.
    function gsEdgeCell(x, y, feed, kill, dA, dB) {
        const xm = x === 0 ? Wg - 1 : x - 1;
        const xp = x === Wg - 1 ? 0 : x + 1;
        const ym = y === 0 ? Hg - 1 : y - 1;
        const yp = y === Hg - 1 ? 0 : y + 1;
        const r = y * Wg,
            rm = ym * Wg,
            rp = yp * Wg;
        const i = r + x;
        const a = A[i],
            b = B[i];
        const lapA =
            (A[r + xm] + A[r + xp] + A[rm + x] + A[rp + x]) * 0.2 +
            (A[rm + xm] + A[rm + xp] + A[rp + xm] + A[rp + xp]) * 0.05 -
            a;
        const lapB =
            (B[r + xm] + B[r + xp] + B[rm + x] + B[rp + x]) * 0.2 +
            (B[rm + xm] + B[rm + xp] + B[rp + xm] + B[rp + xp]) * 0.05 -
            b;
        const abb = a * b * b;
        let na = a + (dA * lapA - abb + feed * (1 - a));
        let nb = b + (dB * lapB + abb - (kill + feed) * b);
        A2[i] = na < 0 ? 0 : na > 1 ? 1 : na;
        B2[i] = nb < 0 ? 0 : nb > 1 ? 1 : nb;
    }

    function gsStep() {
        const feed = state.params.feed,
            kill = state.params.kill,
            dA = state.params.dA,
            dB = state.params.dB;
        const wg = Wg,
            hg = Hg;

        for (let y = 1; y < hg - 1; y++) {
            const row = y * wg;
            for (let x = 1; x < wg - 1; x++) {
                const i = row + x;
                const a = A[i],
                    b = B[i];
                const lapA =
                    (A[i - 1] + A[i + 1] + A[i - wg] + A[i + wg]) * 0.2 +
                    (A[i - wg - 1] +
                        A[i - wg + 1] +
                        A[i + wg - 1] +
                        A[i + wg + 1]) *
                        0.05 -
                    a;
                const lapB =
                    (B[i - 1] + B[i + 1] + B[i - wg] + B[i + wg]) * 0.2 +
                    (B[i - wg - 1] +
                        B[i - wg + 1] +
                        B[i + wg - 1] +
                        B[i + wg + 1]) *
                        0.05 -
                    b;
                const abb = a * b * b;
                let na = a + (dA * lapA - abb + feed * (1 - a));
                let nb = b + (dB * lapB + abb - (kill + feed) * b);
                A2[i] = na < 0 ? 0 : na > 1 ? 1 : na;
                B2[i] = nb < 0 ? 0 : nb > 1 ? 1 : nb;
            }
        }
        for (let x = 0; x < wg; x++) {
            gsEdgeCell(x, 0, feed, kill, dA, dB);
            gsEdgeCell(x, hg - 1, feed, kill, dA, dB);
        }
        for (let y = 1; y < hg - 1; y++) {
            gsEdgeCell(0, y, feed, kill, dA, dB);
            gsEdgeCell(wg - 1, y, feed, kill, dA, dB);
        }

        let t = A;
        A = A2;
        A2 = t;
        t = B;
        B = B2;
        B2 = t;
    }

    function paintBrush() {
        const br = BRUSH_STRENGTH;
        if (br <= 0) return;
        const r = Math.max(2, Math.round(Math.min(Wg, Hg) * 0.02));
        const r2 = r * r;
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > r2) continue;
                let ix = pointerGX + dx,
                    iy = pointerGY + dy;
                ix -= Math.floor(ix / Wg) * Wg;
                iy -= Math.floor(iy / Hg) * Hg;
                const i = iy * Wg + ix;
                B[i] = Math.min(1, B[i] + br);
                A[i] = Math.max(0, A[i] - br);
            }
        }
    }

    // ------------------------------------------------------------------
    // INTERACTION (mouse / touch) — paint reagent
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
    // SHELL CONTRACT
    // ------------------------------------------------------------------
    SimShell.registerSim({
        id: "reaction-diffusion",
        state,
        defaultState,
        // Preserve RD's legacy storage keys so existing saved state loads.
        config: {
            keys: { ls: "rd-state", win: "rd-windows" },
            modals: {
                color: {
                    intro:
                        "The palette maps reagent concentration to color — dark where the medium is empty, bright where the reaction is dense. Tap a preset or mix your own.",
                    paletteRegistry: PALETTES,
                    legendHTML:
                        '<div class="palette-legend"><span>Empty</span><span>Dense</span></div>',
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
                },
                shape: {
                    title: "Starting shape",
                    intro:
                        "Choose where the reaction ignites — a drop of reagent in this shape against an empty medium, from which the pattern grows. Changes restart the simulation right away.",
                    chipLabel: "Where it ignites",
                    chips: PATTERNS,
                    getName: () => state.pattern.name,
                    onSelect: (id) => {
                        state.pattern.name = id;
                    },
                    onRandomize: () => {
                        state.pattern.name = randItem(PATTERNS.items).id;
                        state.pattern.regionSize = 0.25 + Math.random() * 0.65;
                    },
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
                        "Two chemicals share the grid: one is fed in, the other eats it and is killed off. Diffusion spreads them at different rates, and from that tug-of-war Turing patterns emerge — spots, stripes, and mazes. Tiny changes transform everything.",
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
            isPlaying = ctx2.isPlaying;
            qualityScalar = ctx2.qualityScalar;

            const s = getSize();
            W = s.W;
            H = s.H;
            dpr = s.dpr;

            // Pointer interaction is RD-specific; wire it to the canvas.
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

        // RD's grid is tied to the viewport size, so a genuine resize can't
        // rescale the reaction field — it reallocates and re-seeds, exactly as
        // the original onResize did (it ignored any position rescaling).
        resize(rescale) {
            const s = getSize();
            W = s.W;
            H = s.H;
            dpr = s.dpr;
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

        // One fixed sim sub-step: paint the brush if the pointer is down (like
        // the original simulate()), then advance the Gray-Scott grid. The shell
        // calls this 0..N times per rendered frame per the speed/FPS settings,
        // matching the original loop's accumulator.
        step() {
            if (pointerActive) paintBrush();
            gsStep();
        },

        render() {
            // Paused-paint: the original painted the brush once per frame ONLY
            // while paused. While PLAYING the paint happens inside step() per
            // sub-step (0 paints on a zero-step frame), so render() must NOT
            // paint then — gate strictly on play state, not on "did a step run".
            if (!isPlaying() && pointerActive) paintBrush();

            // Map reagent B to color through the palette LUT.
            const data = offImage.data;
            const cells = Wg * Hg;
            for (let i = 0; i < cells; i++) {
                let idx = (B[i] * 560) | 0;
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
    });
})();
