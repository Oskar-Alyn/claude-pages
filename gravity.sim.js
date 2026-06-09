/* ============================================================================
 * gravity.sim.js — the Gravity sim, driven through the SimShell contract.
 *
 * An n-body gravity world: every speck pulls on every other through a softened
 * inverse-square attraction, and from that one force clumps condense, fall into
 * orbit, merge, and stream into spiral arms. The pull is long-range — each
 * speck feels the whole crowd — so this is the O(n^2) cousin of the other
 * particle sims: no neighbor grid, just a symmetric all-pairs loop (Newton's
 * third law halves the work). A short softening length keeps close encounters
 * from flinging anything to infinity, a touch of drag bleeds energy so structure
 * holds, and a speed cap keeps everything on the board. The world wraps, so a
 * speck that drifts off one edge re-enters the far side and the whole thing
 * loops forever.
 *
 * All chrome (modals, toolbar, persistence, share, recording, the rAF loop)
 * lives in sim-shell.js; this file owns only the simulation + its palette/seed
 * data. Position/velocity/acceleration live in module-local typed arrays, never
 * in state — state stays JSON-serializable.
 * ========================================================================== */

(() => {
    "use strict";

    const { registry, randItem, hexToRgb, hslHex, hexToHsl } = SimShell;

    const TAU = Math.PI * 2;

    // Converts the friendly "Pull strength" slider into the per-pair
    // gravitational constant the integrator uses (the acceleration one speck
    // feels from another is G / r^2). Tuned so a slider value near 1 makes a
    // scattered cloud condense into a web over a few seconds, with orbital and
    // infall speeds landing in the same single-digit range as the speed cap.
    const G_SCALE = 28;

    // Coast speed handed to a speck whose starting heading merely points it
    // somewhere (inward / outward / fixed / random); gravity reshapes it fast.
    // "Spinning" instead gets a true orbital speed (see seedParticles).
    const SEED_SPEED = 3.2;
    // Spinning discs are seeded a touch under their circular-orbit speed: the
    // inner crowd falls together into a bright bulge while the outer specks hold
    // long, layered orbits that the shear winds into spiral streaks.
    const ORBIT_FRACTION = 0.92;

    // ------------------------------------------------------------------
    // STATE (JSON-serializable — the shell persists/serializes this verbatim)
    // ------------------------------------------------------------------
    const state = {
        params: {
            count: 1100,
            gravity: 1.0,
            softness: 18,
            drag: 0,
            speed: 18,
            trail: 0.86,
        },
        pattern: {
            name: "Scatter",
            heading: "Still",
            fixedAngle: 0,
            regionSize: 1,
        },
        palette: {
            mode: "preset", // 'preset' | 'custom'
            name: "Iris",
            custom: { hue: 250, accentHue: 40, saturation: 85 },
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
    // Grouped so the Parameters panel reads top to bottom: the crowd itself,
    // the pull that draws it together, and the motion that keeps it lively.
    const slidersDef = [
        {
            key: "count",
            group: "The crowd",
            label: "Specks",
            hint: "How many specks fill the screen.",
            min: 100,
            max: 2000,
            step: 10,
            fmt: (v) => v.toFixed(0),
        },
        {
            key: "gravity",
            group: "Gravity",
            label: "Pull strength",
            hint: "How hard every speck pulls on every other.",
            min: 0.1,
            max: 3,
            step: 0.05,
            fmt: (v) => v.toFixed(2),
        },
        {
            key: "softness",
            group: "Gravity",
            label: "Core softness",
            hint: "How gentle a close pass is; lower makes flybys snappier, higher keeps clumps round.",
            min: 6,
            max: 60,
            step: 1,
            fmt: (v) => v.toFixed(0),
        },
        {
            key: "drag",
            group: "Motion",
            label: "Drag",
            hint: "How fast specks shed speed; a little lets clumps settle, zero keeps it restless.",
            min: 0,
            max: 0.03,
            step: 0.001,
            fmt: (v) => (v * 1000).toFixed(0),
        },
        {
            key: "speed",
            group: "Motion",
            label: "Top speed",
            hint: "The fastest a speck is allowed to travel; high enough lets clumps orbit instead of piling up.",
            min: 4,
            max: 32,
            step: 0.5,
            fmt: (v) => v.toFixed(1),
        },
        {
            key: "trail",
            group: "Motion",
            label: "Trail length",
            hint: "How long the glowing streaks linger before fading to black.",
            min: 0,
            max: 1,
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
        "Disc",
    );

    // How each speck is first set in motion. "Spinning" gives a disc its orbit
    // (spiral arms); "Still" lets a cloud free-fall and bounce back out.
    const HEADINGS = registry(
        [
            { id: "Spinning", label: "Spinning" },
            { id: "Still", label: "At rest" },
            { id: "Random", label: "Random" },
            { id: "Inward", label: "Toward center" },
            { id: "Outward", label: "Away from center" },
            { id: "Fixed", label: "Fixed", usesAngle: true },
        ],
        "Spinning",
    );

    const MAX_PARTICLES = 2000;
    const MIN_ACTIVE = 40;

    // Kept in the band that stays lively and frame-filling: too much gravity (or
    // too little softening) collapses the whole crowd into a single bright dot.
    const randomRanges = {
        count: [700, 1500],
        gravity: [0.5, 1.2],
        softness: [16, 40],
        // Drag bleeds energy, and without energy the crowd cools and collapses
        // to a cold point; randomize keeps it near zero so structure persists.
        drag: [0, 0.0015],
        speed: [13, 24],
        trail: [0.7, 0.94],
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

    // Position, velocity, and per-step acceleration in parallel typed arrays.
    const px = new Float32Array(MAX_PARTICLES);
    const py = new Float32Array(MAX_PARTICLES);
    const vx = new Float32Array(MAX_PARTICLES);
    const vy = new Float32Array(MAX_PARTICLES);
    const ax = new Float32Array(MAX_PARTICLES);
    const ay = new Float32Array(MAX_PARTICLES);

    // Peak velocity kick right under the pointer, fading to zero at the radius
    // edge — a tap shoves nearby specks outward and stirs the field.
    const POINTER_PUSH = 9;
    const POINTER_RADIUS = 170;
    const POINTER_R2 = POINTER_RADIUS * POINTER_RADIUS;

    // ------------------------------------------------------------------
    // COLOR / PALETTE
    // ------------------------------------------------------------------
    let paletteLUT;
    let bgR = 0,
        bgG = 0,
        bgB = 0;

    // Each speck is drawn as a soft radial-gradient sprite (additive), so even a
    // sparse field reads as luminous haze and dense cores bloom to white. We
    // can't tint a sprite per speck cheaply, so we prebuild one glow sprite per
    // speed bucket along the palette and pick by speed at draw time.
    const GLOW_BUCKETS = 16;
    const GLOW_SIZE = 22; // sprite px (drawn in world space, so it scales)
    const GLOW_HALF = GLOW_SIZE / 2;
    const glowSprites = [];
    const haveDoc = typeof document !== "undefined";

    function buildGlowSprites() {
        glowSprites.length = 0;
        for (let k = 0; k < GLOW_BUCKETS; k++) {
            // Sample the palette across the visible range (slow → bright-ish,
            // fast → hottest). The floor stays well up the ramp so even still
            // specks glow in color instead of sinking into the dark background.
            const t = GLOW_BUCKETS === 1 ? 0.8 : k / (GLOW_BUCKETS - 1);
            let idx = ((0.62 + 0.38 * t) * 255) | 0;
            if (idx > 255) idx = 255;
            const q = idx * 4;
            const r = paletteLUT[q],
                g = paletteLUT[q + 1],
                b = paletteLUT[q + 2];
            const cv = haveDoc ? document.createElement("canvas") : null;
            if (!cv) {
                glowSprites.push(null);
                continue;
            }
            cv.width = GLOW_SIZE;
            cv.height = GLOW_SIZE;
            const c = cv.getContext("2d");
            const grad = c.createRadialGradient(
                GLOW_HALF,
                GLOW_HALF,
                0,
                GLOW_HALF,
                GLOW_HALF,
                GLOW_HALF,
            );
            grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
            grad.addColorStop(0.35, `rgba(${r},${g},${b},0.55)`);
            grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
            c.fillStyle = grad;
            c.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
            glowSprites.push(cv);
        }
    }

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
        // Darkest stop is the canvas background the trails fade into.
        const bg = hexToRgb(stops[0]);
        bgR = bg[0];
        bgG = bg[1];
        bgB = bg[2];
        buildGlowSprites();
    }

    // ------------------------------------------------------------------
    // SEEDING
    // ------------------------------------------------------------------
    // The circular-orbit speed for a speck `r` from the center of a roughly
    // uniform cloud of `n` specks spanning radius `R`: enclosed mass grows like
    // (r/R)^2, so v(r) = sqrt(G * n * r / R^2). Seeded a hair under it so the
    // disc winds into arms; capped so it never seeds past the speed limit.
    function orbitalSpeed(r, n, maxR) {
        if (maxR <= 0) return 0;
        const g = state.params.gravity * G_SCALE;
        const v = ORBIT_FRACTION * Math.sqrt((g * n * r) / (maxR * maxR));
        return Math.min(v, state.params.speed);
    }

    function headingVel(x, y, cx, cy, mode, fixedAngle, orbitalSp, out) {
        if (mode === "Still") {
            out.x = 0;
            out.y = 0;
            return;
        }
        const fromCenter = Math.atan2(y - cy, x - cx);
        if (mode === "Spinning") {
            const a = fromCenter + Math.PI / 2;
            out.x = Math.cos(a) * orbitalSp;
            out.y = Math.sin(a) * orbitalSp;
            return;
        }
        let a;
        switch (mode) {
            case "Inward":
                a = fromCenter + Math.PI + (Math.random() - 0.5) * 0.3;
                break;
            case "Outward":
                a = fromCenter + (Math.random() - 0.5) * 0.3;
                break;
            case "Fixed":
                a = fixedAngle + (Math.random() - 0.5) * 0.3;
                break;
            case "Random":
            default:
                a = Math.random() * TAU;
        }
        out.x = Math.cos(a) * SEED_SPEED;
        out.y = Math.sin(a) * SEED_SPEED;
    }

    const _vel = { x: 0, y: 0 };

    function seedParticles() {
        const n = activeCount;
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
                    const theta = Math.random() * TAU;
                    x = cx + Math.cos(theta) * maxR;
                    y = cy + Math.sin(theta) * maxR;
                    break;
                }
                case "Disc": {
                    const r = Math.sqrt(Math.random()) * maxR;
                    const theta = Math.random() * TAU;
                    x = cx + Math.cos(theta) * r;
                    y = cy + Math.sin(theta) * r;
                    break;
                }
                case "Center": {
                    const j = maxR * 0.2;
                    x = cx + (Math.random() - 0.5) * j;
                    y = cy + (Math.random() - 0.5) * j;
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
                    const blobAngle = (blobIdx / blobCount) * TAU;
                    const bdist = Math.min(W, H) * 0.28 * state.pattern.regionSize;
                    const bcx = cx + Math.cos(blobAngle) * bdist;
                    const bcy = cy + Math.sin(blobAngle) * bdist;
                    const r = Math.sqrt(Math.random()) * Math.min(W, H) * 0.08;
                    const theta = Math.random() * TAU;
                    x = bcx + Math.cos(theta) * r;
                    y = bcy + Math.sin(theta) * r;
                    break;
                }
                default:
                    x = Math.random() * W;
                    y = Math.random() * H;
            }

            // Orbital seed speed depends on the radius from center; measure it
            // before the toroidal wrap can move a stray point across the seam.
            const r = Math.hypot(x - cx, y - cy);

            // Wrap into the world (positions are toroidal).
            x -= Math.floor(x / W) * W;
            y -= Math.floor(y / H) * H;

            const orbitalSp =
                headingMode === "Spinning" ? orbitalSpeed(r, n, maxR) : 0;
            headingVel(x, y, cx, cy, headingMode, fixedAngle, orbitalSp, _vel);
            px[i] = x;
            py[i] = y;
            vx[i] = _vel.x;
            vy[i] = _vel.y;
        }

        // Zero the total momentum so the crowd's center of mass stays put: any
        // net drift from the random sampling would otherwise carry the whole
        // structure (and the bright core it condenses into) off one edge.
        if (n > 0) {
            let mvx = 0,
                mvy = 0;
            for (let i = 0; i < n; i++) {
                mvx += vx[i];
                mvy += vy[i];
            }
            mvx /= n;
            mvy /= n;
            for (let i = 0; i < n; i++) {
                vx[i] -= mvx;
                vy[i] -= mvy;
            }
        }
    }

    // Spawn a single fresh speck (used when the crowd grows): drop it somewhere
    // random, nearly at rest, so it falls into the existing structure.
    function spawnParticle(i) {
        px[i] = Math.random() * W;
        py[i] = Math.random() * H;
        vx[i] = (Math.random() - 0.5) * 0.4;
        vy[i] = (Math.random() - 0.5) * 0.4;
    }

    // Live speck target: the base count times the Quality multiplier, clamped to
    // the buffer. Density across screens is handled by the shell's world scaling.
    function targetCount() {
        let n = Math.round(state.params.count * qualityScalar());
        if (n > MAX_PARTICLES) n = MAX_PARTICLES;
        if (n < MIN_ACTIVE) n = MIN_ACTIVE;
        return n;
    }

    // Bring activeCount in line with the target, spawning newly needed specks.
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
    // INTERACTION (pointer shoves nearby specks away)
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
    // One fixed step of softened, all-pairs gravity on a wrapping world. Newton's
    // third law makes the pull symmetric, so each pair is visited once and its
    // acceleration added to both bodies (with opposite sign). Minimum-image
    // distance means each pair interacts through its nearest wrapped copy.
    function simulate() {
        const n = activeCount;
        const g = state.params.gravity * G_SCALE;
        const soft2 = state.params.softness * state.params.softness;
        const retain = 1 - state.params.drag;
        const maxSpeed = state.params.speed;
        const maxSpeedSq = maxSpeed * maxSpeed;
        const halfW = W * 0.5,
            halfH = H * 0.5;

        ax.fill(0, 0, n);
        ay.fill(0, 0, n);

        for (let i = 0; i < n; i++) {
            const xi = px[i],
                yi = py[i];
            let axi = ax[i],
                ayi = ay[i];
            for (let j = i + 1; j < n; j++) {
                let dx = px[j] - xi;
                let dy = py[j] - yi;
                if (dx > halfW) dx -= W;
                else if (dx < -halfW) dx += W;
                if (dy > halfH) dy -= H;
                else if (dy < -halfH) dy += H;
                const d2 = dx * dx + dy * dy + soft2;
                // a = G / (r^2 + soft^2)^(3/2) along the separation.
                const inv = g / (d2 * Math.sqrt(d2));
                const fx = dx * inv;
                const fy = dy * inv;
                axi += fx;
                ayi += fy;
                ax[j] -= fx;
                ay[j] -= fy;
            }
            ax[i] = axi;
            ay[i] = ayi;
        }

        const push = pointerActive ? POINTER_PUSH : 0;
        for (let i = 0; i < n; i++) {
            let nvx = (vx[i] + ax[i]) * retain;
            let nvy = (vy[i] + ay[i]) * retain;

            // Pointer push while pressed: shove specks away from the pointer
            // (via the nearest wrapped copy), strongest right under it.
            if (push > 0) {
                let ddx = px[i] - pointerX;
                let ddy = py[i] - pointerY;
                if (ddx > halfW) ddx -= W;
                else if (ddx < -halfW) ddx += W;
                if (ddy > halfH) ddy -= H;
                else if (ddy < -halfH) ddy += H;
                const d2 = ddx * ddx + ddy * ddy;
                if (d2 > 0 && d2 < POINTER_R2) {
                    const d = Math.sqrt(d2);
                    const f = ((1 - d / POINTER_RADIUS) * push) / d;
                    nvx += ddx * f;
                    nvy += ddy * f;
                }
            }

            // Speed cap keeps a tight flyby from tunnelling across the world.
            const sp2 = nvx * nvx + nvy * nvy;
            if (sp2 > maxSpeedSq) {
                const s = maxSpeed / Math.sqrt(sp2);
                nvx *= s;
                nvy *= s;
            }
            vx[i] = nvx;
            vy[i] = nvy;
        }

        // Integrate positions in a second pass so every speck stepped off the
        // same snapshot. The world wraps toroidally.
        for (let i = 0; i < n; i++) {
            let nx = px[i] + vx[i];
            let ny = py[i] + vy[i];
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
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgb(" + bgR + "," + bgG + "," + bgB + ")";
        ctx.fillRect(0, 0, W, H);
    }

    const LAST = GLOW_BUCKETS - 1;
    function render() {
        const n = activeCount;
        const invMaxSpeed = 1 / (state.params.speed || 1);

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Wash the previous frame toward black for glowing trails.
        ctx.globalCompositeOperation = "source-over";
        const trailAlpha = 0.5 - state.params.trail * 0.46;
        ctx.fillStyle =
            "rgba(" + bgR + "," + bgG + "," + bgB + "," + trailAlpha + ")";
        ctx.fillRect(0, 0, W, H);

        // Additive blending so dense cores bloom into bright light: where many
        // glow sprites overlap, their light sums toward white. Each speck picks
        // a sprite by its speed (slow → dim/cool, fast → bright/hot).
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < n; i++) {
            const dx = vx[i],
                dy = vy[i];
            let t = Math.sqrt(dx * dx + dy * dy) * invMaxSpeed;
            if (t > 1) t = 1;
            let bucket = (t * LAST + 0.5) | 0;
            if (bucket > LAST) bucket = LAST;
            ctx.drawImage(glowSprites[bucket], px[i] - GLOW_HALF, py[i] - GLOW_HALF);
        }
        ctx.globalCompositeOperation = "source-over";
    }

    // ------------------------------------------------------------------
    // REGISTER
    // ------------------------------------------------------------------
    SimShell.registerSim({
        id: "gravity",
        state,
        defaultState,
        config: {
            modals: {
                color: {
                    intro:
                        "Each speck is tinted by how fast it's flying: slow drifters stay dim, specks whipping through a close pass burn bright. Dense cores glow where their light piles up. Tap a preset or mix your own.",
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
                        "Choose where the specks begin and how they're first set moving. A spinning disc winds into spiral arms; a cloud at rest free-falls and bounces back out. Changes restart the world right away.",
                    chipLabel: "Where they start",
                    chips: PATTERNS,
                    getName: () => state.pattern.name,
                    onSelect: (id) => {
                        state.pattern.name = id;
                    },
                    onRandomize: () => {
                        // Keep randomize lively. Gravity is shape-sensitive in a
                        // way the other sims are not: a clustered start drops all
                        // its mass onto one point and the frame goes dark, while
                        // a start spread across the whole frame fragments into a
                        // web of clumps and whirlpools. So randomize sticks to
                        // the spread patterns (the clustered ones stay available
                        // by hand in the Shape panel).
                        state.pattern.name = randItem([
                            "Scatter",
                            "Scatter",
                            "Grid",
                            "Edges",
                        ]);
                        // Spinning and Random both keep the crowd extended
                        // (rotation or dispersion stops it focusing to a point);
                        // a cold "At rest" start can be caught mid-collapse.
                        state.pattern.heading = randItem([
                            "Spinning",
                            "Random",
                            "Random",
                        ]);
                        state.pattern.fixedAngle = Math.floor(
                            Math.random() * 360,
                        );
                        state.pattern.regionSize = 0.8 + Math.random() * 0.2;
                    },
                    // Second control axis: how the specks first move.
                    secondaryChips: {
                        label: "How they start moving",
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
                        "Every speck pulls on every other through a softened inverse-square gravity. From that one rule, clumps condense, fall into orbit, and merge.",
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
                        // Changing the crowd size reconciles the live pool
                        // (spawning newly needed specks) — boundary case 3.
                        onApply:
                            def.key === "count"
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

            // Crowd size is hard-capped by the speck buffers.
            if (state.params.count > MAX_PARTICLES)
                state.params.count = MAX_PARTICLES;

            const s = getSize();
            W = s.W;
            H = s.H;
            dpr = s.dpr;

            // Pointer interaction is gravity-specific; wire it to the canvas.
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

        randomize() {
            slidersDef.forEach((def) => {
                const [lo, hi] = randomRanges[def.key] || [def.min, def.max];
                let v = lo + Math.random() * (hi - lo);
                v = Math.round(v / def.step) * def.step;
                if (v < def.min) v = def.min;
                if (v > def.max) v = def.max;
                state.params[def.key] = v;
            });
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
