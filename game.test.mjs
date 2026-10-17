import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as N from './num.js';
import * as G from './game.js';
import { describeScale, barFraction } from './scale.js';

const close = (a, b, rel = 1e-9) => assert.ok(Math.abs(N.log10(a) - N.log10(b)) < rel, `${N.fmt(a, 6)} vs ${N.fmt(b, 6)}`);

// ---- num -------------------------------------------------------------------

test('numbers far below double range keep their exponent', () => {
  const a = N.n(1e-101);
  assert.deepEqual(a, { m: 1, e: -101 });
  const sq = N.mul(a, a);
  assert.deepEqual(sq, { m: 1, e: -202 });
  close(N.add(sq, sq), { m: 2, e: -202 });
});

test('adding a number far smaller than the other changes nothing', () => {
  const big = N.n(1);
  assert.equal(N.add(big, { m: 1, e: -200 }), big);
  assert.equal(N.sub(big, { m: 1, e: -200 }), big);
});

test('sub clamps at zero', () => {
  assert.equal(N.sub(N.n(1), N.n(2)), N.ZERO);
  assert.equal(N.sub(N.n(5), N.n(5)), N.ZERO);
});

test('pow with a huge exponent does not overflow a double', () => {
  // 1.3^6537 is well past 1e308. A naive Math.pow gives Infinity here.
  const p = N.pow(N.n(1.3), 6537);
  assert.ok(Number.isFinite(p.m) && Number.isFinite(p.e));
  assert.ok(Math.abs(N.log10(p) - 6537 * Math.log10(1.3)) < 1e-6);
});

test('fmt rounds a mantissa of 9.999 up to the next exponent', () => {
  assert.equal(N.fmt({ m: 9.999, e: -101 }), '1.00e-100');
  assert.equal(N.fmt(N.n(1e-101)), '1.00e-101');
  assert.equal(N.fmt(N.ZERO), '0');
});

test('save format round-trips and rejects junk', () => {
  const a = N.make(3.7, -250);
  assert.deepEqual(N.fromJSON(N.toJSON(a)), a);
  assert.equal(N.fromJSON('nope'), N.ZERO);
  assert.equal(N.fromJSON([NaN, 1]), N.ZERO);
});

// ---- game ------------------------------------------------------------------

const rich = () => {
  const s = G.newState(0);
  s.dust = N.n(1e-40);
  return s;
};

test('one tap is 0.01e-99 kg', () => {
  const s = G.newState(0);
  G.tap(s);
  assert.equal(N.fmt(s.dust), '1.00e-101');
  assert.equal(s.taps, 1);
});

test('buying a collector spends its cost and counts it', () => {
  const s = G.newState(0);
  s.dust = N.n(1e-100); // 10 taps, exactly the first price
  assert.ok(G.buyGen(s, 0));
  assert.equal(s.gens[0].bought, 1);
  assert.equal(s.dust, N.ZERO);
  assert.equal(G.buyGen(s, 0), false, 'cannot afford the second one');
  assert.equal(s.gens[0].bought, 1);
});

test('collector price grows with each purchase', () => {
  const s = rich();
  const first = G.genCost(s, 0);
  G.buyGen(s, 0);
  assert.ok(N.cmp(G.genCost(s, 0), first) > 0);
});

test('every tenth purchase doubles output, capped after ten doublings', () => {
  const s = G.newState(0);
  const mult = () => Math.round(N.toNumber(G.genMult(s, 0)));
  s.gens[0].bought = 9;
  assert.equal(mult(), 1);
  s.gens[0].bought = 10;
  assert.equal(mult(), 2);
  s.gens[0].bought = 100;
  assert.equal(mult(), 1024);
  s.gens[0].bought = 100000; // must not overflow to Infinity
  assert.equal(mult(), 1024);
});

test('collectors feed the tier below, tier 1 feeds dust', () => {
  const s = G.newState(0);
  s.gens[1].owned = N.n(10);
  G.tick(s, 1);
  assert.equal(N.toNumber(s.gens[0].owned), 10, 'tier 2 made 10 of tier 1');
  assert.equal(s.dust, N.ZERO, 'tier 1 had none at the start of the step');
  G.tick(s, 1);
  assert.ok(N.cmp(s.dust, N.ZERO) > 0);
});

test('upgrade chain: a method needs its prerequisite', () => {
  const s = rich();
  assert.equal(G.buyUp(s, 'hummer'), false);
  assert.ok(G.buyUp(s, 'twitch'));
  assert.ok(G.buyUp(s, 'hummer'));
  assert.equal(G.autoTaps(s), 10);
});

test('grip is repeatable up to its cap and doubles tap power each level', () => {
  const s = rich();
  const base = G.tapValue(s);
  G.buyUp(s, 'grip');
  close(G.tapValue(s), N.scale(base, 2));
  s.ups.grip = 40;
  assert.equal(G.upAvailable(s, 'grip'), false);
});

