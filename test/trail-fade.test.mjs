// Proves the trail-fade root cause and the float-buffer fix, with no deps.
//
//   node test/trail-fade.test.mjs
//
// The sims fade trails by washing a translucent background over the canvas each
// frame. The canvas stores 8-bit channels, so every wash is
//
//     new = round(old * (1 - a) + bg * a)
//
// When a pixel gets within ~0.5/a levels of the background the per-frame step
// rounds to zero and the fade freezes a permanent ghost. Fading in floating
// point and rounding only at display time removes the stall.

import { strict as assert } from "node:assert";

const BG = 6; // a dark background level, like the palette's darkest stop
const START = 220; // a bright trail pixel

// The buggy path: repeated 8-bit washes toward the background.
function washTo8Bit(a, frames = 5000) {
    let c = START;
    for (let i = 0; i < frames; i++) {
        c = Math.round(c * (1 - a) + BG * a);
    }
    return c;
}

// The fix: accumulate the fade in float, round only when displayed.
function washFloat(a, frames = 5000) {
    let f = START;
    for (let i = 0; i < frames; i++) {
        f += (BG - f) * a;
    }
    return Math.round(f);
}

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

// flow-field's wash alpha is 0.5 - trail * 0.46; the longest trail (0.96) gives
// the smallest alpha and the worst ghost.
const minAlpha = 0.5 - 0.96 * 0.46; // ~0.0584

console.log("8-bit wash leaves a frozen ghost (the bug):");
check("flow-field's longest trail stalls several levels above bg", () => {
    const stuck = washTo8Bit(minAlpha);
    assert.ok(
        stuck > BG + 3,
        `expected a visible ghost > ${BG + 3}, got ${stuck}`,
    );
});

console.log("float wash reaches the background (the fix):");
for (const a of [minAlpha, 0.224, 0.32]) {
    check(`alpha ${a.toFixed(3)} fades all the way to bg`, () => {
        const settled = washFloat(a);
        assert.equal(settled, BG, `expected ${BG}, got ${settled}`);
    });
}

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
