// Proves the dev-mode flag + WIP visibility logic.
//
//   node test/dev-mode.test.mjs
//
// dev-mode.js is a plain browser <script> that attaches a `DevMode` global to
// globalThis. We give it a fake localStorage, eval the file, and exercise the
// helper. No DOM, no framework, no deps.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

// Minimal localStorage stand-in.
function makeStorage() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
    };
}

globalThis.localStorage = makeStorage();
const code = readFileSync(new URL("../dev-mode.js", import.meta.url), "utf8");
// Indirect eval runs the IIFE in global scope; it sets globalThis.DevMode.
(0, eval)(code);
const { DevMode } = globalThis;

let failures = 0;
function check(name, fn) {
    try {
        fn();
        console.log(`  ok   ${name}`);
    } catch (e) {
        failures++;
        console.log(`  FAIL ${name}\n       ${e.message}`);
    }
}

check("flag defaults to off", () => {
    assert.equal(DevMode.isOn(), false);
});

check("non-WIP sims are visible while flag is off", () => {
    assert.equal(DevMode.isVisible("boids"), true);
    assert.equal(DevMode.isVisible("slime"), true);
    assert.equal(DevMode.isVisible("slime-mold"), true);
    assert.equal(DevMode.isVisible("particle-life"), true);
});

check("WIP sims are hidden while flag is off (both id schemes)", () => {
    // index ids
    assert.equal(DevMode.isVisible("gravity"), false);
    assert.equal(DevMode.isVisible("flow"), false);
    assert.equal(DevMode.isVisible("rd"), false);
    // feed ids
    assert.equal(DevMode.isVisible("flow-field"), false);
    assert.equal(DevMode.isVisible("reaction-diffusion"), false);
});

check("set(true) turns the flag on and reveals WIP sims", () => {
    DevMode.set(true);
    assert.equal(DevMode.isOn(), true);
    assert.equal(DevMode.isVisible("flow"), true);
    assert.equal(DevMode.isVisible("reaction-diffusion"), true);
    assert.equal(DevMode.isVisible("gravity"), true);
});

check("set(false) turns the flag off again", () => {
    DevMode.set(false);
    assert.equal(DevMode.isOn(), false);
    assert.equal(DevMode.isVisible("gravity"), false);
});

check("wipList exposes both id schemes for every WIP sim", () => {
    const list = DevMode.wipList();
    assert.equal(list.length, 3);
    for (const entry of list) {
        assert.ok(entry.index, "entry has index id");
        assert.ok(entry.feed, "entry has feed id");
    }
});

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
