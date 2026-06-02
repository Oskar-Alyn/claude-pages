/* ============================================================================
 * gravity.sim.js — the Gravity sim, driven through the SimShell contract.
 *
 * N-body gravity: thousands of point masses attract under a softened
 * inverse-square law and collapse into spinning galaxies. All chrome (modals,
 * toolbar, persistence, share, recording, the rAF loop) lives in sim-shell.js;
 * this file owns only the simulation + its palette/seed data.
 * ========================================================================== */

(() => {
    "use strict";

    const { registry, randItem, hexToRgb, hslHex, hexToHsl } = SimShell;

    // ------------------------------------------------------------------
    // STATE (JSON-serializable — the shell persists/serializes this verbatim)
    // ------------------------------------------------------------------
    const state = {
        params: {
            count: 700,
            gravity: 0.6,
            softening: 14,
            drag: 0.006,
            trail: 0.86,
        },
        pattern: {
            name: "Disc",
            regionSize: 0.55,
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
            fps: 60,
            simSpeed: 1,
            zoom: 1,
            countMult: 1,
            pointerForce: 0.004,
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
            group: "The cloud",
            label: "Mass count",
            hint: "Target for a reference-size screen; smaller screens scale down to keep the density.",
            min: 50,
            max: 1600,
            step: 10,
            fmt: (v) => v.toFixed(0),
        },
        {
            key: "gravity",
            group: "Forces",
            label: "Gravity",
            hint: "How strongly every mass pulls on every other.",
            min: 0.05,
            max: 2,
            step: 0.05,
            fmt: (v) => v.toFixed(2),
        },
        {
            key: "softening",
            group: "Forces",
            label: "Softening",
            hint: "A minimum distance that tames close passes, so masses swing by instead of flinging off to infinity.",
            min: 4,
            max: 40,
            step: 1,
            fmt: (v) => v.toFixed(0),
        },
        {
            key: "drag",
            group: "Forces",
            label: "Drag",
            hint: "A gentle brake that lets clusters settle into disks — zero keeps them perpetually restless.",
            min: 0,
            max: 0.05,
            step: 0.001,
            fmt: (v) => v.toFixed(3),
        },
        {
            key: "trail",
            group: "Trails",
            label: "Trail length",
            hint: "How long the streak behind each mass lingers before fading.",
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

    const MAX_PARTICLES = 1600;
    // Particle count is a *density* target defined for a reference-size screen;
    // the live count scales with the actual viewport area so phones run
    // proportionally fewer particles.
    const REF_AREA = 1440 * 900;
    const MIN_ACTIVE = 60;
    let activeCount = 0;

    const randomRanges = {
        count: [400, 1200],
        gravity: [0.3, 1.3],
        softening: [8, 26],
        drag: [0, 0.018],
        trail: [0.7, 0.95],
    };

    // ------------------------------------------------------------------
    // CANVAS / BUFFERS (filled in on init)
    // ------------------------------------------------------------------
    let canvas, ctx;
    let W = 0,
        H = 0,
        dpr = 1;
    let getSize = () => ({ W: 0, H: 0, dpr: 1 });

    const px = new Float32Array(MAX_PARTICLES);
    const py = new Float32Array(MAX_PARTICLES);
    const pvx = new Float32Array(MAX_PARTICLES);
    const pvy = new Float32Array(MAX_PARTICLES);

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
            // Seed a gentle orbital spin around the cloud's center so
            // collapsing clumps settle into rotating disks.
            const ddx = x - cx,
                ddy = y - cy;
            pvx[i] = -ddy * 0.004 + (Math.random() - 0.5) * 0.4;
            pvy[i] = ddx * 0.004 + (Math.random() - 0.5) * 0.4;
        }
    }

    // Spawn a single fresh mass (used when the cloud grows).
    function spawnParticle(i) {
        px[i] = Math.random() * W;
        py[i] = Math.random() * H;
        pvx[i] = (Math.random() - 0.5) * 0.6;
        pvy[i] = (Math.random() - 0.5) * 0.6;
    }

    // Live particle target: base density count, scaled by viewport area vs the
    // reference screen, times the settings multiplier — clamped to the buffer.
    function targetCount() {
        const areaScale = (W * H) / REF_AREA;
        const mult = state.settings.countMult || 1;
        let n = Math.round(state.params.count * areaScale * mult);
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
    // INTERACTION (pointer attracts the masses)
    // ------------------------------------------------------------------
    let pointerActive = false;
    let pointerX = 0,
        pointerY = 0;
    function pointerToCanvas(e) {
        const rect = canvas.getBoundingClientRect();
        const sx = ((e.clientX - rect.left) / rect.width) * W;
        const sy = ((e.clientY - rect.top) / rect.height) * H;
        const zoom = state.settings.zoom || 1;
        pointerX = W * 0.5 + (sx - W * 0.5) / zoom;
        pointerY = H * 0.5 + (sy - H * 0.5) / zoom;
    }

    // ------------------------------------------------------------------
    // SIMULATION
    // ------------------------------------------------------------------
    function simulate() {
        const n = activeCount;
        const G = state.params.gravity * 20;
        const soft2 = state.params.softening * state.params.softening;
        const velRetain = 1 - state.params.drag;
        const halfW = W * 0.5,
            halfH = H * 0.5;
        const cap = Math.min(W, H) * 0.25;
        const pull = pointerActive ? state.settings.pointerForce : 0;
        const pullR2 = 200 * 200;

        for (let i = 0; i < n; i++) {
            const x = px[i],
                y = py[i];
            let fx = 0,
                fy = 0;
            for (let j = i + 1; j < n; j++) {
                let dx = px[j] - x,
                    dy = py[j] - y;
                if (dx > halfW) dx -= W;
                else if (dx < -halfW) dx += W;
                if (dy > halfH) dy -= H;
                else if (dy < -halfH) dy += H;
                const d2 = dx * dx + dy * dy + soft2;
                const inv = G / (d2 * Math.sqrt(d2));
                const ax = dx * inv,
                    ay = dy * inv;
                fx += ax;
                fy += ay;
                pvx[j] -= ax;
                pvy[j] -= ay;
            }
            pvx[i] += fx;
            pvy[i] += fy;
        }

        for (let i = 0; i < n; i++) {
            let vxn = pvx[i] * velRetain;
            let vyn = pvy[i] * velRetain;
            if (pull > 0) {
                let ddx = pointerX - px[i],
                    ddy = pointerY - py[i];
                if (ddx > halfW) ddx -= W;
                else if (ddx < -halfW) ddx += W;
                if (ddy > halfH) ddy -= H;
                else if (ddy < -halfH) ddy += H;
                if (ddx * ddx + ddy * ddy < pullR2) {
                    vxn += ddx * pull;
                    vyn += ddy * pull;
                }
            }
            const sp = Math.hypot(vxn, vyn);
            if (sp > cap) {
                vxn = (vxn / sp) * cap;
                vyn = (vyn / sp) * cap;
            }
            pvx[i] = vxn;
            pvy[i] = vyn;
            let nx = px[i] + vxn,
                ny = py[i] + vyn;
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

    const DOT = 2.2;
    const DOT_HALF = DOT / 2;
    function render() {
        const n = activeCount;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const trailAlpha = 0.5 - state.params.trail * 0.46;
        ctx.fillStyle =
            "rgba(" + bgR + "," + bgG + "," + bgB + "," + trailAlpha + ")";
        ctx.fillRect(0, 0, W, H);
        const zoom = state.settings.zoom || 1;
        if (zoom !== 1) {
            const z = dpr * zoom;
            const tx = dpr * (W * 0.5) * (1 - zoom);
            const ty = dpr * (H * 0.5) * (1 - zoom);
            ctx.setTransform(z, 0, 0, z, tx, ty);
        }
        for (let i = 0; i < n; i++) {
            const sp = Math.hypot(pvx[i], pvy[i]);
            let t = sp / 5;
            if (t > 1) t = 1;
            let idx = ((0.3 + 0.7 * t) * 255) | 0;
            if (idx > 255) idx = 255;
            ctx.fillStyle = colorStr[idx];
            ctx.fillRect(px[i] - DOT_HALF, py[i] - DOT_HALF, DOT, DOT);
        }
    }

    // ------------------------------------------------------------------
    // REGISTER
    // ------------------------------------------------------------------
    SimShell.registerSim({
        id: "gravity",
        state,
        defaultState,
        // Preserve gravity's legacy storage keys so existing saved state loads.
        config: {
            keys: { ls: "plife-state", win: "plife-windows" },
            modals: {
                color: {
                    intro:
                        "Each mass is tinted by how fast it's moving — slow drifters stay dim, while anything whipping through a close pass burns bright. Tap a preset or mix your own.",
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
                        "Choose where the mass starts out. Each clump is set spinning and gravity takes it from there. Changes restart the simulation right away.",
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
                        "Every mass pulls on every other through softened gravity. Set enough of them loose and they collapse into clusters, then spinning disks and galaxies. These sliders tune the pull and how the trails linger.",
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
                        // Mass count adds/removes live bodies (boundary case 3).
                        onApply:
                            def.key === "count"
                                ? (v) => {
                                      state.params.count = Math.round(v);
                                      reconcileCount();
                                  }
                                : undefined,
                    })),
                },
                settings: {
                    sections: [
                        {
                            label: "Simulation",
                            controls: [
                                {
                                    type: "slider",
                                    label: "Particle multiplier",
                                    min: 0.25,
                                    max: 2,
                                    step: 0.05,
                                    fmt: (v) => v.toFixed(2) + "×",
                                    get: () => state.settings.countMult || 1,
                                    onApply: (v) => {
                                        state.settings.countMult = v || 1;
                                        reconcileCount();
                                    },
                                },
                                {
                                    type: "slider",
                                    label: "Zoom",
                                    min: 1,
                                    max: 5,
                                    step: 0.1,
                                    fmt: (v) => v.toFixed(1) + "×",
                                    get: () => state.settings.zoom || 1,
                                    set: (v) => {
                                        state.settings.zoom = v || 1;
                                    },
                                },
                                {
                                    type: "slider",
                                    label: "Click / touch pull",
                                    min: 0,
                                    max: 0.012,
                                    step: 0.0005,
                                    fmt: (v) => (v * 1000).toFixed(1),
                                    get: () =>
                                        state.settings.pointerForce == null
                                            ? 0.004
                                            : state.settings.pointerForce,
                                    set: (v) => {
                                        state.settings.pointerForce = v;
                                    },
                                },
                            ],
                            hint:
                                "The multiplier scales the Parameters particle count and survives randomizing. Zoom magnifies the view; click or touch the canvas to drag particles, with the pull strength set above (0 turns it off).",
                        },
                        {
                            label: "Performance",
                            controls: [
                                {
                                    type: "slider",
                                    label: "Max FPS",
                                    min: 15,
                                    max: 120,
                                    step: 5,
                                    fmt: (v) => String(v | 0),
                                    get: () => state.settings.fps || 60,
                                    onApply: (v) => {
                                        state.settings.fps =
                                            parseInt(v, 10) || 60;
                                    },
                                },
                            ],
                            hint:
                                "Lower values run smoother on slower devices and save battery. For huge clouds, drop the mass count in Parameters.",
                        },
                    ],
                },
            },
        },

        init(ctx2) {
            canvas = ctx2.canvas;
            ctx = canvas.getContext("2d");
            getSize = ctx2.getCanvasSize;

            // Gravity-specific clamp after restore.
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
            // Match the live pool to the new base count (multiplier carries over).
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
