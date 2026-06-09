/* ============================================================================
 * particle-life.sim.js — the Particle Life sim, driven through the SimShell
 * contract.
 *
 * N species of particles attract and repel one another by a random interaction
 * matrix; cells, chasers, chains and lifelike structures self-assemble from
 * those simple per-pair pulls. A uniform spatial grid keeps the neighbor scan
 * near O(n) so the swarm can grow into the thousands. All chrome (modals,
 * toolbar, persistence, share, recording, the rAF loop) lives in sim-shell.js;
 * this file owns only the simulation + its palette/seed/species data.
 * ========================================================================== */

(() => {
    "use strict";

    const { registry, randItem, hexToRgb, hslHex, hexToHsl } = SimShell;

    // ------------------------------------------------------------------
    // STATE (JSON-serializable — the shell persists/serializes this verbatim)
    // ------------------------------------------------------------------
    const state = {
        params: {
            count: 1200,
            types: 4,
            rMax: 62,
            force: 0.5,
            friction: 0.12,
            beta: 0.3,
        },
        // The attraction matrix: a flat types*types grid of values in
        // [-1, 1]. matrix[a*types+b] is how species a feels about b.
        // Persisted and shared so a link reproduces the behavior. The live sim
        // uses the `matrix` Float32Array module-local below; this plain array
        // mirrors it for serialization.
        matrix: [],
        pattern: {
            name: "Scatter",
            regionSize: 0.5,
        },
        palette: {
            mode: "preset", // 'preset' | 'custom'
            name: "Twilight",
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
    // The particle-life controls. Grouped so the Parameters panel reads top to
    // bottom: the swarm itself, the forces between species, and the distances
    // those forces act over.
    const slidersDef = [
        {
            key: "count",
            group: "The swarm",
            label: "Particle count",
            hint: "How many particles fill the screen.",
            min: 100,
            max: 4000,
            step: 10,
            fmt: (v) => v.toFixed(0),
        },
        {
            key: "types",
            group: "The swarm",
            label: "Species",
            hint: "How many species interact. Each new count rolls fresh rules.",
            min: 2,
            max: 8,
            step: 1,
            fmt: (v) => v.toFixed(0),
        },
        {
            key: "force",
            group: "Forces",
            label: "Force strength",
            hint: "How hard species pull on and push away from each other.",
            min: 0.05,
            max: 1.5,
            step: 0.05,
            fmt: (v) => v.toFixed(2),
        },
        {
            key: "friction",
            group: "Forces",
            label: "Friction",
            hint: "How quickly particles shed speed and settle.",
            min: 0.02,
            max: 0.6,
            step: 0.01,
            fmt: (v) => v.toFixed(2),
        },
        {
            key: "rMax",
            group: "Range",
            label: "Reach",
            hint: "How far a particle senses others, in pixels.",
            min: 20,
            max: 200,
            step: 1,
            fmt: (v) => v.toFixed(0),
        },
        {
            key: "beta",
            group: "Range",
            label: "Close-range repel",
            hint: "An inner zone where every species pushes apart, so they never collapse.",
            min: 0.1,
            max: 0.5,
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
            {
                id: "Rainbow",
                label: "Rainbow",
                stops: ["#0a0a0a", "#ff5050", "#ffe64d", "#4dd2ff", "#c060ff"],
            },
        ],
        "Iris",
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
        "Scatter",
    );

    const MAX_PARTICLES = 4000;
    // The shell runs this sim in a fixed virtual world and zooms it to fit
    // (sim.worldScale, default on), so a fixed crowd already keeps a constant
    // density across screens — the count is a plain particle count again.
    const MIN_ACTIVE = 60;
    // How many particles are actually simulated/rendered right now, derived
    // from the base count and the settings multiplier (see targetCount /
    // reconcileCount).
    let activeCount = 0;

    const randomRanges = {
        count: [600, 2500],
        types: [3, 7],
        rMax: [40, 140],
        force: [0.2, 1.0],
        friction: [0.05, 0.3],
        beta: [0.15, 0.45],
    };

    // ------------------------------------------------------------------
    // CANVAS / BUFFERS (filled in on init)
    // ------------------------------------------------------------------
    let canvas, ctx;
    let W = 0,
        H = 0,
        dpr = 1;
    let getSize = () => ({ W: 0, H: 0, dpr: 1 });
    let qualityScalar = () => 1;

    // Interaction strength is fixed at the old slider's max (the per-sim
    // "Click / touch pull" setting was removed). The value is the peak
    // velocity kick right under the pointer, fading to zero at the radius edge.
    const POINTER_PUSH = 2.4;

    // Particles: position, velocity, and species in parallel arrays.
    const px = new Float32Array(MAX_PARTICLES);
    const py = new Float32Array(MAX_PARTICLES);
    const pvx = new Float32Array(MAX_PARTICLES);
    const pvy = new Float32Array(MAX_PARTICLES);
    const ptype = new Int8Array(MAX_PARTICLES);

    // The attraction matrix as a flat Float32Array used by the sim;
    // state.matrix mirrors it for persistence/sharing.
    let matrix = new Float32Array(0);

    // ------------------------------------------------------------------
    // COLOR / PALETTE
    // ------------------------------------------------------------------
    let paletteLUT;
    // One prebuilt "rgb(r,g,b)" string per species, so the render loop never
    // builds a color string per particle.
    let typeColorStr = [];
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

    // Give each species its own color by sampling evenly along the palette
    // ramp, biased toward the brighter half so no species disappears into the
    // dark background.
    function buildTypeColors() {
        const K = state.params.types;
        typeColorStr = new Array(K);
        for (let k = 0; k < K; k++) {
            const t = K === 1 ? 0.8 : 0.35 + 0.65 * (k / (K - 1));
            let idx = (t * 255) | 0;
            if (idx > 255) idx = 255;
            const q = idx * 4;
            typeColorStr[k] =
                "rgb(" +
                paletteLUT[q] +
                "," +
                paletteLUT[q + 1] +
                "," +
                paletteLUT[q + 2] +
                ")";
        }
    }

    // Called by the shell whenever the resolved palette stops change.
    function refreshPalette(stops) {
        paletteLUT = buildPaletteLUT(stops);
        const bg = hexToRgb(stops[0]);
        bgR = bg[0];
        bgG = bg[1];
        bgB = bg[2];
        buildTypeColors();
        // The shell repaints the #type-swatches via colorCfg.extra.sync() right
        // after this returns (see sim-shell applyPalette).
    }

    // ------------------------------------------------------------------
    // COLOR MODAL EXTRA: per-species swatch row (#type-swatches). The shell
    // appends this into the color modal's Custom section and re-syncs it on
    // every palette change via colorCfg.extra below.
    // ------------------------------------------------------------------
    let typeSwatches = null;
    // One dot per species in its actual particle color.
    function updateTypeSwatches() {
        if (!typeSwatches) return;
        typeSwatches.innerHTML = "";
        for (let k = 0; k < typeColorStr.length; k++) {
            const dot = document.createElement("span");
            dot.className = "dot";
            dot.style.background = typeColorStr[k];
            typeSwatches.appendChild(dot);
        }
    }

    // ------------------------------------------------------------------
    // RULES: attraction matrix + species assignment
    // ------------------------------------------------------------------
    function regenMatrix() {
        const K = state.params.types;
        matrix = new Float32Array(K * K);
        for (let i = 0; i < K * K; i++) {
            matrix[i] = Math.random() * 2 - 1;
        }
        state.matrix = Array.from(matrix);
    }

    function assignTypes() {
        const K = state.params.types;
        for (let i = 0; i < MAX_PARTICLES; i++) {
            ptype[i] = (Math.random() * K) | 0;
        }
    }

    // Change species count: roll fresh rules, reassign every particle to a
    // valid species, and rebuild the per-species colors. Positions are left
    // alone so you see new rules act on the same arrangement.
    function setTypes(K) {
        state.params.types = K;
        regenMatrix();
        assignTypes();
        buildTypeColors();
        updateTypeSwatches();
    }

    // ------------------------------------------------------------------
    // PARTICLE SEEDING
    // ------------------------------------------------------------------
    function seedParticles() {
        const n = activeCount;
        const cx = W / 2,
            cy = H / 2;
        const maxR = Math.min(W, H) * 0.45 * state.pattern.regionSize;

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
                    x = cx + (Math.random() - 0.5) * 8;
                    y = cy + (Math.random() - 0.5) * 8;
                    break;
                }
                case "Edges": {
                    const edge = Math.floor(Math.random() * 4);
                    if (edge === 0) {
                        x = Math.random() * W;
                        y = 2;
                    } else if (edge === 1) {
                        x = W - 2;
                        y = Math.random() * H;
                    } else if (edge === 2) {
                        x = Math.random() * W;
                        y = H - 2;
                    } else {
                        x = 2;
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

            if (x < 0) x = 0;
            else if (x >= W) x = W - 1;
            if (y < 0) y = 0;
            else if (y >= H) y = H - 1;

            px[i] = x;
            py[i] = y;
            pvx[i] = 0;
            pvy[i] = 0;
        }
    }

    // Spawn a single fresh particle (used when the swarm grows).
    function spawnParticle(i) {
        px[i] = Math.random() * W;
        py[i] = Math.random() * H;
        pvx[i] = 0;
        pvy[i] = 0;
        ptype[i] = (Math.random() * state.params.types) | 0;
    }

    // Live particle target: the base count times the Quality multiplier,
    // clamped to the buffer. Density across screens is handled by the shell's
    // world scaling, not here.
    function targetCount() {
        let n = Math.round(state.params.count * qualityScalar());
        if (n > MAX_PARTICLES) n = MAX_PARTICLES;
        if (n < MIN_ACTIVE) n = MIN_ACTIVE;
        return n;
    }

    // Bring activeCount in line with the target, spawning any newly needed
    // particles. Shrinking just lowers the count; the extra particles keep
    // their state and rejoin if the target grows.
    function reconcileCount() {
        const t = targetCount();
        if (t > activeCount) {
            for (let i = activeCount; i < t; i++) spawnParticle(i);
        }
        activeCount = t;
    }

    function resetAll() {
        activeCount = targetCount();
        seedParticles();
        hardClear();
    }

    // ------------------------------------------------------------------
    // SPATIAL GRID
    // ------------------------------------------------------------------
    // Particles only feel neighbors within their reach, so a uniform grid
    // (cell = reach) turns the naive O(n^2) scan into roughly O(n): each
    // particle only walks its own cell plus the eight around it. Buckets are a
    // head/next linked list over reused typed arrays, so a frame allocates
    // nothing.
    let gridHead = null;
    const gridNext = new Int32Array(MAX_PARTICLES);
    let gCols = 0,
        gRows = 0;
    // Exact cell extents: gCols*gCellW === W (see buildGrid).
    let gCellW = 1,
        gCellH = 1;

    // Up to three unique neighbor-cell indices along one axis, wrapped
    // toroidally. Dedups so tiny grids (1-2 cells wide) never visit the same
    // wrapped cell twice and double-count.
    const cellX = new Int32Array(3);
    const cellY = new Int32Array(3);
    function neighborCells(c, g, out) {
        let a = c - 1,
            d = c + 1;
        if (a < 0) a += g;
        if (d >= g) d -= g;
        out[0] = c;
        let len = 1;
        if (a !== c) out[len++] = a;
        if (d !== c && d !== a) out[len++] = d;
        return len;
    }

    // The cell count is floor(world / reach) so each cell is at least `reach`
    // wide, then cellW = W/gCols makes the grid tile the world *exactly*. That
    // exact tiling is what keeps the toroidal wrap in neighborCells lined up
    // with the min-image period W: a fixed cell that doesn't divide W would
    // leave a narrow edge column, and particles near the seam would then miss
    // their cross-edge neighbors.
    function buildGrid(n, reach) {
        gCols = Math.max(1, Math.floor(W / reach));
        gRows = Math.max(1, Math.floor(H / reach));
        gCellW = W / gCols;
        gCellH = H / gRows;
        const cells = gCols * gRows;
        if (!gridHead || gridHead.length < cells) {
            gridHead = new Int32Array(cells);
        }
        gridHead.fill(-1, 0, cells);
        for (let i = 0; i < n; i++) {
            let cx = (px[i] / gCellW) | 0;
            if (cx < 0) cx = 0;
            else if (cx >= gCols) cx = gCols - 1;
            let cy = (py[i] / gCellH) | 0;
            if (cy < 0) cy = 0;
            else if (cy >= gRows) cy = gRows - 1;
            const c = cy * gCols + cx;
            gridNext[i] = gridHead[c];
            gridHead[c] = i;
        }
    }

    // ------------------------------------------------------------------
    // INTERACTION (mouse / touch) — pointer pushes the swarm away
    // ------------------------------------------------------------------
    let pointerActive = false;
    let pointerX = 0,
        pointerY = 0;

    function pointerToCanvas(e) {
        const rect = canvas.getBoundingClientRect();
        pointerX = ((e.clientX - rect.left) / rect.width) * W;
        pointerY = ((e.clientY - rect.top) / rect.height) * H;
    }

    // ------------------------------------------------------------------
    // SIMULATION
    // ------------------------------------------------------------------
    // Standard particle-life force: universal short-range repulsion below
    // beta, then a triangular attract/repel weighted by the species pair's
    // matrix entry, fading to zero at the reach.
    function simulate() {
        const n = activeCount;
        const K = state.params.types;
        const rMax = state.params.rMax;
        const rMaxSq = rMax * rMax;
        const beta = state.params.beta;
        const fStr = state.params.force;
        const velRetain = 1 - state.params.friction;
        const reach = Math.max(rMax, 1);
        const cap = rMax; // no particle moves more than a reach per step
        const push = pointerActive ? POINTER_PUSH : 0;
        const pushR = 200;
        const pushR2 = pushR * pushR;
        const halfW = W * 0.5,
            halfH = H * 0.5;

        buildGrid(n, reach);

        for (let i = 0; i < n; i++) {
            const x = px[i],
                y = py[i];
            const ti = ptype[i];
            const rowOff = ti * K;
            let fx = 0,
                fy = 0;

            let cgx = (x / gCellW) | 0;
            if (cgx < 0) cgx = 0;
            else if (cgx >= gCols) cgx = gCols - 1;
            let cgy = (y / gCellH) | 0;
            if (cgy < 0) cgy = 0;
            else if (cgy >= gRows) cgy = gRows - 1;

            const nxc = neighborCells(cgx, gCols, cellX);
            const nyc = neighborCells(cgy, gRows, cellY);

            for (let yi = 0; yi < nyc; yi++) {
                const rowBase = cellY[yi] * gCols;
                for (let xi = 0; xi < nxc; xi++) {
                    let j = gridHead[rowBase + cellX[xi]];
                    while (j !== -1) {
                        if (j !== i) {
                            // Minimum-image distance on the torus: each pair
                            // interacts through its nearest wrapped copy.
                            let dx = px[j] - x;
                            let dy = py[j] - y;
                            if (dx > halfW) dx -= W;
                            else if (dx < -halfW) dx += W;
                            if (dy > halfH) dy -= H;
                            else if (dy < -halfH) dy += H;
                            const d2 = dx * dx + dy * dy;
                            if (d2 > 0 && d2 < rMaxSq) {
                                const r = Math.sqrt(d2);
                                const rn = r / rMax;
                                let f;
                                if (rn < beta) {
                                    // Universal close-range shove.
                                    f = rn / beta - 1;
                                } else {
                                    // Triangular attract/repel, peaking
                                    // midway, zero at edges.
                                    const a = matrix[rowOff + ptype[j]];
                                    f =
                                        a *
                                        (1 -
                                            Math.abs(2 * rn - 1 - beta) /
                                                (1 - beta));
                                }
                                const inv = f / r;
                                fx += dx * inv;
                                fy += dy * inv;
                            }
                        }
                        j = gridNext[j];
                    }
                }
            }

            let nvx = pvx[i] * velRetain + fx * fStr;
            let nvy = pvy[i] * velRetain + fy * fStr;

            // Pointer push while pressed: shove particles away from the pointer
            // (via the nearest wrapped copy, so it works across the seam),
            // strongest right under it so a tap opens a clear gap.
            if (push > 0) {
                let ddx = pointerX - x;
                let ddy = pointerY - y;
                if (ddx > halfW) ddx -= W;
                else if (ddx < -halfW) ddx += W;
                if (ddy > halfH) ddy -= H;
                else if (ddy < -halfH) ddy += H;
                const d2 = ddx * ddx + ddy * ddy;
                if (d2 > 0 && d2 < pushR2) {
                    const d = Math.sqrt(d2);
                    const f = ((1 - d / pushR) * push) / d;
                    nvx -= ddx * f;
                    nvy -= ddy * f;
                }
            }

            // Safety clamp so nothing tunnels past the grid.
            const sp = Math.hypot(nvx, nvy);
            if (sp > cap) {
                nvx = (nvx / sp) * cap;
                nvy = (nvy / sp) * cap;
            }

            pvx[i] = nvx;
            pvy[i] = nvy;
        }

        // Integrate positions in a second pass so every particle stepped off
        // the same snapshot. The world is a torus: particles that leave one
        // edge re-enter the opposite one.
        for (let i = 0; i < n; i++) {
            let nx = px[i] + pvx[i];
            let ny = py[i] + pvy[i];
            nx -= Math.floor(nx / W) * W;
            ny -= Math.floor(ny / H) * H;
            px[i] = nx;
            py[i] = ny;
        }
    }

    // ------------------------------------------------------------------
    // RENDER
    // ------------------------------------------------------------------
    function hardClear() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = "rgb(" + bgR + "," + bgG + "," + bgB + ")";
        ctx.fillRect(0, 0, W, H);
    }

    // Crisp dots, hard-cleared each frame so clusters read clearly. Square
    // dots (fillRect) draw far faster than arcs at thousands of particles.
    const DOT = 2.8;
    const DOT_HALF = DOT / 2;
    function render() {
        const n = activeCount;
        // Clear the full canvas in device space.
        hardClear();
        for (let i = 0; i < n; i++) {
            ctx.fillStyle = typeColorStr[ptype[i]];
            ctx.fillRect(px[i] - DOT_HALF, py[i] - DOT_HALF, DOT, DOT);
        }
    }

    // ------------------------------------------------------------------
    // REGISTER
    // ------------------------------------------------------------------
    SimShell.registerSim({
        id: "particle-life",
        state,
        defaultState,
        // Preserve particle-life's legacy storage keys so existing saved state
        // loads, rather than the id-derived namespace new sims get by default.
        config: {
            keys: { ls: "plife-state", win: "plife-windows" },
            modals: {
                color: {
                    intro:
                        "Each species draws its color from the palette. Tap a preset or mix your own. The dots below show every species' current color.",
                    paletteRegistry: PALETTES,
                    generateCustomStops: (c) =>
                        generateCustomPalette(c.hue, c.accentHue, c.saturation),
                    // Derive hue/accent/sat sliders from a chosen preset.
                    presetToCustom: (stops) => {
                        const mid = hexToHsl(stops[2]);
                        const accent = hexToHsl(stops[4]);
                        return {
                            hue: Math.round(mid.h),
                            accentHue: Math.round(accent.h),
                            saturation: Math.round(Math.min(100, mid.s)),
                        };
                    },
                    // particle-life's color legend reads "Species colors", not
                    // the default Slow/Fast.
                    legendHTML:
                        '<div class="palette-legend"><span>Species colors</span></div>',
                    // Per-species swatch row appended into the Custom section,
                    // re-synced on every palette change by the shell.
                    extra: {
                        render: (host) => {
                            typeSwatches = document.createElement("div");
                            typeSwatches.className = "type-swatches";
                            typeSwatches.id = "type-swatches";
                            host.appendChild(typeSwatches);
                            updateTypeSwatches();
                        },
                        sync: () => updateTypeSwatches(),
                    },
                },
                shape: {
                    title: "Starting shape",
                    intro:
                        "Choose where the particles spawn. They start at rest and let the forces take over. Changes restart the simulation right away.",
                    chipLabel: "Where they start",
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
                        "Each species attracts or repels every other, but only within a limited range. Hit Randomize to roll a fresh set of rules.",
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
                        // "Species" rolls fresh rules + reassigns; "Particle
                        // count" sets the base density and reconciles the pool.
                        onApply:
                            def.key === "types"
                                ? (v) => {
                                      setTypes(v);
                                  }
                                : def.key === "count"
                                  ? (v) => {
                                        state.params.count = Math.round(v);
                                        reconcileCount();
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

            // particle-life-specific clamp after restore.
            if (state.params.count > MAX_PARTICLES)
                state.params.count = MAX_PARTICLES;

            const s = getSize();
            W = s.W;
            H = s.H;
            dpr = s.dpr;

            // Restore the shared/persisted matrix if it matches the species
            // count; otherwise roll a fresh one.
            const K0 = state.params.types;
            if (
                Array.isArray(state.matrix) &&
                state.matrix.length === K0 * K0
            ) {
                matrix = Float32Array.from(state.matrix);
            } else {
                regenMatrix();
            }
            assignTypes();

            // Pointer interaction is particle-life-specific; wire it to canvas.
            canvas.addEventListener("pointerdown", (e) => {
                e.preventDefault();
                pointerActive = true;
                pointerToCanvas(e);
            });
            canvas.addEventListener("pointermove", (e) => {
                if (!pointerActive) return;
                pointerToCanvas(e);
            });
            window.addEventListener("pointerup", () => {
                pointerActive = false;
            });

            activeCount = targetCount();
            seedParticles();
        },

        resize(rescale) {
            const oldW = W,
                oldH = H;
            const s = getSize();
            W = s.W;
            H = s.H;
            dpr = s.dpr;
            if (rescale && oldW > 0 && oldH > 0) {
                const sx = W / oldW,
                    sy = H / oldH;
                for (let i = 0; i < MAX_PARTICLES; i++) {
                    px[i] *= sx;
                    py[i] *= sy;
                }
            }
            hardClear();
            // Viewport area changed, so the density target did too.
            reconcileCount();
        },

        refreshPalette,

        // Quality scales the count budget, so a level change reconciles the
        // live pool to the new target.
        onQualityChange() {
            reconcileCount();
        },

        reset() {
            resetAll();
        },

        // Called by the shell during "Restore default settings", AFTER state
        // has been reset to defaults and BEFORE controls/palette re-sync and
        // the re-seed. Plain Reset (fab-reset → reset()/resetAll) deliberately
        // does NOT touch the rules; only restore-defaults rolls a fresh matrix
        // and reassigns species. Rebuild ONLY non-color derived state here —
        // per-species colors and swatches are rebuilt downstream by the shell's
        // applyPalette() → refreshPalette() → colorCfg.extra.sync() sequence.
        onRestoreDefaults() {
            regenMatrix();
            assignTypes();
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
            // New rules every time — that's the heart of "randomize". Also
            // reassigns species so the fresh count takes effect.
            setTypes(state.params.types);
            // Match the live pool to the new base count (Quality scalar applies).
            reconcileCount();
        },

        step() {
            simulate();
        },

        render() {
            render();
        },
    });
})();
