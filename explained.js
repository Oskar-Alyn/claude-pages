/* ============================================================
   Shared helpers for the "How it works" explainer pages.

   Exposes window.EX with constants and small utilities the
   per-page inline scripts pull in via destructuring, e.g.:

     const { REDUCED, DPR, TAU, hexToRgb, buildColors } = window.EX;

   Each page keeps its own simulation engine; only the common
   scaffolding (reduced-motion flag, DPR clamp, colour helpers,
   lazy-start observer, debounced resize) lives here.
   ============================================================ */
(() => {
    const EX = {
        // Honour the user's reduced-motion preference.
        REDUCED: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        // Device pixel ratio, clamped so we never over-render on retina.
        DPR: Math.min(window.devicePixelRatio || 1, 2),
        TAU: Math.PI * 2,

        // "#rrggbb" -> [r, g, b].
        hexToRgb(h) {
            return [
                parseInt(h.slice(1, 3), 16),
                parseInt(h.slice(3, 5), 16),
                parseInt(h.slice(5, 7), 16),
            ];
        },

        // 256-entry palette of "rgb(...)" strings interpolated across stops.
        buildColors(stops) {
            const seg = stops.length - 1;
            const out = new Array(256);
            for (let i = 0; i < 256; i++) {
                const sf = (i / 255) * seg;
                const s = Math.min(sf | 0, seg - 1);
                const u = sf - s;
                const c0 = EX.hexToRgb(stops[s]);
                const c1 = EX.hexToRgb(stops[s + 1]);
                const r = (c0[0] + (c1[0] - c0[0]) * u) | 0;
                const g = (c0[1] + (c1[1] - c0[1]) * u) | 0;
                const b = (c0[2] + (c1[2] - c0[2]) * u) | 0;
                out[i] = "rgb(" + r + "," + g + "," + b + ")";
            }
            return out;
        },

        // Start each sim only while its canvas is on screen; stop otherwise.
        // pairs: [{ el, inst }] where inst has .start()/.stop().
        observeLazy(pairs, threshold = 0.15) {
            const io = new IntersectionObserver(
                (entries) => {
                    entries.forEach((e) => {
                        const inst = e.target.__inst;
                        if (!inst) return;
                        if (e.isIntersecting) inst.start();
                        else inst.stop();
                    });
                },
                { threshold },
            );
            pairs.forEach(({ el, inst }) => {
                el.__inst = inst;
                io.observe(el);
            });
            return io;
        },

        // Debounced window resize handler.
        onResize(fn, delay = 250) {
            let rt = null;
            window.addEventListener("resize", () => {
                if (rt) clearTimeout(rt);
                rt = setTimeout(fn, delay);
            });
        },
    };

    window.EX = EX;

    // ----- Section dots ---------------------------------------------
    // Right-edge wayfinding: one dot per <section>, current one lit, click
    // to jump. Injected here so every explainer page gets it for free.
    function initSecnav() {
        const sections = Array.from(
            document.querySelectorAll(".article > section"),
        );
        if (sections.length < 2) return;

        const nav = document.createElement("nav");
        nav.className = "secnav";
        nav.setAttribute("aria-label", "Sections");
        const dots = sections.map((sec) => {
            const a = document.createElement("a");
            a.href = "#" + sec.id;
            const label = (
                sec.querySelector("h2")?.textContent || sec.id
            ).trim();
            a.setAttribute("aria-label", label);
            a.dataset.label = label;
            a.addEventListener("click", (e) => {
                e.preventDefault();
                sec.scrollIntoView({
                    behavior: EX.REDUCED ? "auto" : "smooth",
                    block: "start",
                });
            });
            nav.appendChild(a);
            return a;
        });
        document.body.appendChild(nav);

        let active = -1;
        const update = () => {
            // Active = last section whose top has crossed the upper third.
            const mark = window.innerHeight * 0.35;
            let i = 0;
            for (let s = 0; s < sections.length; s++) {
                if (sections[s].getBoundingClientRect().top <= mark) i = s;
            }
            if (i !== active) {
                if (dots[active]) dots[active].removeAttribute("aria-current");
                dots[i].setAttribute("aria-current", "true");
                active = i;
            }
        };

        update();
        window.addEventListener("scroll", update, { passive: true });
        window.addEventListener("resize", update);
    }

    if (document.readyState !== "loading") initSecnav();
    else document.addEventListener("DOMContentLoaded", initSecnav);
})();
