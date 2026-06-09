/* ============================================================================
 * dev-mode.js — the shared dev-mode flag + work-in-progress sim gate
 * ============================================================================
 *
 * Some sims are work-in-progress and shouldn't be shown to a general audience
 * yet, but still need to be easy to test on mobile and to demo. A single,
 * off-by-default "dev mode" flag in localStorage controls that. When on, the
 * WIP sims appear in the main-page gallery and the explore feed; when off (the
 * default) they're hidden from both. Direct sim pages and explainer pages are
 * never gated.
 *
 * Build-free: this is a plain <script>, loaded by index.html, feed.html, and
 * dev.html. It exposes one global, `DevMode`, on globalThis (which is `window`
 * in the browser).
 *
 * The two catalogs that list sims can use different id schemes for the same sim
 * (index.html vs. feed.js). Any such mismatch lives ONLY here: each WIP entry
 * carries both ids, and isVisible() matches either, so each caller asks in its
 * own vocabulary.
 *
 * To graduate a sim out of WIP, delete its line from WIP below. Nothing else
 * needs editing — both surfaces pick it up.
 * ----------------------------------------------------------------------------
 */
(function (root) {
    "use strict";

    var LS_KEY = "claude-pages-dev-mode";

    var WIP = {
        gravity: { index: "gravity", feed: "gravity" },
    };

    function store() {
        try {
            return root.localStorage || null;
        } catch (e) {
            return null; // e.g. blocked storage
        }
    }

    function isOn() {
        var s = store();
        return !!s && s.getItem(LS_KEY) === "1";
    }

    function set(on) {
        var s = store();
        if (!s) return;
        if (on) s.setItem(LS_KEY, "1");
        else s.removeItem(LS_KEY);
    }

    function isWip(id) {
        for (var k in WIP) {
            if (WIP[k].index === id || WIP[k].feed === id) return true;
        }
        return false;
    }

    // Visible if it isn't a WIP sim, or if dev mode is on.
    function isVisible(id) {
        return !isWip(id) || isOn();
    }

    function wipList() {
        return Object.keys(WIP).map(function (k) {
            return WIP[k];
        });
    }

    root.DevMode = {
        LS_KEY: LS_KEY,
        isOn: isOn,
        set: set,
        isWip: isWip,
        isVisible: isVisible,
        wipList: wipList,
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
