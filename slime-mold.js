            (() => {
                // ============================================================
                // STATE
                // ============================================================
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
                        simSpeed: 1,
                        showRecord: false,
                        showShareLink: false,
                        showHideUI: false,
                    },
                };
                const defaultState = JSON.parse(JSON.stringify(state));

                // ============================================================
                // STATIC DATA
                // ============================================================
                const slidersDef = [
                    {
                        key: "count",
                        group: "The swarm",
                        label: "Crowd size",
                        hint: "How many critters roam the screen.",
                        min: 200,
                        max: 40000,
                        step: 100,
                        fmt: (v) => v.toFixed(0),
                    },
                    {
                        key: "sensorAngle",
                        group: "How they explore",
                        label: "Look width",
                        hint: "How wide a critter checks for trails ahead.",
                        min: 0,
                        max: 90,
                        step: 0.5,
                        fmt: (v) => v.toFixed(1) + "°",
                    },
                    {
                        key: "sensorDist",
                        group: "How they explore",
                        label: "Look ahead",
                        hint: "How far ahead a critter looks for trails.",
                        min: 1,
                        max: 30,
                        step: 0.5,
                        fmt: (v) => v.toFixed(1),
                    },
                    {
                        key: "turnAngle",
                        group: "How they explore",
                        label: "Turn sharpness",
                        hint: "How hard a critter steers toward a trail it spots.",
                        min: 0,
                        max: 90,
                        step: 0.5,
                        fmt: (v) => v.toFixed(1) + "°",
                    },
                    {
                        key: "speed",
                        group: "The swarm",
                        label: "Speed",
                        hint: "How fast each critter moves.",
                        min: 0.3,
                        max: 3.0,
                        step: 0.05,
                        fmt: (v) => v.toFixed(2),
                    },
                    {
                        key: "deposit",
                        group: "Trails",
                        label: "Trail strength",
                        hint: "How bold a trail each critter leaves behind.",
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

                // One ordered registry per enumeration. Each entry is a
                // descriptor: { id, label, ...metadata }. `id` is the single
                // stable key the sim branches on and that state serializes;
                // `label` is the only field copy edits touch; option-specific
                // metadata (cluster flag, particle target, palette stops) rides
                // on the same object. registry.byId() resolves an id to its
                // descriptor, falling back to the default if an unknown id ever
                // turns up. The UI renders from .label, the sim branches on .id.
                function registry(items, defaultId) {
                    return {
                        items,
                        byId: (id) =>
                            items.find((d) => d.id === id) ||
                            items.find((d) => d.id === defaultId),
                    };
                }
                const randItem = (arr) =>
                    arr[Math.floor(Math.random() * arr.length)];

                const PALETTES = registry(
                    [
                        {
                            id: "Acid",
                            label: "Acid",
                            stops: [
                                "#000000",
                                "#082a14",
                                "#1a8a3c",
                                "#7af066",
                                "#f5ffa8",
                            ],
                        },
                        {
                            id: "Coral",
                            label: "Coral",
                            stops: [
                                "#0a0612",
                                "#2b0a26",
                                "#a83a5c",
                                "#ff7da3",
                                "#ffe3ea",
                            ],
                        },
                        {
                            id: "Ember",
                            label: "Ember",
                            stops: [
                                "#000000",
                                "#2c0500",
                                "#a02000",
                                "#ff7a2e",
                                "#ffde8a",
                            ],
                        },
                        {
                            id: "Frost",
                            label: "Frost",
                            stops: [
                                "#000814",
                                "#0a2e58",
                                "#3a86d0",
                                "#9ed4ff",
                                "#f0faff",
                            ],
                        },
                        {
                            id: "Toxic",
                            label: "Toxic",
                            stops: [
                                "#040010",
                                "#1a0828",
                                "#6a0aa8",
                                "#c850f5",
                                "#f8d4ff",
                            ],
                        },
                        {
                            id: "Inferno",
                            label: "Inferno",
                            stops: [
                                "#000000",
                                "#1a0000",
                                "#a00010",
                                "#ff4020",
                                "#ffec70",
                            ],
                        },
                        {
                            id: "Cyber",
                            label: "Cyber",
                            stops: [
                                "#000810",
                                "#0a2030",
                                "#0a8a98",
                                "#5af0d8",
                                "#fff088",
                            ],
                        },
                        {
                            id: "Verdant",
                            label: "Verdant",
                            stops: [
                                "#020808",
                                "#0a2818",
                                "#187058",
                                "#54d8b8",
                                "#dcfff0",
                            ],
                        },
                        {
                            id: "Twilight",
                            label: "Twilight",
                            stops: [
                                "#040208",
                                "#280a40",
                                "#8a2080",
                                "#ff60c0",
                                "#ffe098",
                            ],
                        },
                        {
                            id: "Iris",
                            label: "Iris",
                            stops: [
                                "#000018",
                                "#0c1448",
                                "#4a3ac0",
                                "#c060e0",
                                "#ffd0e0",
                            ],
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

                const QUALITIES = registry(
                    [
                        { id: "low", label: "Low", target: 60000 },
                        { id: "med", label: "Medium", target: 130000 },
                        { id: "high", label: "High", target: 220000 },
                        { id: "veryHigh", label: "Very high", target: 400000 },
                        { id: "ultra", label: "Ultra", target: 800000 },
                    ],
                    "high",
                );
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

                // ============================================================
                // CANVAS & FIELD
                // ============================================================
                const canvas = document.getElementById("canvas");
                const ctx = canvas.getContext("2d");

                let W = 0,
                    H = 0;
                let field, nextField, imageData, pixels;

                // Particles
                const px = new Float32Array(MAX_PARTICLES);
                const py = new Float32Array(MAX_PARTICLES);
                const pa = new Float32Array(MAX_PARTICLES);

                let paletteLUT;
                let playing = true;

                function computeGridSize() {
                    const vw = window.innerWidth;
                    const vh = window.innerHeight;
                    const aspect = vw / vh;
                    const target = QUALITIES.byId(state.settings.quality).target;
                    const Hg = Math.max(
                        60,
                        Math.round(Math.sqrt(target / aspect)),
                    );
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

                    canvas.width = W;
                    canvas.height = H;
                    imageData = ctx.createImageData(W, H);
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

                function hexToRgb(h) {
                    return [
                        parseInt(h.slice(1, 3), 16),
                        parseInt(h.slice(3, 5), 16),
                        parseInt(h.slice(5, 7), 16),
                    ];
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

                // HSL -> hex
                function hslHex(h, s, l) {
                    h = ((h % 360) + 360) % 360;
                    s = Math.max(0, Math.min(100, s)) / 100;
                    l = Math.max(0, Math.min(100, l)) / 100;
                    const k = (n) => (n + h / 30) % 12;
                    const a = s * Math.min(l, 1 - l);
                    const f = (n) =>
                        l -
                        a *
                            Math.max(
                                -1,
                                Math.min(k(n) - 3, Math.min(9 - k(n), 1)),
                            );
                    const r = Math.round(f(0) * 255);
                    const g = Math.round(f(8) * 255);
                    const b = Math.round(f(4) * 255);
                    return (
                        "#" +
                        [r, g, b]
                            .map((x) => x.toString(16).padStart(2, "0"))
                            .join("")
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

                function generateCustomPalette(hue, accentHue, saturation) {
                    return [
                        hslHex(hue, saturation * 0.5, 2),
                        hslHex(hue, saturation * 0.75, 10),
                        hslHex(hue, saturation * 0.95, 36),
                        hslHex(hue, saturation * 0.9, 65),
                        hslHex(accentHue, saturation * 0.7, 86),
                    ];
                }

                function currentPaletteStops() {
                    if (state.palette.mode === "custom") {
                        const c = state.palette.custom;
                        return generateCustomPalette(
                            c.hue,
                            c.accentHue,
                            c.saturation,
                        );
                    }
                    return PALETTES.byId(state.palette.name).stops;
                }

                function refreshPalette() {
                    paletteLUT = buildPaletteLUT(currentPaletteStops());
                    updatePalettePreview();
                }

                // ============================================================
                // PARTICLE SEEDING
                // ============================================================
                function seedParticles() {
                    const n = state.params.count;
                    const cx = W / 2,
                        cy = H / 2;
                    const maxR =
                        Math.min(W, H) * 0.45 * state.pattern.regionSize;
                    const headingMode = state.pattern.heading;
                    const fixedAngle =
                        (state.pattern.fixedAngle * Math.PI) / 180;

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
                                const cols = Math.ceil(
                                    Math.sqrt((n * W) / Math.max(H, 1)),
                                );
                                const col = i % cols;
                                const row = Math.floor(i / cols);
                                x =
                                    ((col + 0.5) * W) / cols +
                                    (Math.random() - 0.5) * 4;
                                y =
                                    ((row + 0.5) * H) / Math.ceil(n / cols) +
                                    (Math.random() - 0.5) * 4;
                                break;
                            }
                            case "TwoBlobs":
                            case "FourBlobs": {
                                const blobCount = PATTERNS.byId(
                                    state.pattern.name,
                                ).blobCount;
                                const blobIdx = i % blobCount;
                                const blobAngle =
                                    (blobIdx / blobCount) * Math.PI * 2;
                                const bdist =
                                    Math.min(W, H) *
                                    0.28 *
                                    state.pattern.regionSize;
                                const bcx = cx + Math.cos(blobAngle) * bdist;
                                const bcy = cy + Math.sin(blobAngle) * bdist;
                                const r =
                                    Math.sqrt(Math.random()) *
                                    Math.min(W, H) *
                                    0.08;
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
                                a =
                                    angleFromCenter +
                                    Math.PI +
                                    (Math.random() - 0.5) * 0.3;
                                break;
                            case "Outward":
                                a =
                                    angleFromCenter +
                                    (Math.random() - 0.5) * 0.3;
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

                // ============================================================
                // SIMULATION
                // ============================================================
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
                            nextField[i] =
                                (field[i] * dc + sum * dn) * decayMul;
                        }
                    }
                    for (let x = 0; x < W; x++) {
                        nextField[x] = field[x] * decayMul;
                        nextField[(H - 1) * W + x] =
                            field[(H - 1) * W + x] * decayMul;
                    }
                    for (let y = 0; y < H; y++) {
                        nextField[y * W] = field[y * W] * decayMul;
                        nextField[y * W + W - 1] =
                            field[y * W + W - 1] * decayMul;
                    }

                    const tmp = field;
                    field = nextField;
                    nextField = tmp;
                }

                function render() {
                    const N = W * H;
                    for (let i = 0; i < N; i++) {
                        // Amplify the faint pheromone field ~4x to index the 256-entry palette LUT.
                        const v = field[i] * 4;
                        const idx = v >= 255 ? 255 : v < 0 ? 0 : v | 0;
                        const p = i * 4;
                        const q = idx * 4;
                        pixels[p] = paletteLUT[q];
                        pixels[p + 1] = paletteLUT[q + 1];
                        pixels[p + 2] = paletteLUT[q + 2];
                        pixels[p + 3] = 255;
                    }
                    ctx.putImageData(imageData, 0, 0);
                }

                // ============================================================
                // RESIZE
                // ============================================================
                let resizeTimer = null;
                function onResize() {
                    if (resizeTimer) clearTimeout(resizeTimer);
                    resizeTimer = setTimeout(() => {
                        const { W: nw, H: nh } = computeGridSize();
                        if (nw !== W || nh !== H) allocateField(nw, nh);
                    }, 150);
                }

                window.addEventListener("resize", onResize);
                window.addEventListener("orientationchange", onResize);

                // ============================================================
                // INTERACTION (mouse / touch)
                // ============================================================
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
                        const idx = Math.floor(
                            Math.random() * state.params.count,
                        );
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

                // ============================================================
                // MODALS
                // ============================================================
                let openModalId = null;
                const backdrop = document.getElementById("backdrop");

                function openModal(id) {
                    if (openModalId === id) return;
                    closeModal();
                    closeDropdown();
                    const modal = document.getElementById(id);
                    if (!modal) return;
                    openModalId = id;
                    modal.classList.add("open");
                    backdrop.classList.add("open");
                    document.querySelectorAll(".dropdown-item").forEach((f) => {
                        f.classList.toggle(
                            "active",
                            f.dataset.modal &&
                                "modal-" + f.dataset.modal === id,
                        );
                    });
                }

                function closeModal() {
                    if (!openModalId) return;
                    const m = document.getElementById(openModalId);
                    if (m) m.classList.remove("open");
                    backdrop.classList.remove("open");
                    document
                        .querySelectorAll(".dropdown-item")
                        .forEach((f) => f.classList.remove("active"));
                    openModalId = null;
                }

                backdrop.addEventListener("click", closeModal);
                document
                    .querySelectorAll("[data-close]")
                    .forEach((b) => b.addEventListener("click", closeModal));

                document.querySelectorAll("[data-modal]").forEach((f) => {
                    f.addEventListener("click", () => {
                        const id = "modal-" + f.dataset.modal;
                        if (openModalId === id) closeModal();
                        else openModal(id);
                    });
                });

                // ---------- Top-right cogwheel dropdown ----------
                const settingsMenu = document.getElementById("settings-menu");
                const settingsTrigger =
                    document.getElementById("settings-trigger");
                const menuDropdown = document.getElementById("menu-dropdown");
                let dropdownOpen = false;

                function openDropdown() {
                    if (dropdownOpen) return;
                    closeModal();
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
                // SLIDER HELPERS
                // ============================================================
                function makeSlider(container, def, getValue, setValue) {
                    const wrap = document.createElement("div");
                    wrap.className = "ctrl";
                    wrap.innerHTML = `
      <div class="ctrl-head">
        <span class="ctrl-name">${def.label}</span>
        <span class="ctrl-val"></span>
      </div>
      <input type="range" min="${def.min}" max="${def.max}" step="${def.step}">
    `;
                    container.appendChild(wrap);
                    const inp = wrap.querySelector("input");
                    const val = wrap.querySelector(".ctrl-val");

                    function sync() {
                        const v = getValue();
                        inp.value = v;
                        val.textContent = def.fmt(v);
                    }
                    inp.addEventListener("input", () => {
                        const v = parseFloat(inp.value);
                        setValue(v);
                        val.textContent = def.fmt(v);
                        persistState();
                    });
                    sync();
                    return { sync };
                }

                // ============================================================
                // PARAMETERS MODAL
                // ============================================================
                const paramsSection = document.getElementById("params-section");
                const paramSliders = {};
                // Lazily create one labelled section per group, in first-seen order.
                // Each section holds the sliders up top and a description footer below.
                const groupSections = {};
                function groupContainer(name) {
                    if (!groupSections[name]) {
                        const sec = document.createElement("div");
                        sec.className = "section";
                        const label = document.createElement("div");
                        label.className = "section-label";
                        label.textContent = name;
                        const sliders = document.createElement("div");
                        const desc = document.createElement("div");
                        desc.className = "section-desc";
                        sec.append(label, sliders, desc);
                        paramsSection.appendChild(sec);
                        groupSections[name] = { sliders, desc };
                    }
                    return groupSections[name];
                }
                const lcFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
                slidersDef.forEach((def) => {
                    const g = groupContainer(def.group);
                    paramSliders[def.key] = makeSlider(
                        g.sliders,
                        def,
                        () => state.params[def.key],
                        (v) => {
                            if (def.key === "count" && v > state.params.count) {
                                for (let i = state.params.count; i < v; i++) {
                                    px[i] = Math.random() * W;
                                    py[i] = Math.random() * H;
                                    pa[i] = Math.random() * Math.PI * 2;
                                }
                            }
                            state.params[def.key] = v;
                        },
                    );
                    // Mirror each slider with a bottom-of-section description whose
                    // bold key term is the slider's name.
                    const p = document.createElement("p");
                    p.innerHTML = `<strong>${def.label}</strong> — ${lcFirst(def.hint)}`;
                    g.desc.appendChild(p);
                });

                function applyParamsToSliders() {
                    slidersDef.forEach((def) => paramSliders[def.key].sync());
                }

                const fabPause = document.getElementById("fab-pause");
                const iconPause = fabPause.querySelector(".icon-pause");
                const iconPlay = fabPause.querySelector(".icon-play");

                function updatePauseButton() {
                    iconPause.style.display = playing ? "" : "none";
                    iconPlay.style.display = playing ? "none" : "";
                    fabPause.title = playing ? "Pause" : "Play";
                    fabPause.setAttribute(
                        "aria-label",
                        playing ? "Pause" : "Play",
                    );
                }
                fabPause.addEventListener("click", () => {
                    playing = !playing;
                    updatePauseButton();
                });
                document
                    .getElementById("fab-reset")
                    .addEventListener("click", resetAll);

                // Speed FAB — cycles through multipliers
                const SPEED_STEPS = [1, 2, 4, 8];
                const fabSpeed = document.getElementById("fab-speed");
                const speedLabel = document.getElementById("speed-label");
                function updateSpeedLabel() {
                    speedLabel.textContent = state.settings.simSpeed + "×";
                }
                fabSpeed.addEventListener("click", () => {
                    const curIdx = SPEED_STEPS.indexOf(state.settings.simSpeed);
                    const nextIdx = (curIdx + 1) % SPEED_STEPS.length;
                    state.settings.simSpeed = SPEED_STEPS[nextIdx];
                    updateSpeedLabel();
                    persistState();
                });

                // ============================================================
                // COLOR MODAL
                // ============================================================
                const colorRow = document.getElementById("color-row");
                PALETTES.items.forEach((pal) => {
                    const btn = document.createElement("button");
                    btn.className = "chip";
                    const swatch = document.createElement("span");
                    swatch.className = "swatch";
                    const p = pal.stops;
                    swatch.style.background = `linear-gradient(90deg, ${p[1]}, ${p[3]})`;
                    btn.appendChild(swatch);
                    btn.appendChild(document.createTextNode(pal.label));
                    btn.dataset.palette = pal.id;
                    btn.addEventListener("click", () => {
                        state.palette.mode = "preset";
                        state.palette.name = pal.id;
                        // Seed the custom sliders from the preset (mid stop = base,
                        // brightest stop = accent) so they reflect the selection.
                        const mid = hexToHsl(p[2]);
                        const accent = hexToHsl(p[4]);
                        state.palette.custom.hue = Math.round(mid.h);
                        state.palette.custom.accentHue = Math.round(accent.h);
                        state.palette.custom.saturation = Math.round(
                            Math.min(100, mid.s),
                        );
                        refreshPalette();
                        // Sync slider positions/labels, the active chip, and the preview.
                        syncColorControls();
                        persistState();
                    });
                    colorRow.appendChild(btn);
                });

                function markActiveColor() {
                    [...colorRow.children].forEach((btn) => {
                        btn.classList.toggle(
                            "active",
                            state.palette.mode === "preset" &&
                                btn.dataset.palette === state.palette.name,
                        );
                    });
                }

                const hueSlider = document.getElementById("s-hue");
                const accentSlider = document.getElementById("s-accent");
                const satSlider = document.getElementById("s-sat");
                const hueVal = document.getElementById("v-hue");
                const accentVal = document.getElementById("v-accent");
                const satVal = document.getElementById("v-sat");
                const palettePreview =
                    document.getElementById("palette-preview");

                function updatePalettePreview() {
                    // Skip the very dark base stop — it just looks like a black bar on the left.
                    const stops = currentPaletteStops().slice(1);
                    // Set background-image (not the `background` shorthand) so background-repeat
                    // stays no-repeat; otherwise the tile wraps and the bright end bleeds a
                    // sliver onto the left edge.
                    palettePreview.style.backgroundImage = `linear-gradient(90deg, ${stops.join(", ")})`;
                }

                // Recolor the saturation track to ramp from gray to the current base hue.
                function updateSatSliderBg() {
                    const h = state.palette.custom.hue;
                    satSlider.style.backgroundImage = `linear-gradient(90deg, hsl(${h}, 0%, 55%), hsl(${h}, 85%, 55%))`;
                }

                function onCustomColorChange() {
                    state.palette.mode = "custom";
                    state.palette.custom.hue = parseFloat(hueSlider.value);
                    state.palette.custom.accentHue = parseFloat(
                        accentSlider.value,
                    );
                    state.palette.custom.saturation = parseFloat(
                        satSlider.value,
                    );
                    hueVal.textContent = state.palette.custom.hue + "°";
                    accentVal.textContent =
                        state.palette.custom.accentHue + "°";
                    satVal.textContent = state.palette.custom.saturation + "%";
                    updateSatSliderBg();
                    refreshPalette();
                    markActiveColor();
                    persistState();
                }

                hueSlider.addEventListener("input", onCustomColorChange);
                accentSlider.addEventListener("input", onCustomColorChange);
                satSlider.addEventListener("input", onCustomColorChange);

                function syncColorControls() {
                    hueSlider.value = state.palette.custom.hue;
                    accentSlider.value = state.palette.custom.accentHue;
                    satSlider.value = state.palette.custom.saturation;
                    hueVal.textContent = state.palette.custom.hue + "°";
                    accentVal.textContent =
                        state.palette.custom.accentHue + "°";
                    satVal.textContent = state.palette.custom.saturation + "%";
                    updateSatSliderBg();
                    markActiveColor();
                    updatePalettePreview();
                }

                // ============================================================
                // PATTERN MODAL
                // ============================================================
                const patternRow = document.getElementById("pattern-row");
                const regionSection =
                    document.getElementById("region-section");
                function updateRegionVisibility() {
                    // Only clustered shapes use the cluster-size slider.
                    regionSection.style.display = PATTERNS.byId(
                        state.pattern.name,
                    ).clustered
                        ? ""
                        : "none";
                }
                PATTERNS.items.forEach((pat) => {
                    const btn = document.createElement("button");
                    btn.className = "chip";
                    btn.textContent = pat.label;
                    btn.dataset.pattern = pat.id;
                    btn.addEventListener("click", () => {
                        state.pattern.name = pat.id;
                        markActivePattern();
                        resetAll();
                        persistState();
                    });
                    patternRow.appendChild(btn);
                });
                function markActivePattern() {
                    [...patternRow.children].forEach((btn) => {
                        btn.classList.toggle(
                            "active",
                            btn.dataset.pattern === state.pattern.name,
                        );
                    });
                    updateRegionVisibility();
                }

                const headingRow = document.getElementById("heading-row");
                const headingAngleSection = document.getElementById(
                    "heading-angle-section",
                );
                HEADINGS.items.forEach((head) => {
                    const btn = document.createElement("button");
                    btn.className = "chip";
                    btn.textContent = head.label;
                    btn.dataset.heading = head.id;
                    btn.addEventListener("click", () => {
                        state.pattern.heading = head.id;
                        markActiveHeading();
                        resetAll();
                        persistState();
                    });
                    headingRow.appendChild(btn);
                });
                function markActiveHeading() {
                    [...headingRow.children].forEach((btn) => {
                        btn.classList.toggle(
                            "active",
                            btn.dataset.heading === state.pattern.heading,
                        );
                    });
                    headingAngleSection.style.display = HEADINGS.byId(
                        state.pattern.heading,
                    ).usesAngle
                        ? ""
                        : "none";
                }

                const angleSlider = document.getElementById("s-angle");
                const angleVal = document.getElementById("v-angle");
                angleSlider.addEventListener("input", () => {
                    state.pattern.fixedAngle = parseFloat(angleSlider.value);
                    angleVal.textContent = state.pattern.fixedAngle + "°";
                    resetAll();
                    persistState();
                });

                const regionSlider = document.getElementById("s-region");
                const regionVal = document.getElementById("v-region");
                regionSlider.addEventListener("input", () => {
                    state.pattern.regionSize = parseFloat(regionSlider.value);
                    regionVal.textContent = state.pattern.regionSize.toFixed(2);
                    resetAll();
                    persistState();
                });

                function syncPatternControls() {
                    markActivePattern();
                    markActiveHeading();
                    angleSlider.value = state.pattern.fixedAngle;
                    angleVal.textContent = state.pattern.fixedAngle + "°";
                    regionSlider.value = state.pattern.regionSize;
                    regionVal.textContent = state.pattern.regionSize.toFixed(2);
                }

                // ============================================================
                // SETTINGS MODAL
                // ============================================================
                const settingsToggles = [
                    ["t-reset-on-rand", "resetOnRandomize"],
                    ["t-rand-color", "randomizeColor"],
                    ["t-rand-pattern", "randomizePattern"],
                    ["t-show-record", "showRecord"],
                    ["t-show-share", "showShareLink"],
                    ["t-show-hideui", "showHideUI"],
                ];

                settingsToggles.forEach(([id, key]) => {
                    const el = document.getElementById(id);
                    el.addEventListener("change", () => {
                        state.settings[key] = el.checked;
                        updateToolbarVisibility();
                        persistState();
                    });
                });

                function updateToolbarVisibility() {
                    document
                        .getElementById("fab-record")
                        .classList.toggle("hidden", !state.settings.showRecord);
                    document
                        .getElementById("fab-share")
                        .classList.toggle(
                            "hidden",
                            !state.settings.showShareLink,
                        );
                    document
                        .getElementById("fab-hide")
                        .classList.toggle("hidden", !state.settings.showHideUI);
                }

                function syncSettings() {
                    settingsToggles.forEach(([id, key]) => {
                        document.getElementById(id).checked =
                            !!state.settings[key];
                    });
                    [
                        ...document.querySelectorAll("#seg-quality button"),
                    ].forEach((b) => {
                        b.classList.toggle(
                            "active",
                            b.dataset.q === state.settings.quality,
                        );
                    });
                    updateToolbarVisibility();
                }

                const qualityRow = document.getElementById("seg-quality");
                QUALITIES.items.forEach((q) => {
                    const btn = document.createElement("button");
                    btn.textContent = q.label;
                    btn.dataset.q = q.id;
                    btn.addEventListener("click", () => {
                        state.settings.quality = q.id;
                        syncSettings();
                        const { W: nw, H: nh } = computeGridSize();
                        if (nw !== W || nh !== H) allocateField(nw, nh);
                        persistState();
                    });
                    qualityRow.appendChild(btn);
                });

                document
                    .getElementById("fab-share")
                    .addEventListener("click", () => {
                        const url = buildShareURL();
                        navigator.clipboard
                            .writeText(url)
                            .then(() => {
                                showToast();
                            })
                            .catch(() => {
                                window.prompt("Copy this link:", url);
                            });
                    });
                document
                    .getElementById("fab-hide")
                    .addEventListener("click", toggleUI);

                document
                    .getElementById("btn-restore-defaults")
                    .addEventListener("click", () => {
                        // Restore the in-memory state to the built-in defaults (no page reload).
                        const fresh = JSON.parse(JSON.stringify(defaultState));
                        state.params = fresh.params;
                        state.pattern = fresh.pattern;
                        state.palette = fresh.palette;
                        state.settings = fresh.settings;

                        // Drop any persisted / shared-link overrides so the defaults stick.
                        try {
                            localStorage.removeItem(LS_KEY);
                        } catch (e) {}
                        if (location.hash)
                            history.replaceState(
                                null,
                                "",
                                location.pathname + location.search,
                            );

                        // Re-sync every control and reset the simulation to match.
                        applyParamsToSliders();
                        syncColorControls();
                        syncPatternControls();
                        syncSettings();
                        updateSpeedLabel();
                        refreshPalette();

                        const { W: nw, H: nh } = computeGridSize();
                        if (nw !== W || nh !== H) allocateField(nw, nh);
                        resetAll();

                        persistState();
                        showToast("Defaults restored");
                    });

                // ============================================================
                // RANDOMIZE
                // ============================================================
                const fabRandomize = document.getElementById("fab-randomize");
                fabRandomize.addEventListener("click", () => {
                    fabRandomize.classList.remove("spin");
                    void fabRandomize.offsetWidth;
                    fabRandomize.classList.add("spin");

                    slidersDef.forEach((def) => {
                        const [lo, hi] = randomRanges[def.key] || [
                            def.min,
                            def.max,
                        ];
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
                    applyParamsToSliders();

                    if (state.settings.randomizeColor) {
                        state.palette.mode = "preset";
                        state.palette.name = randItem(PALETTES.items).id;
                        refreshPalette();
                        markActiveColor();
                    }

                    if (state.settings.randomizePattern) {
                        state.pattern.name = randItem(PATTERNS.items).id;
                        state.pattern.heading = randItem(HEADINGS.items).id;
                        state.pattern.fixedAngle = Math.floor(
                            Math.random() * 360,
                        );
                        state.pattern.regionSize = 0.25 + Math.random() * 0.65;
                        syncPatternControls();
                        resetAll();
                    } else if (state.settings.resetOnRandomize) {
                        resetAll();
                    }

                    persistState();
                });

                // ============================================================
                // RECORDING
                // ============================================================
                const fabRecord = document.getElementById("fab-record");
                const recIndicator = document.getElementById("rec-indicator");
                const recTimeEl = document.getElementById("rec-time");
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
                        alert(
                            "MediaRecorder is not supported in this browser.",
                        );
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
                        if (e.data && e.data.size > 0)
                            recordChunks.push(e.data);
                    };
                    mediaRecorder.onstop = () => {
                        const blob = new Blob(recordChunks, {
                            type: "video/webm",
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `slime-${Date.now()}.webm`;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                    };
                    mediaRecorder.start();
                    recordStart = Date.now();
                    fabRecord.classList.add("recording");
                    recIndicator.classList.remove("hidden");
                    recTimer = setInterval(() => {
                        const sec = Math.floor(
                            (Date.now() - recordStart) / 1000,
                        );
                        const mm = Math.floor(sec / 60);
                        const ss = sec % 60;
                        recTimeEl.textContent =
                            mm + ":" + (ss < 10 ? "0" : "") + ss;
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

                // ============================================================
                // HIDE-UI MODE
                // ============================================================
                let uiHidden = false;
                let hideBannerTimer = null;
                function toggleUI() {
                    uiHidden = !uiHidden;
                    document.body.classList.toggle("ui-hidden", uiHidden);
                    if (uiHidden) {
                        const banner = document.getElementById("hide-banner");
                        banner.classList.remove("hidden");
                        if (hideBannerTimer) clearTimeout(hideBannerTimer);
                        hideBannerTimer = setTimeout(
                            () => banner.classList.add("hidden"),
                            2200,
                        );
                    } else {
                        document
                            .getElementById("hide-banner")
                            .classList.add("hidden");
                    }
                }

                document.addEventListener("keydown", (e) => {
                    if (
                        e.target.tagName === "INPUT" ||
                        e.target.tagName === "TEXTAREA"
                    )
                        return;
                    if (e.key === "Escape") {
                        closeModal();
                        closeDropdown();
                    } else if (e.key === "h" || e.key === "H") toggleUI();
                    else if (e.key === " ") {
                        e.preventDefault();
                        playing = !playing;
                        updatePauseButton();
                    }
                });

                // ============================================================
                // PERSISTENCE
                // ============================================================
                const LS_KEY = "slime-v2-state";
                let persistTimer = null;

                function deepMerge(target, src) {
                    if (!src || typeof src !== "object") return;
                    for (const k of Object.keys(src)) {
                        const sv = src[k];
                        if (
                            sv &&
                            typeof sv === "object" &&
                            !Array.isArray(sv)
                        ) {
                            if (!target[k] || typeof target[k] !== "object")
                                target[k] = {};
                            deepMerge(target[k], sv);
                        } else {
                            target[k] = sv;
                        }
                    }
                }

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

                // ============================================================
                // SHARE URL
                // ============================================================
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
                    const f = document.getElementById("toast");
                    f.textContent = msg || "Link copied";
                    f.classList.add("show");
                    setTimeout(() => f.classList.remove("show"), 1200);
                }

                // ============================================================
                // INIT
                // ============================================================
                loadPersistedState();
                loadFromHash();

                const { W: initW, H: initH } = computeGridSize();
                allocateField(initW, initH);
                refreshPalette();
                seedParticles();

                applyParamsToSliders();
                syncColorControls();
                syncPatternControls();
                syncSettings();
                updatePauseButton();
                updateSpeedLabel();

                // ============================================================
                // MAIN LOOP
                // ============================================================
                function loop() {
                    if (pointerDown) depositAtPointer();
                    if (playing) {
                        const iters = state.settings.simSpeed || 1;
                        for (let i = 0; i < iters; i++) simulate();
                    }
                    render();
                    requestAnimationFrame(loop);
                }
                requestAnimationFrame(loop);
            })();
