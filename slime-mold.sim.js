/* ============================================================================
 * slime-mold.sim.js — the Slime Mold sim, driven through the SimShell contract.
 *
 * A Physarum-style agent simulation: thousands of agents wander a wrapping
 * (toroidal) pheromone field, each sensing the trail just ahead (left/center/
 * right), steering toward the brightest reading, and depositing a little trail
 * of its own. Between agent steps the field diffuses with a 3x3 blur and decays,
 * so the swarm self-organizes into branching, vein-like networks. It is a
 * HYBRID of the particle sims (typed-array agents with a heading) and the grid
 * sims (a Float32 field rendered through an offscreen ImageData) — so it mirrors
 * boids' heading control and reaction-diffusion's grid realloc-on-resize. All
 * chrome (modals, toolbar, persistence, share, recording, the rAF loop) lives in
 * sim-shell.js; this file owns only the simulation + its palette/seed data.
 *
 * Buffers (the Float32 field + its scratch, the agent x/y/angle arrays, the
 * offscreen canvas + ImageData) are module-locals, NEVER in state — state stays
 * JSON-serializable.
 * ========================================================================== */

(() => {
    "use strict";

    const { registry, randItem, hexToRgb, hslHex, hexToHsl } = SimShell;

    // ------------------------------------------------------------------
    // STATE (JSON-serializable — the shell persists/serializes this verbatim)
    // ------------------------------------------------------------------
    const state = {
        params: {
            count: 12000,
            sensorAngle: 22,
            sensorDist: 9,
            turnAngle: 35,
            speed: 1.0,
            deposit: 5,
            decay: 0.05,
            diffuse: 0.18,
        },
        pattern: {
            name: "Disc",
            heading: "Tangential",
            fixedAngle: 0,
            regionSize: 0.5,
        },
        palette: {
            mode: "preset", // 'preset' | 'custom'
            name: "Inferno",
            custom: { hue: 130, accentHue: 60, saturation: 85 },
        },
        settings: {
            resetOnRandomize: true,
            randomizeColor: true,
            randomizePattern: true,
            quality: "high",
            fps: 60,
            simSpeed: 1,
            showSpeed: false,
            showPause: false,
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
            key: "count",
            group: "The crowd",
            label: "Crowd size",
            hint: "How many walkers roam the screen.",
            min: 200,
            max: 40000,
            step: 100,
            fmt: (v) => v.toFixed(0),
        },
        {
            key: "sensorAngle",
            group: "How they explore",
            label: "Look width",
            hint: "How wide a walker checks for trails ahead.",
            min: 0,
            max: 90,
            step: 0.5,
            fmt: (v) => v.toFixed(1) + "°",
        },
        {
            key: "sensorDist",
            group: "How they explore",
            label: "Look ahead",
            hint: "How far ahead a walker looks for trails.",
            min: 1,
            max: 30,
            step: 0.5,
            fmt: (v) => v.toFixed(1),
        },
        {
            key: "turnAngle",
            group: "How they explore",
            label: "Turn sharpness",
            hint: "How hard a walker steers toward a trail it spots.",
            min: 0,
            max: 90,
            step: 0.5,
            fmt: (v) => v.toFixed(1) + "°",
        },
        {
            key: "speed",
            group: "The crowd",
            label: "Speed",
            hint: "How fast each walker moves.",
            min: 0.3,
            max: 3.0,
            step: 0.05,
            fmt: (v) => v.toFixed(2),
        },
        {
            key: "deposit",
            group: "Trails",
            label: "Trail strength",
            hint: "How bold a trail each walker leaves behind.",
            min: 0.5,
            max: 20,
            step: 0.5,
            fmt: (v) => v.toFixed(1),
        },
        {
            key: "decay",
            group: "Trails",
            label: "Trail fade",
            hint: "How quickly trails fade away.",
            min: 0.005,
            max: 0.3,
            step: 0.005,
            fmt: (v) => v.toFixed(3),
        },
        {
            key: "diffuse",
            group: "Trails",
            label: "Trail spread",
            hint: "How much trails blur into nearby space.",
            min: 0,
            max: 0.6,
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
            { id: "Center", label: "Center" },
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
        "Disc",
    );

    const HEADINGS = registry(
        [
            { id: "Random", label: "Random" },
            { id: "Inward", label: "Toward center" },
            { id: "Outward", label: "Away from center" },
            { id: "Tangential", label: "Spinning" },
            { id: "Fixed", label: "Fixed", usesAngle: true },
        ],
        "Tangential",
    );

    // Quality baseline: the grid-cell target at the default level (high = 1.0).
    // computeGridSize multiplies this by ctx.qualityScalar() — the shell owns
    // the level enum + scalar ladder.
    const GRID_BASELINE = 220000;
    const MAX_PARTICLES = 40000;

    const randomRanges = {
        count: [3000, 25000],
        sensorAngle: [5, 55],
        sensorDist: [3, 22],
        turnAngle: [5, 70],
        speed: [0.5, 1.8],
        deposit: [2, 12],
        decay: [0.01, 0.12],
        diffuse: [0.05, 0.4],
    };

    // ------------------------------------------------------------------
    // CANVAS & FIELD (module-locals — NOT in state)
    // ------------------------------------------------------------------
    let canvas, ctx, getSize, qualityScalar;
    // Offscreen grid-sized canvas: the pheromone field is rendered into this at
    // grid resolution, then drawn (scaled, smoothed) onto the shell's viewport-
    // sized main canvas — same approach as the reaction-diffusion sim. The
    // original wrote ImageData straight to a grid-sized #canvas; the shared
    // shell now sizes the main canvas to the viewport (× dpr), so we composite
    // through an offscreen buffer instead to preserve the look.
    const offscreen =
        typeof document !== "undefined"
            ? document.createElement("canvas")
            : null;
    const offCtx = offscreen ? offscreen.getContext("2d") : null;

    let W = 0, // simulation grid width
        H = 0; // simulation grid height
    let Wv = 0, // viewport width (CSS px)
        Hv = 0,
        dpr = 1;
    let field, nextField, imageData, pixels;

    // Particles (agents): position + heading angle in parallel typed arrays.
    const px = new Float32Array(MAX_PARTICLES);
    const py = new Float32Array(MAX_PARTICLES);
    const pa = new Float32Array(MAX_PARTICLES);

    let paletteLUT;

    // computeGridSize: the simulation grid is sized to hit the quality target
    // cell count at the current viewport aspect — verbatim from the original.
    function computeGridSize() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const aspect = vw / vh;
        const target = GRID_BASELINE * qualityScalar();
        const Hg = Math.max(60, Math.round(Math.sqrt(target / aspect)));
        const Wg = Math.max(60, Math.round(Hg * aspect));
        return { W: Wg, H: Hg };
    }

    function allocateField(newW, newH) {
        const oldW = W,
            oldH = H;
        W = newW;
        H = newH;

        field = new Float32Array(W * H);
        nextField = new Float32Array(W * H);

        offscreen.width = W;
        offscreen.height = H;
        imageData = offCtx.createImageData(W, H);
        pixels = imageData.data;

        if (oldW > 0 && oldH > 0) {
            const sx = W / oldW,
                sy = H / oldH;
            for (let i = 0; i < MAX_PARTICLES; i++) {
                px[i] *= sx;
                py[i] *= sy;
                if (px[i] < 0) px[i] += W;
                else if (px[i] >= W) px[i] -= W;
                if (py[i] < 0) py[i] += H;
                else if (py[i] >= H) py[i] -= H;
            }
        }
    }

    // ------------------------------------------------------------------
    // COLOR / PALETTE
    // ------------------------------------------------------------------
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
    }

    // ------------------------------------------------------------------
    // PARTICLE SEEDING
    // ------------------------------------------------------------------
    function seedParticles() {
        const n = state.params.count;
        const cx = W / 2,
            cy = H / 2;
        const maxR = Math.min(W, H) * 0.45 * state.pattern.regionSize;
        const headingMode = state.pattern.heading;
        const fixedAngle = (state.pattern.fixedAngle * Math.PI) / 180;

        for (let i = 0; i < n; i++) {
            let x, y;
            switch (state.pattern.name) {
                case "Scatter": {
                    x = Math.random() * W;
                    y = Math.random() * H;
                    break;
                }
                case "Ring": {
                    const theta = Math.random() * Math.PI * 2;
                    x = cx + Math.cos(theta) * maxR;
                    y = cy + Math.sin(theta) * maxR;
                    break;
                }
                case "Disc": {
                    const r = Math.sqrt(Math.random()) * maxR;
                    const theta = Math.random() * Math.PI * 2;
                    x = cx + Math.cos(theta) * r;
                    y = cy + Math.sin(theta) * r;
                    break;
                }
                case "Center": {
                    x = cx;
                    y = cy;
                    break;
                }
                case "Edges": {
                    const edge = Math.floor(Math.random() * 4);
                    if (edge === 0) {
                        x = Math.random() * W;
                        y = 1;
                    } else if (edge === 1) {
                        x = W - 1;
                        y = Math.random() * H;
                    } else if (edge === 2) {
                        x = Math.random() * W;
                        y = H - 1;
                    } else {
                        x = 1;
                        y = Math.random() * H;
                    }
                    break;
                }
                case "Grid": {
                    const cols = Math.ceil(Math.sqrt((n * W) / Math.max(H, 1)));
                    const col = i % cols;
                    const row = Math.floor(i / cols);
                    x = ((col + 0.5) * W) / cols + (Math.random() - 0.5) * 4;
                    y =
                        ((row + 0.5) * H) / Math.ceil(n / cols) +
                        (Math.random() - 0.5) * 4;
                    break;
                }
                case "TwoBlobs":
                case "FourBlobs": {
                    const blobCount = PATTERNS.byId(state.pattern.name).blobCount;
                    const blobIdx = i % blobCount;
                    const blobAngle = (blobIdx / blobCount) * Math.PI * 2;
                    const bdist =
                        Math.min(W, H) * 0.28 * state.pattern.regionSize;
                    const bcx = cx + Math.cos(blobAngle) * bdist;
                    const bcy = cy + Math.sin(blobAngle) * bdist;
                    const r = Math.sqrt(Math.random()) * Math.min(W, H) * 0.08;
                    const theta = Math.random() * Math.PI * 2;
                    x = bcx + Math.cos(theta) * r;
                    y = bcy + Math.sin(theta) * r;
                    break;
                }
                default:
                    x = Math.random() * W;
                    y = Math.random() * H;
            }

            // Heading
            const dx = x - cx,
                dy = y - cy;
            const angleFromCenter = Math.atan2(dy, dx);
            let a;
            switch (headingMode) {
                case "Random":
                    a = Math.random() * Math.PI * 2;
                    break;
                case "Inward":
                    a = angleFromCenter + Math.PI + (Math.random() - 0.5) * 0.3;
                    break;
                case "Outward":
                    a = angleFromCenter + (Math.random() - 0.5) * 0.3;
                    break;
                case "Tangential":
                    a =
                        angleFromCenter +
                        Math.PI / 2 +
                        (Math.random() - 0.5) * 0.3;
                    break;
                case "Fixed":
                    a = fixedAngle + (Math.random() - 0.5) * 0.3;
                    break;
                default:
                    a = Math.random() * Math.PI * 2;
            }

            // Clamp to canvas
            if (x < 0) x = 0;
            else if (x >= W) x = W - 1;
            if (y < 0) y = 0;
            else if (y >= H) y = H - 1;

            px[i] = x;
            py[i] = y;
            pa[i] = a;
        }
    }

    function resetAll() {
        if (field) field.fill(0);
        if (nextField) nextField.fill(0);
        seedParticles();
    }

    // ------------------------------------------------------------------
    // SIMULATION
    // ------------------------------------------------------------------
    // Diffuse a single border cell with the same 3x3 kernel the interior loop
    // uses, but with neighbor indices wrapped toroidally. The field is a torus
    // just like agent motion, sensors, and deposits already are; without this
    // the 1px border only decayed, leaving a sticky, discontinuous seam at the
    // edges that made agents bunch up there. Only the perimeter needs the
    // wrapping branch — interior cells stay on the fast branch-free loop in
    // simulate().
    function diffuseEdgeCell(x, y, dc, dn, decayMul) {
        const xm = x === 0 ? W - 1 : x - 1;
        const xp = x === W - 1 ? 0 : x + 1;
        const ym = y === 0 ? H - 1 : y - 1;
        const yp = y === H - 1 ? 0 : y + 1;
        const rm = ym * W,
            r = y * W,
            rp = yp * W;
        const sum =
            field[rm + xm] +
            field[rm + x] +
            field[rm + xp] +
            field[r + xm] +
            field[r + xp] +
            field[rp + xm] +
            field[rp + x] +
            field[rp + xp];
        nextField[r + x] = (field[r + x] * dc + sum * dn) * decayMul;
    }

    function simulate() {
        const n = state.params.count;
        const sa = (state.params.sensorAngle * Math.PI) / 180;
        const ta = (state.params.turnAngle * Math.PI) / 180;
        const sd = state.params.sensorDist;
        const sp = state.params.speed;
        const dep = state.params.deposit;

        for (let i = 0; i < n; i++) {
            const x = px[i],
                y = py[i],
                a = pa[i];

            const xC = x + Math.cos(a) * sd;
            const yC = y + Math.sin(a) * sd;
            const xL = x + Math.cos(a - sa) * sd;
            const yL = y + Math.sin(a - sa) * sd;
            const xR = x + Math.cos(a + sa) * sd;
            const yR = y + Math.sin(a + sa) * sd;

            let ix, iy;
            ix = xC | 0;
            if (ix < 0) ix += W;
            else if (ix >= W) ix -= W;
            iy = yC | 0;
            if (iy < 0) iy += H;
            else if (iy >= H) iy -= H;
            const vC = field[iy * W + ix];

            ix = xL | 0;
            if (ix < 0) ix += W;
            else if (ix >= W) ix -= W;
            iy = yL | 0;
            if (iy < 0) iy += H;
            else if (iy >= H) iy -= H;
            const vL = field[iy * W + ix];

            ix = xR | 0;
            if (ix < 0) ix += W;
            else if (ix >= W) ix -= W;
            iy = yR | 0;
            if (iy < 0) iy += H;
            else if (iy >= H) iy -= H;
            const vR = field[iy * W + ix];

            let na = a;
            if (vC > vL && vC > vR) {
                /* keep heading */
            } else if (vC < vL && vC < vR) {
                na += (Math.random() < 0.5 ? -1 : 1) * ta;
            } else if (vR > vL) {
                na += ta;
            } else if (vL > vR) {
                na -= ta;
            }

            let nx = x + Math.cos(na) * sp;
            let ny = y + Math.sin(na) * sp;
            if (nx < 0) nx += W;
            else if (nx >= W) nx -= W;
            if (ny < 0) ny += H;
            else if (ny >= H) ny -= H;

            px[i] = nx;
            py[i] = ny;
            pa[i] = na;

            const dx = nx | 0;
            const dy = ny | 0;
            field[dy * W + dx] += dep;
        }

        const d = state.params.diffuse;
        const dn = d / 8;
        const dc = 1 - d;
        const decayMul = 1 - state.params.decay;

        for (let y = 1; y < H - 1; y++) {
            const row = y * W;
            for (let x = 1; x < W - 1; x++) {
                const i = row + x;
                const sum =
                    field[i - W - 1] +
                    field[i - W] +
                    field[i - W + 1] +
                    field[i - 1] +
                    field[i + 1] +
                    field[i + W - 1] +
                    field[i + W] +
                    field[i + W + 1];
                nextField[i] = (field[i] * dc + sum * dn) * decayMul;
            }
        }
        for (let x = 0; x < W; x++) {
            diffuseEdgeCell(x, 0, dc, dn, decayMul);
            diffuseEdgeCell(x, H - 1, dc, dn, decayMul);
        }
        for (let y = 1; y < H - 1; y++) {
            diffuseEdgeCell(0, y, dc, dn, decayMul);
            diffuseEdgeCell(W - 1, y, dc, dn, decayMul);
        }

        const tmp = field;
        field = nextField;
        nextField = tmp;
    }

    function render() {
        // Pointer deposit runs every rendered frame while the pointer is held
        // (regardless of play state) — exactly as the original loop did, which
        // called depositAtPointer() outside its playing/paused branch.
        if (pointerDown) depositAtPointer();

        const N = W * H;
        for (let i = 0; i < N; i++) {
            // Amplify the faint pheromone field ~4x to index the 256-entry LUT.
            const v = field[i] * 4;
            const idx = v >= 255 ? 255 : v < 0 ? 0 : v | 0;
            const p = i * 4;
            const q = idx * 4;
            pixels[p] = paletteLUT[q];
            pixels[p + 1] = paletteLUT[q + 1];
            pixels[p + 2] = paletteLUT[q + 2];
            pixels[p + 3] = 255;
        }
        offCtx.putImageData(imageData, 0, 0);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(offscreen, 0, 0, Wv, Hv);
    }

    // ------------------------------------------------------------------
    // INTERACTION (mouse / touch) — redirect agents + splat the field
    // ------------------------------------------------------------------
    let pointerDown = false;
    let pointerX = 0,
        pointerY = 0;

    function pointerToCell(e) {
        const rect = canvas.getBoundingClientRect();
        pointerX = ((e.clientX - rect.left) / rect.width) * W;
        pointerY = ((e.clientY - rect.top) / rect.height) * H;
    }

    function depositAtPointer() {
        // Redirect particles to the pointer + drop a small splat
        const N = 80;
        for (let i = 0; i < N; i++) {
            const idx = Math.floor(Math.random() * state.params.count);
            px[idx] = pointerX + (Math.random() - 0.5) * 6;
            py[idx] = pointerY + (Math.random() - 0.5) * 6;
            pa[idx] = Math.random() * Math.PI * 2;
        }
        const r = 6;
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > r * r) continue;
                let ix = (pointerX + dx) | 0;
                let iy = (pointerY + dy) | 0;
                if (ix < 0) ix += W;
                else if (ix >= W) ix -= W;
                if (iy < 0) iy += H;
                else if (iy >= H) iy -= H;
                field[iy * W + ix] += 30;
            }
        }
    }

    // ------------------------------------------------------------------
    // SHELL CONTRACT
    // ------------------------------------------------------------------
    SimShell.registerSim({
        id: "slime-mold",
        state,
        defaultState,
        // Field sim: the grid is sized to the viewport aspect and stretched to
        // fill the screen, so it already scales cleanly. Opt out of the shell's
        // world scaling and work in raw viewport pixels.
        worldScale: false,
        // id matches the page's filename stem, like every other sim — so the
        // shell's default storage keys (`slime-mold-state` / `slime-mold-windows`)
        // and recording filename (`slime-mold-<ts>.webm`) all follow the same
        // convention. The feed keys sims by this stem too.
        config: {
            keys: { ls: "slime-mold-state", win: "slime-mold-windows" },
            modals: {
                color: {
                    intro:
                        "Set the colors a trail glows through as it builds. Tap a preset or mix your own.",
                    paletteRegistry: PALETTES,
                    legendHTML:
                        '<div class="palette-legend"><span>Faint trail</span><span>Bright trail</span></div>',
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
                        "Choose where the walkers begin and which way they face. Changes restart the crowd right away.",
                    chipLabel: "Where they start",
                    chips: PATTERNS,
                    getName: () => state.pattern.name,
                    onSelect: (id) => {
                        state.pattern.name = id;
                    },
                    onRandomize: () => {
                        state.pattern.name = randItem(PATTERNS.items).id;
                        state.pattern.heading = randItem(HEADINGS.items).id;
                        state.pattern.fixedAngle = Math.floor(
                            Math.random() * 360,
                        );
                        state.pattern.regionSize = 0.25 + Math.random() * 0.65;
                    },
                    // Second control axis: "Which way they face" — a heading
                    // chip row plus a facing-direction slider shown only for
                    // "Fixed". Mirrors boids' heading control.
                    secondaryChips: {
                        label: "Which way they face",
                        chips: HEADINGS,
                        getName: () => state.pattern.heading,
                        onSelect: (id) => {
                            state.pattern.heading = id;
                        },
                    },
                    secondarySlider: {
                        label: "Facing direction",
                        min: 0,
                        max: 359,
                        step: 1,
                        fmt: (v) => v + "°",
                        get: () => state.pattern.fixedAngle,
                        set: (v) => {
                            state.pattern.fixedAngle = v;
                        },
                        visibleFor: (id) => !!HEADINGS.byId(id).usesAngle,
                    },
                    regionSlider: {
                        label: "Cluster size",
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
                        "Each walker leaves a glowing trail and steers toward the trails it sees ahead, while old ones fade.",
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
                        // Growing the crowd spawns the newly needed agents so
                        // they appear immediately, exactly like the original.
                        onApply:
                            def.key === "count"
                                ? (v) => {
                                      if (v > state.params.count) {
                                          for (
                                              let i = state.params.count;
                                              i < v;
                                              i++
                                          ) {
                                              px[i] = Math.random() * W;
                                              py[i] = Math.random() * H;
                                              pa[i] = Math.random() * Math.PI * 2;
                                          }
                                      }
                                      state.params.count = v;
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
            qualityScalar = ctx2.qualityScalar;

            const s = getSize();
            Wv = s.W;
            Hv = s.H;
            dpr = s.dpr;

            // Pointer interaction is slime-specific; wire it to the canvas.
            canvas.addEventListener("pointerdown", (e) => {
                e.preventDefault();
                pointerDown = true;
                pointerToCell(e);
                depositAtPointer();
            });
            canvas.addEventListener("pointermove", (e) => {
                if (!pointerDown) return;
                pointerToCell(e);
            });
            window.addEventListener("pointerup", () => {
                pointerDown = false;
            });

            const { W: initW, H: initH } = computeGridSize();
            allocateField(initW, initH);
            seedParticles();
        },

        // The pheromone field is sized to the viewport (via the quality target
        // at the current aspect), so a genuine resize reallocates the grid at
        // the new aspect — exactly as the original onResize did. allocateField
        // rescales the existing particle positions into the new grid; the field
        // contents are dropped (fresh zeroed buffers), matching the original.
        resize(rescale) {
            const s = getSize();
            Wv = s.W;
            Hv = s.H;
            dpr = s.dpr;
            const { W: nw, H: nh } = computeGridSize();
            if (nw !== W || nh !== H) allocateField(nw, nh);
        },

        refreshPalette,

        // Quality drives the grid-cell target, so a level change reallocates
        // the field (rescaling particle positions) — what the old in-modal
        // segmented onChange did.
        onQualityChange() {
            const { W: nw, H: nh } = computeGridSize();
            if (nw !== W || nh !== H) allocateField(nw, nh);
        },

        // Restoring defaults can change the quality, which sizes the grid. The
        // shell resets state to defaults, calls this hook, then later calls
        // reset(). So reallocate the grid for the restored quality here; the
        // downstream reset() → resetAll() does the field clear + re-seed,
        // reproducing the original restore (recompute grid, allocate, reset).
        onRestoreDefaults() {
            const { W: nw, H: nh } = computeGridSize();
            if (nw !== W || nh !== H) allocateField(nw, nh);
        },

        step() {
            simulate();
        },

        render() {
            render();
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
                if (def.key === "count" && v > state.params.count) {
                    for (let i = state.params.count; i < v; i++) {
                        px[i] = Math.random() * W;
                        py[i] = Math.random() * H;
                        pa[i] = Math.random() * Math.PI * 2;
                    }
                }
                state.params[def.key] = v;
            });
        },
    });
})();
