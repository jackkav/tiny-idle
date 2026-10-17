import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../game.js';
import * as N from '../num.js';
import {
  parseSettings, defaultSettings, isMutedByUrl, soundOn, encodeSave, decodeSave,
  hintInit, hintToSave, hintFromSave, advanceHints, currentHint, HINT_IDS, bgForFraction, floaterLook,
} from './ux-logic.js';

const f = (a, d) => N.fmt(a, d);

// ---------- notation ----------

test('scientific notation keeps tiny and huge exponents', () => {
  assert.equal(N.fmt(N.n(1e-101), 2, 'sci'), '1.00e-101');
  assert.equal(N.fmt(N.n(1.5e53), 2, 'sci'), '1.50e53');
});

test('scientific notation rounds 9.999 up to the next exponent', () => {
  assert.equal(N.fmt(N.n(9.999e-101), 2, 'sci'), '1.00e-100');
  assert.equal(N.fmt(N.n(9.999e20), 2, 'sci'), '1.00e21');
});

test('engineering notation uses exponents in steps of 3 with 3 digits', () => {
  assert.equal(N.fmt(N.n(1e-101), 2, 'eng'), '10.0e-102');
  assert.equal(N.fmt(N.n(1.5e53), 2, 'eng'), '150e51');
  assert.equal(N.fmt(N.n(1.234e9), 2, 'eng'), '1.23e9');
  for (const v of [N.n(7.77e-101), N.n(3.3e-99), N.n(4.2e44), N.n(9.9e12)]) {
    const e = Number(N.fmt(v, 2, 'eng').split('e')[1]);
    assert.equal(((e % 3) + 3) % 3, 0);
  }
});

test('engineering notation rounds up across a group boundary', () => {
  assert.equal(N.fmt(N.n(9.9999e-101), 2, 'eng'), '100e-102');
  assert.equal(N.fmt(N.n(9.9999e8), 2, 'eng'), '1.00e9');
  assert.equal(N.fmt(N.n(9.996e35), 2, 'eng'), '1.00e36');
});

test('words notation names large numbers and writes powers for the rest', () => {
  assert.equal(N.fmt(N.n(1.234e7), 2, 'words'), '12.3 million');
  assert.equal(N.fmt(N.n(9.9999e8), 2, 'words'), '1.00 billion');
  assert.equal(N.fmt(N.n(1e-101), 2, 'words'), '1.00 x 10^-101');
  assert.equal(N.fmt(N.n(9.999e-101), 2, 'words'), '1.00 x 10^-100');
  assert.equal(N.fmt(N.n(1.5e53), 2, 'words'), '1.50 x 10^53');
  assert.equal(N.fmt(N.n(9.9996e35), 2, 'words'), '1.00 x 10^36');
});

test('plain range is the same in every mode', () => {
  for (const m of N.NOTATIONS) {
    assert.equal(N.fmt(N.n(1234), 2, m), '1234');
    assert.equal(N.fmt(N.ZERO, 2, m), '0');
  }
});

test('setNotation changes the default mode and rejects junk', () => {
  try {
    assert.equal(N.setNotation('eng'), 'eng');
    assert.equal(f(N.n(1e-101), 2), '10.0e-102');
    assert.equal(N.setNotation('banana'), 'sci');
    assert.equal(f(N.n(1e-101), 2), '1.00e-101');
  } finally {
    N.setNotation('sci');
  }
});

// ---------- settings ----------

test('settings parse falls back to defaults for junk', () => {
  const d = defaultSettings(false);
  for (const raw of [null, undefined, '', '{', 'null', '[]', '42', '"x"', {}, [], 7]) {
    assert.deepEqual(parseSettings(raw, false), d);
  }
});

test('settings parse keeps valid fields and drops wrong ones', () => {
  const s = parseSettings(JSON.stringify({ notation: 'words', sound: 'yes', reducedMotion: true, hints: 0, extra: 1 }), false);
  assert.deepEqual(s, { notation: 'words', sound: false, reducedMotion: true, hints: true });
  assert.equal(parseSettings({ notation: 'nope' }).notation, 'sci');
});

test('reduced motion defaults to the system setting', () => {
  assert.equal(parseSettings(null, true).reducedMotion, true);
  assert.equal(parseSettings({ reducedMotion: false }, true).reducedMotion, false);
});

test('sound is off by default and the mute parameter always wins', () => {
  assert.equal(defaultSettings().sound, false);
  assert.equal(soundOn({ sound: true }, ''), true);
  assert.equal(soundOn({ sound: true }, '?mute=1'), false);
  assert.equal(soundOn({ sound: true }, '?a=1&mute=true'), false);
  assert.equal(soundOn({ sound: false }, ''), false);
  assert.equal(isMutedByUrl('?mute=0'), false);
  assert.equal(isMutedByUrl('?mute=10'), false);
});

// ---------- save strings ----------

test('export and import round trip keeps the save', () => {
  const s = G.newState(1000);
  for (let i = 0; i < 40; i++) G.tap(s);
  G.buyGen(s, 0);
  const text = encodeSave(G.toSave(s));
  const r = decodeSave(`  ${text.slice(0, 20)}\n${text.slice(20)}  `);
  assert.ok(r.ok);
  const back = G.fromSave(r.data, 1000);
  assert.deepEqual(G.toSave(back), G.toSave(s));
});

