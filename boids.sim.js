/* ============================================================================
 * boids.sim.js — the Boids sim, driven through the SimShell contract.
 *
 * Classic flocking: every boid steers off its neighbors with three simple
 * rules — separation, alignment, cohesion — and a flock emerges with no
 * leader. A uniform spatial grid keeps the neighbor scan near O(n) so the
 * crowd can grow past a few hundred boids. All chrome (modals, toolbar,
 * persistence, share, recording, the rAF loop) lives in sim-shell.js; this
 * file owns only the simulation + its palette/seed data.
 * ========================================================================== */

(() => {
    "use strict";

    const { registry, randItem, hexToRgb, hslHex, hexToHsl } = SimShell;

    // Pointer-push radius (px); squared once to compare against squared
    // distances without a sqrt per boid. POINTER_PUSH is the peak velocity
    // kick applied right under the pointer, fading to zero at the radius edge.
    // It is set well above maxSpeed (slider max 6) on purpose: the per-boid
    // speed clamp caps outward motion at maxSpeed, so a large value just makes
    // the push reliably win over flocking across the inner radius.
    const POINTER_PUSH_RADIUS = 180;
    const POINTER_PUSH_R2 = POINTER_PUSH_RADIUS * POINTER_PUSH_RADIUS;
    const POINTER_PUSH = 12;

    // Arrowhead glyph dimensions (px): tip ahead of the boid, base behind it,
    // and half the base width to either side.
    const ARROW_TIP = 5.5;
    const ARROW_BASE = 4;
    const ARROW_HALF_WIDTH = 3;

    // ------------------------------------------------------------------
    // STATE (JSON-serializable — the shell persists/serializes this verbatim)
    // ------------------------------------------------------------------
    const state = {
        params: {
            count: 250,
            vision: 46,
            sepDist: 17,
            sep: 0.05,
            align: 0.06,
            coh: 0.0008,
            speed: 2.6,
            edge: 0.6,
        },
        pattern: {
            name: "Scatter",
            heading: "Random",
            fixedAngle: 0,
            regionSize: 0.5,
        },
        palette: {
            mode: "preset", // 'preset' | 'custom'
            name: "Cyber",
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
    // The eight flocking controls, ported from the reference boids sketch.
    // Grouped so the Parameters panel reads top to bottom: the flock itself,
    // what each boid senses, the three rules that weight its steering, and how
    // walls turn it back inward.
    const slidersDef = [
        {
            key: "count",
            group: "The flock",
            label: "Crowd size",
            hint: "How many boids fly at once.",
            min: 20,
            max: 1500,
            step: 1,
            fmt: (v) => v.toFixed(0),
        },
        {
            key: "speed",
            group: "The flock",
            label: "Top speed",
            hint: "The fastest a boid is allowed to fly.",
            min: 0.5,
            max: 8,
            step: 0.1,
            fmt: (v) => v.toFixed(1),
        },
        {
            key: "vision",
            group: "What they sense",
            label: "Vision range",
            hint: "How far a boid sees its neighbors.",
            min: 10,
            max: 200,
            step: 1,
            fmt: (v) => v.toFixed(0),
        },
        {
            key: "sepDist",
            group: "What they sense",
            label: "Personal space",
            hint: "How close a neighbor gets before a boid pushes away.",
            min: 2,
            max: 80,
            step: 1,
            fmt: (v) => v.toFixed(0),
        },
        {
            key: "sep",
            group: "Flocking rules",
            label: "Separation",
            hint: "Strength of the avoid-crowding push.",
            min: 0,
            max: 0.3,
            step: 0.005,
            fmt: (v) => v.toFixed(3),
        },
        {
            key: "align",
            group: "Flocking rules",
            label: "Alignment",
            hint: "How strongly boids match their neighbors' heading.",
            min: 0,
            max: 0.3,
            step: 0.005,
            fmt: (v) => v.toFixed(3),
        },
        {
            key: "coh",
            group: "Flocking rules",
            label: "Cohesion",
            hint: "Pull toward the average position of nearby boids.",
            min: 0,
            max: 0.03,
            step: 0.0005,
            fmt: (v) => v.toFixed(4),
        },
        {
            key: "edge",
            group: "Edges",
            label: "Edge push",
            hint: "How firmly the walls steer boids back inward.",
            min: 0,
            max: 1.5,
            step: 0.05,
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
        "Scatter",
    );

    const HEADINGS = registry(
        [
            { id: "Random", label: "Random" },
            { id: "Inward", label: "Toward center" },
            { id: "Outward", label: "Away from center" },
            { id: "Tangential", label: "Spinning" },
            { id: "Fixed", label: "Fixed", usesAngle: true },
        ],
        "Random",
    );

    const MAX_BOIDS = 1500;

    const randomRanges = {
        count: [80, 600],
        vision: [30, 140],
        sepDist: [10, 45],
        sep: [0.02, 0.2],
        align: [0.02, 0.2],
        coh: [0.002, 0.02],
        speed: [2, 6],
        edge: [0.2, 1.0],
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
    let activeCount = 0;

    // Boids: position + velocity in parallel typed arrays.
    const px = new Float32Array(MAX_BOIDS);
    const py = new Float32Array(MAX_BOIDS);
    const vx = new Float32Array(MAX_BOIDS);
    const vy = new Float32Array(MAX_BOIDS);

    // Faint motion trail: each frame we wash the canvas toward the background
    // color at this alpha, so boids leave a short fading streak that makes the
    // palette gradient read on screen.
    const TRAIL_ALPHA = 0.32;

    // ------------------------------------------------------------------
    // COLOR / PALETTE
    // ------------------------------------------------------------------
    let paletteLUT;
    // 256 prebuilt "rgb(r,g,b)" strings indexed by palette position, so the
    // render loop never builds a color string per boid.
    const colorStr = new Array(256);
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
        for (let i = 0; i < 256; i++) {
            const q = i * 4;
            colorStr[i] =
                "rgb(" +
                paletteLUT[q] +
                "," +
                paletteLUT[q + 1] +
                "," +
                paletteLUT[q + 2] +
                ")";
        }
        // Darkest stop is the canvas background the trails fade into.
        const bg = hexToRgb(stops[0]);
        bgR = bg[0];
        bgG = bg[1];
        bgB = bg[2];
    }

    // ------------------------------------------------------------------
    // BOID SEEDING
    // ------------------------------------------------------------------
    function headingAngle(x, y, cx, cy, mode, fixedAngle) {
        const angleFromCenter = Math.atan2(y - cy, x - cx);
        switch (mode) {
            case "Inward":
                return angleFromCenter + Math.PI + (Math.random() - 0.5) * 0.3;
            case "Outward":
                return angleFromCenter + (Math.random() - 0.5) * 0.3;
            case "Tangential":
                return (
                    angleFromCenter +
                    Math.PI / 2 +
                    (Math.random() - 0.5) * 0.3
                );
            case "Fixed":
                return fixedAngle + (Math.random() - 0.5) * 0.3;
            case "Random":
            default:
                return Math.random() * Math.PI * 2;
        }
    }

    function seedBoids() {
        const n = targetCount();
        activeCount = n;
        const cx = W / 2,
            cy = H / 2;
        const maxR = Math.min(W, H) * 0.45 * state.pattern.regionSize;
        const headingMode = state.pattern.heading;
        const fixedAngle = (state.pattern.fixedAngle * Math.PI) / 180;
        // Seed velocity magnitude: a touch under top speed so the flock settles
        // into its own pace within a few frames.
        const sp = state.params.speed * 0.6;

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

            // Clamp to canvas
            if (x < 0) x = 0;
            else if (x >= W) x = W - 1;
            if (y < 0) y = 0;
            else if (y >= H) y = H - 1;

            const a = headingAngle(x, y, cx, cy, headingMode, fixedAngle);
            px[i] = x;
            py[i] = y;
            vx[i] = Math.cos(a) * sp;
            vy[i] = Math.sin(a) * sp;
        }
    }

    // Spawn a single fresh boid (used when the crowd grows): drop it somewhere
    // random with a random heading so it can join in.
    function spawnBoid(i) {
        px[i] = Math.random() * W;
        py[i] = Math.random() * H;
        const a = Math.random() * Math.PI * 2;
        const sp = state.params.speed * 0.6;
        vx[i] = Math.cos(a) * sp;
        vy[i] = Math.sin(a) * sp;
    }

    // Live boid count: the crowd-size param scaled by the Quality scalar,
    // clamped to the buffer. Quality scales the count budget; the param stays
    // the user's base knob (randomize varies it within the scaled range).
    function targetCount() {
        let n = Math.round(state.params.count * qualityScalar());
        if (n > MAX_BOIDS) n = MAX_BOIDS;
        if (n < 1) n = 1;
        return n;
    }
    // Match the live flock to the target, spawning newly needed boids.
    function reconcileCount() {
        const t = targetCount();
        for (let i = activeCount; i < t; i++) spawnBoid(i);
        activeCount = t;
    }

    function resetAll() {
        seedBoids();
        hardClear();
    }

    // ------------------------------------------------------------------
    // SPATIAL GRID
    // ------------------------------------------------------------------
    // Boids only react to neighbors within their vision radius, so a uniform
    // grid (cell = the larger sensing radius) turns the naive O(n^2) neighbor
    // scan into roughly O(n): each boid only walks its own cell plus the eight
    // around it. Buckets are a head/next linked list over reused typed arrays,
    // so a frame allocates nothing. This is what lets the crowd-size slider go
    // well past a few hundred boids and stay smooth.
    let gridHead = null;
    const gridNext = new Int32Array(MAX_BOIDS);
    let gCols = 0,
        gRows = 0;

    function buildGrid(n, cell) {
        gCols = Math.max(1, Math.ceil(W / cell));
        gRows = Math.max(1, Math.ceil(H / cell));
        const cells = gCols * gRows;
        if (!gridHead || gridHead.length < cells) {
            gridHead = new Int32Array(cells);
        }
        gridHead.fill(-1, 0, cells);
        for (let i = 0; i < n; i++) {
            let cx = (px[i] / cell) | 0;
            if (cx < 0) cx = 0;
            else if (cx >= gCols) cx = gCols - 1;
            let cy = (py[i] / cell) | 0;
            if (cy < 0) cy = 0;
            else if (cy >= gRows) cy = gRows - 1;
            const c = cy * gCols + cx;
            gridNext[i] = gridHead[c];
            gridHead[c] = i;
        }
    }

    // ------------------------------------------------------------------
    // INTERACTION (pointer pushes the flock away)
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
    function simulate() {
        const n = activeCount;
        const vision = state.params.vision;
        const sepDist = state.params.sepDist;
        const visionSq = vision * vision;
        const sepSq = sepDist * sepDist;
        const sepW = state.params.sep;
        const alignW = state.params.align;
        const cohW = state.params.coh;
        const maxSpeed = state.params.speed;
        const minSpeed = maxSpeed * 0.5;
        const edge = state.params.edge;
        const cell = Math.max(vision, sepDist, 1);
        const margin = Math.max(40, Math.min(W, H) * 0.08);
        const push = pointerActive ? POINTER_PUSH : 0;

        buildGrid(n, cell);

        for (let i = 0; i < n; i++) {
            const x = px[i],
                y = py[i];
            let avgVX = 0,
                avgVY = 0;
            let avgPX = 0,
                avgPY = 0;
            let sepX = 0,
                sepY = 0;
            let neighbors = 0;

            let cgx = (x / cell) | 0;
            if (cgx < 0) cgx = 0;
            else if (cgx >= gCols) cgx = gCols - 1;
            let cgy = (y / cell) | 0;
            if (cgy < 0) cgy = 0;
            else if (cgy >= gRows) cgy = gRows - 1;

            const gx0 = cgx > 0 ? cgx - 1 : 0;
            const gx1 = cgx < gCols - 1 ? cgx + 1 : gCols - 1;
            const gy0 = cgy > 0 ? cgy - 1 : 0;
            const gy1 = cgy < gRows - 1 ? cgy + 1 : gRows - 1;

            for (let gy = gy0; gy <= gy1; gy++) {
                const rowBase = gy * gCols;
                for (let gx = gx0; gx <= gx1; gx++) {
                    let j = gridHead[rowBase + gx];
                    while (j !== -1) {
                        if (j !== i) {
                            const dx = px[j] - x;
                            const dy = py[j] - y;
                            const d2 = dx * dx + dy * dy;
                            if (d2 < visionSq) {
                                neighbors++;
                                avgVX += vx[j];
                                avgVY += vy[j];
                                avgPX += px[j];
                                avgPY += py[j];
                                if (d2 < sepSq) {
                                    sepX -= dx;
                                    sepY -= dy;
                                }
                            }
                        }
                        j = gridNext[j];
                    }
                }
            }

            let nvx = vx[i],
                nvy = vy[i];

            if (neighbors > 0) {
                avgVX /= neighbors;
                avgVY /= neighbors;
                avgPX /= neighbors;
                avgPY /= neighbors;

                // Alignment: steer toward neighbors' average heading.
                nvx += (avgVX - nvx) * alignW;
                nvy += (avgVY - nvy) * alignW;

                // Cohesion: drift toward the local flock center.
                nvx += (avgPX - x) * cohW;
                nvy += (avgPY - y) * cohW;
            }

            // Separation: push away from anyone too close.
            nvx += sepX * sepW;
            nvy += sepY * sepW;

            // Pointer push while pressed: shove boids away from the pointer,
            // strongest right under it so a tap opens a clear gap.
            if (push > 0) {
                const ddx = x - pointerX;
                const ddy = y - pointerY;
                const d2 = ddx * ddx + ddy * ddy;
                if (d2 > 0 && d2 < POINTER_PUSH_R2) {
                    const d = Math.sqrt(d2);
                    const f = ((1 - d / POINTER_PUSH_RADIUS) * push) / d;
                    nvx += ddx * f;
                    nvy += ddy * f;
                }
            }

            // Edge turn: a gentle inward nudge near the walls instead of
            // wrapping, so the flock stays on screen.
            if (x < margin) nvx += edge;
            else if (x > W - margin) nvx -= edge;
            if (y < margin) nvy += edge;
            else if (y > H - margin) nvy -= edge;

            // Clamp speed into [minSpeed, maxSpeed].
            const spd = Math.hypot(nvx, nvy);
            if (spd > maxSpeed) {
                nvx = (nvx / spd) * maxSpeed;
                nvy = (nvy / spd) * maxSpeed;
            } else if (spd < minSpeed && spd > 0) {
                nvx = (nvx / spd) * minSpeed;
                nvy = (nvy / spd) * minSpeed;
            }

            vx[i] = nvx;
            vy[i] = nvy;
        }

        // Integrate positions in a second pass so every boid steered off the
        // same snapshot of the flock.
        for (let i = 0; i < n; i++) {
            let nx = px[i] + vx[i];
            let ny = py[i] + vy[i];
            if (nx < 0) nx = 0;
            else if (nx > W) nx = W;
            if (ny < 0) ny = 0;
            else if (ny > H) ny = H;
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

    function render() {
        const n = activeCount;
        const maxSpeed = state.params.speed;
        const minSpeed = maxSpeed * 0.5;
        const span = maxSpeed - minSpeed || 1;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Wash the previous frame toward the background for trails.
        ctx.fillStyle =
            "rgba(" + bgR + "," + bgG + "," + bgB + "," + TRAIL_ALPHA + ")";
        ctx.fillRect(0, 0, W, H);

        for (let i = 0; i < n; i++) {
            const x = px[i],
                y = py[i];
            let dx = vx[i],
                dy = vy[i];
            const spd = Math.hypot(dx, dy);
            let ux = 1,
                uy = 0;
            if (spd > 1e-4) {
                ux = dx / spd;
                uy = dy / spd;
            }

            // Faster boids burn toward the bright end; keep them in the upper
            // portion of the ramp so none vanish into the dark background.
            let t = (spd - minSpeed) / span;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
            let idx = ((0.4 + 0.6 * t) * 255) | 0;
            if (idx > 255) idx = 255;
            ctx.fillStyle = colorStr[idx];

            // A little arrowhead pointing along the velocity.
            const nx = x + ux * ARROW_TIP;
            const ny = y + uy * ARROW_TIP;
            const bx = x - ux * ARROW_BASE;
            const by = y - uy * ARROW_BASE;
            ctx.beginPath();
            ctx.moveTo(nx, ny);
            ctx.lineTo(bx - uy * ARROW_HALF_WIDTH, by + ux * ARROW_HALF_WIDTH);
            ctx.lineTo(bx + uy * ARROW_HALF_WIDTH, by - ux * ARROW_HALF_WIDTH);
            ctx.closePath();
            ctx.fill();
        }
    }

    // ------------------------------------------------------------------
    // REGISTER
    // ------------------------------------------------------------------
    SimShell.registerSim({
        id: "boids",
        state,
        defaultState,
        // Preserve boids' legacy storage keys so existing saved state loads.
        config: {
            keys: { ls: "boids-state", win: "boids-windows" },
            modals: {
                color: {
                    intro:
                        "Set the colors your flock glows through. Each boid is tinted by its speed — the faster it flies, the brighter it burns. Tap a preset or mix your own.",
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
                },
                shape: {
                    title: "Starting shape",
                    intro:
                        "Choose where the flock spawns and which way the boids first head. Changes restart the flock right away.",
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
                    // Second control axis: "Which way they head" — a heading
                    // chip row plus a fixed-angle slider shown only for "Fixed".
                    secondaryChips: {
                        label: "Which way they head",
                        chips: HEADINGS,
                        getName: () => state.pattern.heading,
                        onSelect: (id) => {
                            state.pattern.heading = id;
                        },
                    },
                    secondarySlider: {
                        label: "Heading direction",
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
                        "Each boid knows only its neighbors. Every frame it sums three steering urges — keep your distance, match headings, and drift toward the group — and a flock emerges with no leader. These sliders weight the rules and shape how the flock moves.",
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
                        // Changing the crowd size reconciles the live flock
                        // (spawning newly needed boids) — boundary case 3.
                        onApply:
                            def.key === "count"
                                ? (v) => {
                                      state.params.count = v;
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

            // Crowd size is hard-capped by the boid buffers.
            if (state.params.count > MAX_BOIDS)
                state.params.count = MAX_BOIDS;

            const s = getSize();
            W = s.W;
            H = s.H;
            dpr = s.dpr;

            // Pointer interaction is boids-specific; wire it to the canvas.
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

            seedBoids();
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
                for (let i = 0; i < MAX_BOIDS; i++) {
                    px[i] *= sx;
                    py[i] *= sy;
                }
            }
            hardClear();
        },

        refreshPalette,

        // Quality scales the count budget, so a level change reconciles the
        // live flock to the new target.
        onQualityChange() {
            reconcileCount();
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
            // Match the live flock to the new base count (Quality scalar applies).
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