test('condensation unlocks at 8 methods and stays unlocked after a reset', () => {
  const s = rich();
  s.dust = N.n(1);
  for (let k = 0; k < 6; k++) G.buyGen(s, k);
  assert.equal(s.unlocked.condense, false);
  G.buyUp(s, 'grip');
  G.tick(s, 0.01);
  assert.equal(s.unlocked.condense, false, '7 methods is not enough');
  G.buyUp(s, 'twitch');
  G.tick(s, 0.01);
  assert.equal(G.methodsOwned(s), 8);
  assert.equal(s.unlocked.condense, true);

  s.run = N.n(1e-60);
  assert.ok(G.condense(s));
  assert.equal(G.methodsOwned(s), 0);
  assert.equal(s.unlocked.condense, true);
});

test('condense pays one grain per order of magnitude above the threshold', () => {
  const s = G.newState(0);
  s.unlocked.condense = true;
  s.run = N.n(5e-71);
  assert.equal(G.condenseGain(s), N.ZERO, 'below the threshold');
  s.run = N.n(5e-70);
  assert.equal(G.canCondense(s), false, 'under one order above the threshold');
  s.run = N.n(1e-60);
  assert.equal(N.toNumber(G.condenseGain(s)), 10);
  assert.ok(G.canCondense(s));
});

test('condensing resets the run, keeps grains, and grains multiply output', () => {
  const s = G.newState(0);
  s.unlocked.condense = true;
  s.run = N.n(1e-60);
  s.dust = N.n(1e-60);
  s.gens[0] = { bought: 5, owned: N.n(5) };
  s.ups.grip = 2;
  const before = G.tapValue(s);
  assert.ok(G.condense(s));
  assert.equal(s.dust, N.ZERO);
  assert.equal(s.run, N.ZERO);
  assert.equal(s.gens[0].bought, 0);
  assert.deepEqual(s.ups, {});
  assert.equal(s.condenses, 1);
  assert.equal(N.toNumber(s.grains), 10);
  // 10 grains give x11, and the grip upgrade is gone.
  close(G.tapValue(s), N.scale(G.TAP, 11));
  assert.ok(N.cmp(G.tapValue(s), before) !== 0);
});

test('condense refuses when the gain is under one grain', () => {
  const s = G.newState(0);
  s.unlocked.condense = true;
  s.dust = N.n(1);
  assert.equal(G.condense(s), false);
  assert.equal(N.toNumber(s.dust), 1);
});

test('coarse offline steps never count more than fine steps', () => {
  const make = () => {
    const s = G.newState(0);
    s.gens[0] = { bought: 10, owned: N.n(10) };
    s.gens[1] = { bought: 5, owned: N.n(5) };
    s.gens[2] = { bought: 2, owned: N.n(2) };
    return s;
  };
  const fine = make();
  for (let i = 0; i < 6000; i++) G.tick(fine, 0.1);
  const coarse = make();
  G.advance(coarse, 600, 20); // 30 s per step
  assert.ok(N.cmp(coarse.dust, fine.dust) <= 0);
  // And still within a factor of ten, so offline time is not wasted.
  assert.ok(N.log10(fine.dust) - N.log10(coarse.dust) < 1);
});

test('save and load restore the full state', () => {
  const s = G.newState(123);
  s.dust = N.n(4.2e-77);
  s.run = N.n(9e-70);
  s.gens[2] = { bought: 7, owned: N.n(31) };
  s.ups = { grip: 3, twitch: 1 };
  s.grains = N.n(12);
  s.condenses = 2;
  s.taps = 99;
  s.unlocked.condense = true;
  const back = G.fromSave(JSON.parse(JSON.stringify(G.toSave(s))), 999);
  assert.deepEqual(G.toSave(back), G.toSave(s));
});

test('load ignores unknown versions and clamps tampered levels', () => {
  assert.deepEqual(G.toSave(G.fromSave({ v: 99 }, 5)), G.toSave(G.newState(5)));
  const s = G.fromSave({ v: 1, ups: { grip: 9999, nonsense: 3 }, gens: [{ bought: -5, owned: [1, 0] }] }, 5);
  assert.equal(s.ups.grip, 40);
  assert.equal(s.ups.nonsense, undefined);
  assert.equal(s.gens[0].bought, 0);
});

// ---- scale -----------------------------------------------------------------

test('scale text compares to the nearest landmark below', () => {
  assert.match(describeScale(N.n(1e-101)), /^7\d orders of magnitude lighter than an electron/);
  assert.match(describeScale(N.n(1e-3)), /paperclip/);
  assert.match(describeScale(N.n(6e24)), /Earth/);
  assert.equal(describeScale(N.ZERO), 'Nothing yet. Tap the speck.');
});

test('scale bar runs from 0 at the start speck to 1 at the universe', () => {
  assert.equal(barFraction(N.ZERO), 0);
  assert.ok(barFraction(N.n(1e-101)) < 0.001);
  assert.equal(barFraction(N.n(1e60)), 1);
  assert.ok(barFraction(N.n(1)) > barFraction(N.n(1e-50)));
});