test('import rejects junk with a clear message', () => {
  const bad = [
    '', '   ', null, 'hello world!', '%%%', btoa('not json'), btoa('[1,2]'), btoa('null'),
    btoa('{"v":2,"dust":[1,0],"gens":[]}'), btoa('{"v":1}'), btoa('{"v":1,"dust":["a",1],"gens":[]}'),
    btoa('{"v":1,"dust":[1,0],"gens":5}'), 'a'.repeat(2_100_000),
  ];
  for (const text of bad) {
    const r = decodeSave(text);
    assert.equal(r.ok, false, String(text).slice(0, 30));
    assert.ok(typeof r.error === 'string' && r.error.length > 10);
  }
});

// ---------- hints ----------

const fresh = () => ({ s: G.newState(0), fs: hintInit() });
const hint = ({ s, fs }) => {
  advanceHints(fs, s);
  return currentHint(fs, s, f);
};

test('hints go in order and each one finishes for good', () => {
  const t = fresh();
  assert.equal(hint(t), 'Tap the speck.');
  for (let i = 0; i < 5; i++) G.tap(t.s);
  assert.match(hint(t), /^Keep tapping\. A collector costs/);
  while (!N.gte(t.s.dust, G.genCost(t.s, 0))) G.tap(t.s);
  assert.equal(hint(t), 'Buy a collector. It collects for you.');
  G.buyGen(t.s, 0);
  assert.match(hint(t), /^Keep going\. Your first method costs/);
  t.s.dust = N.n(1e-90);
  assert.match(hint(t), /^Buy a method/);
  G.buyUp(t.s, 'grip');
  t.s.dust = N.n(1e-90);
  assert.match(hint(t), /higher collector/);
  G.buyGen(t.s, 1);
  assert.match(hint(t), new RegExp(`^Own ${G.METHODS_TO_UNLOCK} different`));
  t.s.unlocked.condense = true;
  assert.match(hint(t), /^Gather /);
  t.s.run = N.n(1e-60);
  assert.match(hint(t), /^Condense now/);
  t.s.condenses = 1;
  assert.equal(hint(t), '');
  assert.deepEqual(Object.keys(t.fs.done).sort(), [...HINT_IDS].sort());
});

test('a finished hint does not return after the state resets', () => {
  const t = fresh();
  for (let i = 0; i < 5; i++) G.tap(t.s);
  t.s.dust = N.n(1e-90);
  G.buyGen(t.s, 0);
  hint(t);
  assert.equal(t.fs.done.collector, true);
  t.s.gens[0].bought = 0; // like a condense reset
  assert.doesNotMatch(hint(t), /collector costs|Buy a collector/);
});

test('a player who has condensed before sees no hints', () => {
  const t = fresh();
  t.s.condenses = 3;
  assert.equal(hint(t), '');
});

test('hint state survives save and ignores junk', () => {
  const fs = hintInit();
  fs.done.tap = true;
  assert.deepEqual(hintFromSave(hintToSave(fs)), fs);
  for (const junk of [null, 5, 'x', [], { done: 5 }, { done: { tap: 'yes', bogus: true } }]) {
    assert.deepEqual(hintFromSave(junk), hintInit());
  }
  assert.deepEqual(hintFromSave({ done: { tap: true, bogus: true, tier: 1 } }).done, { tap: true });
});

// ---------- theme color ----------

function rgbOf(hslText) {
  const [h, s, l] = hslText.match(/[\d.]+/g).map(Number);
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const k = (n) => (n + h / 30) % 12;
  return [0, 8, 4].map((n) => (l / 100) - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
}
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const hexLum = (hex) => lum([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

test('page color gets lighter with the fraction and keeps text readable', () => {
  let prev = -1;
  for (let i = 0; i <= 100; i++) {
    const t = bgForFraction(i / 100);
    const bgL = lum(rgbOf(t.bg));
    const light = Number(t.bg.match(/([\d.]+)%\)$/)[1]);
    assert.ok(light >= prev);
    prev = light;
    assert.ok(contrast(hexLum('#8a93a6'), lum(rgbOf(t.panel))) >= 4.5, `muted on panel at ${i}`);
    assert.ok(contrast(hexLum('#8a93a6'), bgL) >= 4.5, `muted on page at ${i}`);
    assert.ok(contrast(hexLum('#e8ecf4'), lum(rgbOf(t.panel))) >= 10, `text on panel at ${i}`);
  }
  assert.ok(lum(rgbOf(bgForFraction(1).bg)) > lum(rgbOf(bgForFraction(0).bg)));
});

test('page color accepts bad input', () => {
  assert.equal(bgForFraction(NaN).key, 0);
  assert.equal(bgForFraction(-3).key, 0);
  assert.equal(bgForFraction(9).key, 1);
});

// ---------- floaters ----------

test('floaters vary and every tenth tap is big', () => {
  let i = 0;
  const rand = () => [0.1, 0.9, 0.5, 0.3][i++ % 4];
  const a = floaterLook(rand, 3);
  const b = floaterLook(rand, 4);
  assert.notDeepEqual(a, b);
  assert.equal(a.big, false);
  assert.equal(floaterLook(() => 0.5, 10).big, true);
  assert.ok(floaterLook(() => 0.5, 10).size > floaterLook(() => 0.5, 11).size);
  assert.equal(floaterLook(() => 0.5, 0).big, false);
});
