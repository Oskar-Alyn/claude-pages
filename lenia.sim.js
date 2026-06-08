/* ============================================================================
 * lenia.sim.js — the Lenia sim, driven through the SimShell contract.
 *
 * Lenia is a continuous Game of Life. Instead of a binary on/off grid stepped
 * by counting eight neighbors, it runs a smooth field of values in [0,1]: each
 * step the field is blurred through a soft RING kernel (a donut, brightest at
 * half its radius), and every cell then grows or shrinks depending on how much
 * neighborhood it sees — too little or too much and it fades, a sweet spot in
 * between and it thrives. From that one rule, self-propelled creatures emerge
 * and swim across the field (the famous "Orbium" glider).
 *
 * Like reaction-diffusion this is a GRID sim, not a particle sim: it keeps 2D
 * Float32 field buffers and writes pixels through an offscreen ImageData scaled
 * up to fill the screen. All chrome (modals, toolbar, persistence, share,
 * recording, the rAF loop) lives in sim-shell.js; this file owns only the field
 * simulation + its palette/seed data.
 *
 * Buffers (A/A2 Float32 fields, the kernel arrays, the offscreen canvas +
 * ImageData) are module-locals, NEVER in state — state stays JSON-serializable.
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
            mu: 0.15, // growth sweet spot (center of the bell)
            sigma: 0.015, // growth tolerance (width of the bell)
            dt: 0.1, // pace (how big a step each tick takes)
            R: 13, // creature size (kernel radius, in grid cells)
        },
        pattern: {
            name: "Orbium",
            regionSize: 0.6,
        },
        palette: {
            mode: "preset",
            name: "Verdant",
            custom: { hue: 150, accentHue: 95, saturation: 80 },
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
            key: "mu",
            group: "Life",
            label: "Sweet spot",
            hint: "How much neighborhood a cell wants. Cells thrive near this much company and fade away from it.",
            min: 0.08,
            max: 0.3,
            step: 0.001,
            fmt: (v) => v.toFixed(3),
        },
        {
            key: "sigma",
            group: "Life",
            label: "Tolerance",
            hint: "How fussy cells are about the sweet spot. Wider is forgiving and blobby; narrow is picky and crisp.",
            min: 0.008,
            max: 0.04,
            step: 0.001,
            fmt: (v) => v.toFixed(3),
        },
        {
            key: "dt",
            group: "Motion",
            label: "Pace",
            hint: "How big a step the field takes each tick. Higher is faster and twitchier; lower is slow and smooth.",
            min: 0.02,
            max: 0.3,
            step: 0.005,
            fmt: (v) => v.toFixed(3),
        },
        {
            key: "R",
            group: "Motion",
            label: "Creature size",
            hint: "How wide each creature is. Bigger means fewer, larger swimmers; smaller means a busier field.",
            min: 8,
            max: 22,
            step: 1,
            fmt: (v) => Math.round(v).toString(),
        },
    ];

    const PALETTES = registry(
        [
            {
                id: "Verdant",
                label: "Verdant",
                stops: ["#020808", "#0a2818", "#187058", "#54d8b8", "#dcfff0"],
            },
            {
                id: "Cyber",
                label: "Cyber",
                stops: ["#000810", "#0a2030", "#0a8a98", "#5af0d8", "#fff088"],
            },
            {
                id: "Toxic",
                label: "Toxic",
                stops: ["#040010", "#1a0828", "#6a0aa8", "#c850f5", "#f8d4ff"],
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
                id: "Iris",
                label: "Iris",
                stops: ["#000018", "#0c1448", "#4a3ac0", "#c060e0", "#ffd0e0"],
            },
            {
                id: "Twilight",
                label: "Twilight",
                stops: ["#040208", "#280a40", "#8a2080", "#ff60c0", "#ffe098"],
            },
            {
                id: "Acid",
                label: "Acid",
                stops: ["#000000", "#082a14", "#1a8a3c", "#7af066", "#f5ffa8"],
            },
            {
                id: "Inferno",
                label: "Inferno",
                stops: ["#000000", "#1a0000", "#a00010", "#ff4020", "#ffec70"],
            },
        ],
        "Verdant",
    );

    const PATTERNS = registry(
        [
            { id: "Orbium", label: "Orbium", clustered: true },
            { id: "Scatter", label: "Scatter" },
            { id: "Soup", label: "Soup" },
            { id: "Ring", label: "Ring", clustered: true },
            { id: "Center", label: "Center", clustered: true },
        ],
        "Orbium",
    );

    // Stay inside the band that actually produces living, moving creatures
    // rather than a flat wash or instant death.
    const randomRanges = {
        mu: [0.12, 0.2],
        sigma: [0.012, 0.022],
        dt: [0.08, 0.15],
        R: [11, 16],
    };

    // The canonical "Orbium" glider (Bert Chan), tuned for R=13 / mu=0.15 /
    // sigma=0.015. A 20x20 patch of cell values in [0,1]; the seeder stamps it
    // (bilinearly scaled to the live R) so the iconic swimmer appears on demand.
    // prettier-ignore
    const ORBIUM = [
        [0,0,0,0,0,0,0.1,0.14,0.1,0,0,0.03,0.03,0,0,0.3,0,0,0,0],
        [0,0,0,0,0,0.08,0.24,0.3,0.3,0.18,0.14,0.15,0.16,0.15,0.09,0.2,0,0,0,0],
        [0,0,0,0,0,0.15,0.34,0.44,0.46,0.38,0.18,0.14,0.11,0.13,0.19,0.18,0.45,0,0,0],
        [0,0,0,0,0.06,0.13,0.39,0.5,0.5,0.37,0.06,0,0,0,0.02,0.16,0.68,0,0,0],
        [0,0,0,0.11,0.17,0.17,0.33,0.4,0.38,0.28,0.14,0,0,0,0,0,0.18,0.42,0,0],
        [0,0,0.09,0.18,0.13,0.06,0.08,0.26,0.32,0.32,0.27,0,0,0,0,0,0,0.82,0,0],
        [0.27,0,0.16,0.12,0,0,0,0.25,0.38,0.44,0.45,0.34,0,0,0,0,0,0.22,0.17,0],
        [0,0.07,0.2,0.02,0,0,0,0.31,0.48,0.57,0.6,0.57,0,0,0,0,0,0,0.49,0],
        [0,0.59,0.19,0,0,0,0,0.2,0.57,0.69,0.76,0.76,0.49,0,0,0,0,0,0.36,0],
        [0,0.58,0.19,0,0,0,0,0,0.67,0.83,0.9,0.92,0.87,0.12,0,0,0,0,0.22,0.07],
        [0,0,0.46,0,0,0,0,0,0.7,0.93,1,1,1,0.61,0,0,0,0,0.18,0.11],
        [0,0,0.82,0,0,0,0,0,0.47,1,1,0.98,1,0.96,0.27,0,0,0,0.19,0.1],
        [0,0,0.46,0,0,0,0,0,0.25,0.84,0.92,0.97,0.99,1,0.89,0.23,0,0,0.21,0.05],
        [0,0,0,0.4,0,0,0,0,0.09,0.8,0.82,0.82,0.85,0.63,0.31,0.07,0,0,0.16,0.03],
        [0,0,0,0.18,0.54,0,0,0,0.04,0.41,0.51,0.55,0.49,0.39,0.2,0.02,0,0,0.07,0],
        [0,0,0,0,0.31,0.41,0.27,0,0,0.21,0.43,0.49,0.4,0.27,0.09,0,0,0,0.03,0],
        [0,0,0,0,0,0.18,0.42,0.39,0.34,0.32,0.42,0.41,0.28,0.13,0,0,0,0,0,0],
        [0,0,0,0,0,0,0.13,0.34,0.4,0.37,0.31,0.21,0.09,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0,0.12,0.21,0.16,0.06,0,0,0,0,0,0,0,0],
        [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
    ];

    // ------------------------------------------------------------------
    // CANVAS & FIELD (module-locals — NOT in state)
    // ------------------------------------------------------------------
    let canvas, ctx, getSize, isPlaying, qualityScalar = () => 1;

    // Quality baseline: the grid-cell target at the default level (high = 1.0);
    // allocateGrid multiplies it by ctx.qualityScalar() and derives the grid
    // from the viewport aspect. Lower than RD's because the ring convolution is
    // far heavier per cell than RD's 9-tap Laplacian.
    const GRID_BASELINE = 16000;

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
    let A, A2; // the living field (Float32 grids)
    let offImage;

    // Ring kernel, grid-independent shape: parallel arrays of cell offsets +
    // weights (built by buildKernel from R). kOff is the flat interior index
    // offset (dy*Wg+dx), rebuilt whenever Wg changes.
    let kdx, kdy, kw, kOff, kLen = 0;

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
    // KERNEL — a soft ring (donut), brightest at half its radius
    // ------------------------------------------------------------------
    // K(r) for normalized 0<r<1 is a Gaussian bump centered on 0.5; weights are
    // normalized to sum to 1 so the convolution is a weighted average in [0,1].
    function buildKernel(R) {
        R = Math.max(2, Math.round(R));
        const dxs = [],
            dys = [],
            ws = [];
        const KR = 0.5,
            KW = 0.15; // ring peak + width (normalized radius)
        let sum = 0;
        for (let dy = -R; dy <= R; dy++) {
            for (let dx = -R; dx <= R; dx++) {
                const rn = Math.sqrt(dx * dx + dy * dy) / R;
                if (rn === 0 || rn >= 1) continue;
                const w = Math.exp(-((rn - KR) * (rn - KR)) / (2 * KW * KW));
                if (w < 1e-3) continue;
                dxs.push(dx);
                dys.push(dy);
                ws.push(w);
                sum += w;
            }
        }
        kLen = ws.length;
        kdx = Int32Array.from(dxs);
        kdy = Int32Array.from(dys);
        kw = Float32Array.from(ws.map((w) => w / sum));
    }
    // Flatten the kernel offsets for the current grid width (interior fast path).
    function buildKernelOffsets() {
        kOff = Int32Array.from({ length: kLen }, (_, k) => kdy[k] * Wg + kdx[k]);
    }

    // ------------------------------------------------------------------
    // GRID ALLOCATION & SEEDING
    // ------------------------------------------------------------------
    function allocateGrid() {
        const aspect = W / H;
        const target = GRID_BASELINE * qualityScalar();
        Hg = Math.max(60, Math.round(Math.sqrt(target / aspect)));
        Wg = Math.max(80, Math.round(Hg * aspect));
        const cells = Wg * Hg;
        A = new Float32Array(cells);
        A2 = new Float32Array(cells);
        offscreen.width = Wg;
        offscreen.height = Hg;
        offImage = offCtx.createImageData(Wg, Hg);
        buildKernelOffsets();
    }

    // Add a smooth blob of life (radial cosine falloff) centered on a cell.
    function blob(cx, cy, r, peak) {
        const ri = Math.ceil(r);
        for (let dy = -ri; dy <= ri; dy++) {
            for (let dx = -ri; dx <= ri; dx++) {
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d > r) continue;
                let ix = cx + dx,
                    iy = cy + dy;
                ix -= Math.floor(ix / Wg) * Wg;
                iy -= Math.floor(iy / Hg) * Hg;
                const i = iy * Wg + ix;
                const v = peak * (0.5 + 0.5 * Math.cos((Math.PI * d) / r));
                if (v > A[i]) A[i] = v;
            }
        }
    }

    // Stamp the Orbium pattern, bilinearly scaled so its native R=13 footprint
    // maps onto the current creature size, at a random orientation flip.
    function stampOrbium(cx, cy) {
        const rows = ORBIUM.length,
            cols = ORBIUM[0].length;
        const scale = state.params.R / 13; // native pattern is tuned for R=13
        const fw = Math.round(cols * scale),
            fh = Math.round(rows * scale);
        const flipX = Math.random() < 0.5,
            flipY = Math.random() < 0.5;
        for (let y = 0; y < fh; y++) {
            for (let x = 0; x < fw; x++) {
                const sx = (x / fw) * (cols - 1),
                    sy = (y / fh) * (rows - 1);
                const x0 = Math.floor(sx),
                    y0 = Math.floor(sy);
                const x1 = Math.min(cols - 1, x0 + 1),
                    y1 = Math.min(rows - 1, y0 + 1);
                const tx = sx - x0,
                    ty = sy - y0;
                const v =
                    ORBIUM[y0][x0] * (1 - tx) * (1 - ty) +
                    ORBIUM[y0][x1] * tx * (1 - ty) +
                    ORBIUM[y1][x0] * (1 - tx) * ty +
                    ORBIUM[y1][x1] * tx * ty;
                if (v <= 0.01) continue;
                let px = cx + (flipX ? fw - 1 - x : x) - (fw >> 1);
                let py = cy + (flipY ? fh - 1 - y : y) - (fh >> 1);
                px -= Math.floor(px / Wg) * Wg;
                py -= Math.floor(py / Hg) * Hg;
                A[py * Wg + px] = v;
            }
        }
    }

    // Lay down the initial field per the chosen starting shape.
    function seedField() {
        A.fill(0);
        const cx = Wg / 2,
            cy = Hg / 2;
        const reg = state.pattern.regionSize;
        const R = state.params.R;

        switch (state.pattern.name) {
            case "Orbium": {
                const count = Math.max(1, Math.round(1 + reg * 7));
                const spread = Math.min(Wg, Hg) * 0.45;
                for (let k = 0; k < count; k++) {
                    const ang = Math.random() * TAU,
                        rad = Math.random() * spread * reg;
                    stampOrbium(
                        Math.round(cx + Math.cos(ang) * rad),
                        Math.round(cy + Math.sin(ang) * rad),
                    );
                }
                break;
            }
            case "Scatter": {
                const count = Math.round(6 + 18 * reg);
                for (let k = 0; k < count; k++)
                    blob(
                        Math.floor(Math.random() * Wg),
                        Math.floor(Math.random() * Hg),
                        R * (0.7 + Math.random() * 0.6),
                        0.6 + Math.random() * 0.4,
                    );
                break;
            }
            case "Soup": {
                // Smooth low-frequency noise: scatter many overlapping faint
                // blobs so the field reads as organic, not pixel static.
                const count = Math.round((Wg * Hg) / (R * R * 2));
                for (let k = 0; k < count; k++)
                    blob(
                        Math.floor(Math.random() * Wg),
                        Math.floor(Math.random() * Hg),
                        R * (0.5 + Math.random()),
                        0.3 + Math.random() * 0.5,
                    );
                break;
            }
            case "Ring": {
                const rr = Math.min(Wg, Hg) * 0.35 * reg;
                const n = Math.max(5, Math.round(rr / (R * 0.9)));
                for (let k = 0; k < n; k++) {
                    const th = (k / n) * TAU;
                    blob(
                        Math.round(cx + Math.cos(th) * rr),
                        Math.round(cy + Math.sin(th) * rr),
                        R * 0.9,
                        0.9,
                    );
                }
                break;
            }
            case "Center":
            default:
                blob(Math.round(cx), Math.round(cy), R * (1 + reg), 1);
        }
    }

    function clearCanvas() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "rgb(" + bgR + "," + bgG + "," + bgB + ")";
        ctx.fillRect(0, 0, W, H);
    }

    // Reset re-seeds the existing grid (same grid size).
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
    // SIMULATION (Lenia, toroidal)
    // ------------------------------------------------------------------
    // One update: convolve the field with the ring kernel to get how much
    // neighborhood each cell sees, push that through the growth bell, and step
    // the field toward life or death. Interior cells use flat index offsets (no
    // wrap); a border band of width R wraps toroidally so the field is seamless.
    function leniaStep() {
        const mu = state.params.mu,
            sigma = state.params.sigma,
            dt = state.params.dt,
            R = Math.round(state.params.R);
        const wg = Wg,
            hg = Hg;
        const twoSig2 = 2 * sigma * sigma;

        // Interior — no wrapping needed.
        for (let y = R; y < hg - R; y++) {
            const row = y * wg;
            for (let x = R; x < wg - R; x++) {
                const i = row + x;
                let u = 0;
                for (let k = 0; k < kLen; k++) u += kw[k] * A[i + kOff[k]];
                const g =
                    2 * Math.exp(-((u - mu) * (u - mu)) / twoSig2) - 1;
                let v = A[i] + dt * g;
                A2[i] = v < 0 ? 0 : v > 1 ? 1 : v;
            }
        }

        // Border band (width R on every side) — wrap toroidally.
        const doCell = (x, y) => {
            let u = 0;
            for (let k = 0; k < kLen; k++) {
                let ix = x + kdx[k];
                let iy = y + kdy[k];
                if (ix < 0) ix += wg;
                else if (ix >= wg) ix -= wg;
                if (iy < 0) iy += hg;
                else if (iy >= hg) iy -= hg;
                u += kw[k] * A[iy * wg + ix];
            }
            const g = 2 * Math.exp(-((u - mu) * (u - mu)) / twoSig2) - 1;
            const i = y * wg + x;
            let v = A[i] + dt * g;
            A2[i] = v < 0 ? 0 : v > 1 ? 1 : v;
        };
        for (let y = 0; y < hg; y++) {
            if (y >= R && y < hg - R) {
                for (let x = 0; x < R; x++) doCell(x, y);
                for (let x = wg - R; x < wg; x++) doCell(x, y);
            } else {
                for (let x = 0; x < wg; x++) doCell(x, y);
            }
        }

        const t = A;
        A = A2;
        A2 = t;
    }

    // ------------------------------------------------------------------
    // INTERACTION (mouse / touch) — paint life into the field
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
    function paintBrush() {
        blob(pointerGX, pointerGY, Math.max(3, state.params.R * 0.9), 1);
    }

    // ------------------------------------------------------------------
    // SHELL CONTRACT
    // ------------------------------------------------------------------
    SimShell.registerSim({
        id: "lenia",
        state,
        defaultState,
        // Field sim: the grid is sized to the viewport aspect and stretched to
        // fill the screen, so work in raw viewport pixels (no world scaling).
        worldScale: false,
        config: {
            modals: {
                color: {
                    intro:
                        "The palette maps how alive each cell is to color — dark where the field is empty, bright where a creature is dense. Tap a preset or mix your own.",
                    paletteRegistry: PALETTES,
                    legendHTML:
                        '<div class="palette-legend"><span>Empty</span><span>Full</span></div>',
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
                        "Choose what the field starts as — gliders ready to swim, a scatter of cells, or a soup that settles into creatures on its own. Changes restart the simulation right away.",
                    chipLabel: "What it starts as",
                    chips: PATTERNS,
                    getName: () => state.pattern.name,
                    onSelect: (id) => {
                        state.pattern.name = id;
                    },
                    onRandomize: () => {
                        state.pattern.name = randItem(PATTERNS.items).id;
                        state.pattern.regionSize = 0.3 + Math.random() * 0.6;
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
                        "Every cell looks at a soft ring of neighbors around it and counts how much is alive there. A bell curve decides its fate: near the sweet spot it grows, too little or too much and it fades. From that one rule, creatures swim. Small changes transform everything.",
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
                        // Creature size resizes the kernel; rebuild it live.
                        onApply:
                            def.key === "R"
                                ? (v) => {
                                      state.params.R = v;
                                      buildKernel(v);
                                      buildKernelOffsets();
                                  }
                                : undefined,
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

            // Painting life is Lenia-specific; wire pointer to the canvas.
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

            buildKernel(state.params.R);
            allocateGrid();
            seedField();
        },

        resize() {
            const s = getSize();
            W = s.W;
            H = s.H;
            dpr = s.dpr;
            rebuildGrid();
        },

        refreshPalette,

        // Quality sizes the grid, so a level change reallocates + re-seeds it.
        onQualityChange() {
            rebuildGrid();
        },

        // Restoring defaults can change quality (grid) and R (kernel). The shell
        // resets state to defaults, calls this hook, then later calls reset().
        onRestoreDefaults() {
            buildKernel(state.params.R);
            allocateGrid();
        },

        step() {
            if (pointerActive) paintBrush();
            leniaStep();
        },

        render() {
            // While paused, still let the brush paint once per frame.
            if (!isPlaying() && pointerActive) paintBrush();

            const data = offImage.data;
            const cells = Wg * Hg;
            for (let i = 0; i < cells; i++) {
                let idx = (A[i] * 255) | 0;
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
            buildKernel(state.params.R);
            buildKernelOffsets();
        },
    });
})();
