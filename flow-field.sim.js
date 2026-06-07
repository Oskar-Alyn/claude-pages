/* ============================================================================
 * flow-field.sim.js — the Flow Field sim, driven through the SimShell contract.
 *
 * Thousands of particles ride an invisible vector field woven from drifting
 * value noise, leaving silky fading trails and reborn from an emitter shape
 * when their lifespan runs out. All chrome (modals, toolbar, persistence,
 * share, recording, the rAF loop) lives in sim-shell.js; this file owns only
 * the simulation + its palette/seed data.
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
            count: 1500,
            speed: 1.5,
            noiseScale: 0.009,
            evolve: 0.01,
            inertia: 0.82,
            trail: 0.89,
            lifespan: 220,
        },
        pattern: {
            name: "Scatter",
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
            key: "count",
            group: "The flow",
            label: "Particle count",
            hint: "Target for a reference-size screen; smaller screens scale down to keep the density.",
            min: 100,
            max: 4000,
            step: 10,
            fmt: (v) => v.toFixed(0),
        },
        {
            key: "speed",
            group: "The flow",
            label: "Flow speed",
            hint: "How fast particles travel along the field.",
            min: 0.3,
            max: 5,
            step: 0.1,
            fmt: (v) => v.toFixed(1),
        },
        {
            key: "noiseScale",
            group: "The field",
            label: "Swirliness",
            hint: "How tightly the field curls — higher means more, smaller eddies.",
            min: 0.001,
            max: 0.02,
            step: 0.0005,
            fmt: (v) => (v * 1000).toFixed(1),
        },
        {
            key: "evolve",
            group: "The field",
            label: "Drift",
            hint: "How fast the field churns over time (0 freezes it).",
            min: 0,
            max: 0.05,
            step: 0.001,
            fmt: (v) => (v * 1000).toFixed(0),
        },
        {
            key: "inertia",
            group: "The field",
            label: "Smoothness",
            hint: "How lazily particles turn to follow the field — higher draws longer, smoother curves.",
            min: 0,
            max: 0.95,
            step: 0.05,
            fmt: (v) => v.toFixed(2),
        },
        {
            key: "trail",
            group: "Trails",
            label: "Trail length",
            hint: "How long the streaks linger before fading to the background.",
            min: 0,
            max: 1,
            step: 0.05,
            fmt: (v) => v.toFixed(2),
        },
        {
            key: "lifespan",
            group: "Trails",
            label: "Lifespan",
            hint: "How many steps a particle lives before it's reborn at the emitter.",
            min: 30,
            max: 600,
            step: 10,
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
            {
                id: "Rainbow",
                label: "Rainbow",
                stops: ["#0a0a0a", "#ff5050", "#ffe64d", "#4dd2ff", "#c060ff"],
            },
        ],
        "Cyber",
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

    const MAX_PARTICLES = 4000;
    // Particle count is a *density* target defined for a reference-size screen;
    // the live count scales with the actual viewport area so phones run
    // proportionally fewer particles.
    const REF_AREA = 1440 * 900;
    const MIN_ACTIVE = 60;
    let activeCount = 0;

    const randomRanges = {
        count: [800, 3000],
        speed: [0.8, 3],
        noiseScale: [0.002, 0.012],
        evolve: [0, 0.03],
        inertia: [0.5, 0.95],
        trail: [0.6, 0.96],
        lifespan: [80, 500],
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

    const px = new Float32Array(MAX_PARTICLES);
    const py = new Float32Array(MAX_PARTICLES);
    const vx = new Float32Array(MAX_PARTICLES);
    const vy = new Float32Array(MAX_PARTICLES);
    const page = new Float32Array(MAX_PARTICLES); // age in steps

    // ------------------------------------------------------------------
    // NOISE FIELD
    // ------------------------------------------------------------------
    // Cheap deterministic value noise: hash the integer lattice and smoothly
    // interpolate. The field is sampled at (x*scale + off), and the offset
    // slowly orbits over time so the whole field churns without drifting in
    // any one direction.
    function hash2(ix, iy) {
        let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967295;
    }
    function smooth(t) {
        return t * t * (3 - 2 * t);
    }
    function vnoise(x, y) {
        const x0 = Math.floor(x),
            y0 = Math.floor(y);
        const fx = smooth(x - x0),
            fy = smooth(y - y0);
        const v00 = hash2(x0, y0),
            v10 = hash2(x0 + 1, y0),
            v01 = hash2(x0, y0 + 1),
            v11 = hash2(x0 + 1, y0 + 1);
        const a = v00 + (v10 - v00) * fx;
        const b = v01 + (v11 - v01) * fx;
        return a + (b - a) * fy;
    }

    let fieldTime = 0;
    let fieldOffX = 1000,
        fieldOffY = 1000;
    function fieldAngleAt(x, y) {
        const ns = state.params.noiseScale;
        // Two turns across the noise range gives lively swirls.
        return vnoise(x * ns + fieldOffX, y * ns + fieldOffY) * TAU * 2;
    }

    // ------------------------------------------------------------------
    // COLOR / PALETTE
    // ------------------------------------------------------------------
    let paletteLUT;
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
        const bg = hexToRgb(stops[0]);
        bgR = bg[0];
        bgG = bg[1];
        bgB = bg[2];
    }

    // ------------------------------------------------------------------
    // EMITTER (starting shape)
    // ------------------------------------------------------------------
    // Returns a random point drawn from the current emitter shape. Used both
    // for the initial seed and for rebirth, so the shape behaves like a
    // continuous source.
    function spawnPos() {
        const cx = W / 2,
            cy = H / 2;
        const maxR = Math.min(W, H) * 0.45 * state.pattern.regionSize;
        switch (state.pattern.name) {
            case "Ring": {
                const th = Math.random() * TAU;
                return {
                    x: cx + Math.cos(th) * maxR,
                    y: cy + Math.sin(th) * maxR,
                };
            }
            case "Disc": {
                const r = Math.sqrt(Math.random()) * maxR;
                const th = Math.random() * TAU;
                return { x: cx + Math.cos(th) * r, y: cy + Math.sin(th) * r };
            }
            case "Center": {
                const j = maxR * 0.25;
                return {
                    x: cx + (Math.random() - 0.5) * j,
                    y: cy + (Math.random() - 0.5) * j,
                };
            }
            case "Edges": {
                const e = Math.floor(Math.random() * 4);
                if (e === 0) return { x: Math.random() * W, y: 2 };
                if (e === 1) return { x: W - 2, y: Math.random() * H };
                if (e === 2) return { x: Math.random() * W, y: H - 2 };
                return { x: 2, y: Math.random() * H };
            }
            case "Grid": {
                const cols = Math.max(
                    1,
                    Math.round(Math.sqrt((activeCount * W) / Math.max(H, 1))),
                );
                const rows = Math.max(1, Math.ceil(activeCount / cols));
                const col = Math.floor(Math.random() * cols);
                const row = Math.floor(Math.random() * rows);
                return {
                    x: ((col + 0.5) * W) / cols,
                    y: ((row + 0.5) * H) / rows,
                };
            }
            case "TwoBlobs":
            case "FourBlobs": {
                const bc = PATTERNS.byId(state.pattern.name).blobCount;
                const bi = Math.floor(Math.random() * bc);
                const ba = (bi / bc) * TAU;
                const bd = Math.min(W, H) * 0.28 * state.pattern.regionSize;
                const bcx = cx + Math.cos(ba) * bd;
                const bcy = cy + Math.sin(ba) * bd;
                const r = Math.sqrt(Math.random()) * Math.min(W, H) * 0.08;
                const th = Math.random() * TAU;
                return {
                    x: bcx + Math.cos(th) * r,
                    y: bcy + Math.sin(th) * r,
                };
            }
            case "Scatter":
            default:
                return { x: Math.random() * W, y: Math.random() * H };
        }
    }

    // Place one particle at the emitter, aimed along the field, with a
    // staggered age so the flock doesn't all expire on the same frame.
    function spawnParticle(i) {
        const p = spawnPos();
        px[i] = p.x;
        py[i] = p.y;
        const a = fieldAngleAt(p.x, p.y);
        const sp = state.params.speed;
        vx[i] = Math.cos(a) * sp;
        vy[i] = Math.sin(a) * sp;
        page[i] = Math.random() * state.params.lifespan;
    }

    function seedParticles() {
        for (let i = 0; i < activeCount; i++) spawnParticle(i);
    }

    // Live particle target: base density count, scaled by viewport area vs the
    // reference screen, times the settings multiplier — clamped to the buffer.
    function targetCount() {
        const areaScale = (W * H) / REF_AREA;
        let n = Math.round(state.params.count * areaScale * qualityScalar());
        if (n > MAX_PARTICLES) n = MAX_PARTICLES;
        if (n < MIN_ACTIVE) n = MIN_ACTIVE;
        return n;
    }

    // Bring activeCount in line with the target, spawning newly needed
    // particles. Shrinking just lowers the count.
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
    // INTERACTION (pointer pushes the flow away)
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
        const speed = state.params.speed;
        const ns = state.params.noiseScale;
        const resp = 1 - state.params.inertia;
        const life = state.params.lifespan;
        const push = pointerActive ? POINTER_PUSH : 0;
        const pushR = 200;
        const pushR2 = pushR * pushR;
        const halfW = W * 0.5,
            halfH = H * 0.5;

        // Churn the field by orbiting the sample offset.
        fieldTime += 1;
        const t = fieldTime * state.params.evolve;
        fieldOffX = 1000 + Math.cos(t) * 3;
        fieldOffY = 1000 + Math.sin(t) * 3;

        for (let i = 0; i < n; i++) {
            const x = px[i],
                y = py[i];
            const a = vnoise(x * ns + fieldOffX, y * ns + fieldOffY) * TAU * 2;
            let nvx = vx[i] + (Math.cos(a) * speed - vx[i]) * resp;
            let nvy = vy[i] + (Math.sin(a) * speed - vy[i]) * resp;

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

            vx[i] = nvx;
            vy[i] = nvy;

            let nx = x + nvx;
            let ny = y + nvy;
            nx -= Math.floor(nx / W) * W;
            ny -= Math.floor(ny / H) * H;
            px[i] = nx;
            py[i] = ny;

            page[i] += 1;
            if (page[i] >= life) spawnParticle(i);
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

    const DOT = 2.0;
    const DOT_HALF = DOT / 2;
    const INV_TAU = 1 / TAU;
    function render() {
        const n = activeCount;
        // Fade the previous frame toward the background for trails.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const trailAlpha = 0.5 - state.params.trail * 0.46;
        ctx.fillStyle =
            "rgba(" + bgR + "," + bgG + "," + bgB + "," + trailAlpha + ")";
        ctx.fillRect(0, 0, W, H);

        for (let i = 0; i < n; i++) {
            const ang = Math.atan2(vy[i], vx[i]); // -PI..PI
            let tt = (ang + Math.PI) * INV_TAU; // 0..1
            let idx = ((0.35 + 0.6 * tt) * 255) | 0;
            if (idx > 255) idx = 255;
            ctx.fillStyle = colorStr[idx];
            ctx.fillRect(px[i] - DOT_HALF, py[i] - DOT_HALF, DOT, DOT);
        }
    }

    // ------------------------------------------------------------------
    // REGISTER
    // ------------------------------------------------------------------
    SimShell.registerSim({
        id: "flow-field",
        state,
        defaultState,
        // Preserve flow-field's legacy storage keys so existing saved state loads.
        config: {
            keys: { ls: "flow-state", win: "flow-windows" },
            modals: {
                color: {
                    intro:
                        "Each particle is tinted by the direction it's flowing, so the palette paints the shape of the field itself. Tap a preset or mix your own.",
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
                        "Particles are born here and reborn here when their lifespan runs out, so the shape acts as a continuous emitter — a ring becomes a fountain, a grid a lattice of sources. Changes restart the field right away.",
                    chipLabel: "Where they spawn",
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
                        label: "Emitter size",
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
                        "An invisible vector field, woven from drifting noise, tells every particle which way to go. They follow it, leave fading trails, and are reborn from the emitter — these sliders shape the field and the streams it draws.",
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
                        // Particle count adds/removes live particles (boundary case 3).
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

            // Flow-field-specific clamp after restore.
            if (state.params.count > MAX_PARTICLES)
                state.params.count = MAX_PARTICLES;

            const s = getSize();
            W = s.W;
            H = s.H;
            dpr = s.dpr;

            // Pointer interaction is flow-field-specific; wire it to the canvas.
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
