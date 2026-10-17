import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../game.js';
import * as N from '../num.js';
import * as R from './rhythm.js';

const fresh = () => G.newState(0);
const fs = (s) => s.f.rhythm;
const seq = (...vals) => {
  let i = 0;
  return () => vals[Math.min(i++, vals.length - 1)];
};
const ratio = (a, b) => N.log10(a) - N.log10(b);
const near = (x, y, eps = 1e-6) => assert.ok(Math.abs(x - y) < eps, `${x} vs ${y}`);

function runUntilSpeck(f, rng, dt = 0.25, maxSteps = 4000) {
  let t = 0;
  for (let i = 0; i < maxSteps && !f.ev; i++) {
    R.stepRhythm(f, dt, rng);
    t += dt;
  }
  return t;
}

// ---- scheduler --------------------------------------------------------------

test('first speck comes inside the first-wait range, later ones inside the normal range', () => {
  const f = R.initState();
  const lo = runUntilSpeck(f, () => 0);
  assert.ok(lo >= R.EVENT_FIRST_WAIT_S[0] && lo < R.EVENT_FIRST_WAIT_S[0] + 0.5, `${lo}`);
  assert.equal(f.ev.ttl, R.EVENT_LIFE_S);
  f.ev = null;
  f.wait = null;
  const hi = runUntilSpeck(f, () => 0.999);
  assert.ok(hi >= R.EVENT_WAIT_S[1] - 2 && hi <= R.EVENT_WAIT_S[1] + 0.5, `${hi}`);
});

test('a speck that is not caught fades after its life and the next wait starts', () => {
  const f = R.initState();
  runUntilSpeck(f, () => 0);
  for (let i = 0; i < R.EVENT_LIFE_S / 0.25 - 1; i++) R.stepRhythm(f, 0.25, () => 0);
  assert.ok(f.ev, 'still there just before the end');
  R.stepRhythm(f, 0.25, () => 0);
  assert.equal(f.ev, null);
  assert.equal(f.missed, 1);
  assert.equal(f.wait, R.EVENT_WAIT_S[0]); // rolled with rng 0
});

test('no speck while the tab is hidden, during offline steps, or in a big step', () => {
  const f = R.initState();
  f.wait = 0.1;
  R.setHidden(f, true);
  for (let i = 0; i < 200; i++) R.stepRhythm(f, 0.25, () => 0);
  assert.equal(f.seq, 0);
  R.setHidden(f, false);
  f.catchingUp = true;
  for (let i = 0; i < 200; i++) R.stepRhythm(f, 0.25, () => 0);
  assert.equal(f.seq, 0);
  f.catchingUp = false;
  R.stepRhythm(f, R.LIVE_MAX_DT + 1, () => 0);
  assert.equal(f.seq, 0);
  R.stepRhythm(f, 0.25, () => 0);
  assert.equal(f.seq, 1);
});

test('hiding the tab removes the active speck', () => {
  const f = R.initState();
  runUntilSpeck(f, () => 0);
  R.setHidden(f, true);
  assert.equal(f.ev, null);
});

test('heat and effect timers still run while hidden or offline', () => {
  const f = R.initState();
  f.heat = 1;
  R.addEffect(f, 'frenzy', 20);
  R.setHidden(f, true);
  R.stepRhythm(f, 1, () => 0);
  assert.ok(f.heat < 1 && f.fx.frenzy < 20);
});

// ---- catching ---------------------------------------------------------------

test('effect pick follows the weights and covers every kind', () => {
  assert.equal(R.pickEffect(() => 0), 'burst');
  assert.equal(R.pickEffect(() => 0.44), 'burst');
  assert.equal(R.pickEffect(() => 0.46), 'frenzy');
  assert.equal(R.pickEffect(() => 0.76), 'tapfrenzy');
  assert.equal(R.pickEffect(() => 0.999), 'jackpot');
});

function withSpeck(s) {
  fs(s).ev = { id: 1, ttl: 5, life: 10, ang: 0, dist: 0 };
  return s;
}

test('catching with no speck does nothing', () => {
  const s = fresh();
  assert.equal(R.catchSpeck(s, () => 0), null);
  assert.equal(fs(s).caught, 0);
});

test('early burst pays the floor in taps', () => {
  const s = withSpeck(fresh());
  const r = R.catchSpeck(s, seq(0.5, 0)); // first draw sets the wait, second picks burst
  assert.equal(r.kind, 'burst');
  near(ratio(r.amount, G.tapValue(s)), Math.log10(R.BURST_FLOOR_TAPS), 1e-9);
  assert.equal(fs(s).ev, null);
  assert.equal(fs(s).caught, 1);
  assert.equal(s.notes.length, 1);
  assert.ok(N.cmp(s.dust, N.ZERO) > 0);
});

test('burst and jackpot scale with production over 20 orders of magnitude', () => {
  const small = fresh();
  small.gens[0] = { bought: 1, owned: N.n(1e3) };
  const big = fresh();
  big.gens[0] = { bought: 1, owned: N.n(1e23) };
  const a = R.payout(small, R.BURST_SECONDS, R.BURST_FLOOR_TAPS);
  const b = R.payout(big, R.BURST_SECONDS, R.BURST_FLOOR_TAPS);
  near(ratio(b, a), 20, 1e-6);
  near(ratio(a, G.dustPerSecond(small)), Math.log10(R.BURST_SECONDS), 1e-9);
  const jack = withSpeck(big);
  const r = R.catchSpeck(jack, seq(0.5, 0.999));
  assert.equal(r.kind, 'jackpot');
  near(ratio(r.amount, G.dustPerSecond(jack)), Math.log10(R.JACKPOT_SECONDS), 1e-9);
});

test('frenzy multiplies dust production, then expires', () => {
  const s = fresh();
  s.gens[0] = { bought: 1, owned: N.n(1e6) };
  const base = G.dustPerSecond(s);
  withSpeck(s);
  const r = R.catchSpeck(s, seq(0.5, 0.5)); // 0.5 of 100 is the frenzy band
  assert.equal(r.kind, 'frenzy');
  near(ratio(G.dustPerSecond(s), base), Math.log10(R.FRENZY_MULT), 1e-9);
  for (let i = 0; i < R.FRENZY_S / 0.5 - 1; i++) R.stepRhythm(fs(s), 0.5, () => 0);
  assert.ok(fxLeft(s, 'frenzy') > 0);
  R.stepRhythm(fs(s), 1, () => 0);
  assert.equal(fxLeft(s, 'frenzy'), 0);
  near(ratio(G.dustPerSecond(s), base), 0, 1e-9);
});

const fxLeft = (s, id) => fs(s).fx[id];

test('tap frenzy raises tap value only', () => {
  const s = fresh();
  s.gens[0] = { bought: 1, owned: N.n(1e6) };
  const tap0 = G.tapValue(s);
  const gens0 = G.genMult(s, 0);
  withSpeck(s);
  const r = R.catchSpeck(s, seq(0.5, 0.8));
  assert.equal(r.kind, 'tapfrenzy');
  near(ratio(G.tapValue(s), tap0), Math.log10(R.TAP_FRENZY_MULT), 1e-9);
  near(ratio(G.genMult(s, 0), gens0), 0, 1e-9);
});

test('same effect refreshes and never stacks, different effects multiply', () => {
  const s = fresh();
  const base = G.globalMult(s);
  R.addEffect(fs(s), 'frenzy', 20);
  R.stepRhythm(fs(s), 5, () => 0);
  R.addEffect(fs(s), 'frenzy', 20);
  assert.equal(fxLeft(s, 'frenzy'), 20);
  R.addEffect(fs(s), 'frenzy', 3); // a shorter one never cuts the timer
  assert.equal(fxLeft(s, 'frenzy'), 20);
  near(ratio(G.globalMult(s), base), Math.log10(R.FRENZY_MULT), 1e-9);
  R.addEffect(fs(s), 'charge', 60);
  near(ratio(G.globalMult(s), base), Math.log10(R.FRENZY_MULT * R.RETURN_MULT), 1e-9);
});

test('addEffect ignores unknown ids and bad seconds', () => {
  const f = R.initState();
  R.addEffect(f, 'nope', 10);
  R.addEffect(f, 'frenzy', NaN);
  R.addEffect(f, 'frenzy', -5);
  assert.deepEqual(f.fx, { frenzy: 0, tapfrenzy: 0, charge: 0 });
});

// ---- heat -------------------------------------------------------------------

test('taps raise heat to a cap and tap value follows', () => {
  const s = fresh();
  const base = G.tapValue(s);
  for (let i = 0; i < 100; i++) G.tap(s);
  assert.equal(fs(s).heat, 1);
  near(ratio(G.tapValue(s), base), Math.log10(1 + R.HEAT_BONUS), 1e-9);
});

test('heat decays to zero when the player stops', () => {
  const s = fresh();
  for (let i = 0; i < 10; i++) G.tap(s);
  const h = fs(s).heat;
  G.tick(s, 1);
  near(fs(s).heat, h - R.HEAT_DECAY_PER_S, 1e-9);
  G.tick(s, 60);
  assert.equal(fs(s).heat, 0);
  near(ratio(G.tapValue(s), G.TAP), 0, 1e-9);
});

function tapRate(perSecond, seconds) {
  const s = fresh();
  const dt = 1 / perSecond;
  for (let t = 0; t < seconds; t += dt) {
    G.tap(s);
    G.tick(s, dt);
  }
  return fs(s).heat;
}

test('steady fast tapping reaches the cap, slow tapping does not', () => {
  assert.ok(tapRate(8, 30) > 0.9);
  assert.ok(tapRate(2, 30) < 0.2);
});

test('automatic taps do not build heat', () => {
  const s = fresh();
  s.ups.twitch = 1;
  for (let i = 0; i < 40; i++) G.tick(s, 0.25);
  assert.equal(fs(s).heat, 0);
});

// ---- offline curve ----------------------------------------------------------

const H = 3600;

test('offline curve: full for 2 hours, then less, never above the time away', () => {
  assert.equal(R.offlineEffective(0), 0);
  assert.equal(R.offlineEffective(NaN), 0);
  assert.equal(R.offlineEffective(-5), 0);
  assert.equal(R.offlineEffective(1 * H), 1 * H);
  assert.equal(R.offlineEffective(2 * H), 2 * H);
  near(R.offlineEffective(6 * H), 2 * H + 4 * H * 0.6);
  near(R.offlineEffective(12 * H), 2 * H + 4 * H * 0.6 + 6 * H * 0.3);
  let prev = 0;
  for (let t = 0; t <= G.OFFLINE_CAP_S; t += 97) {
    const e = R.offlineEffective(t);
    assert.ok(e >= prev && e <= t + 1e-9, `${t}`);
    prev = e;
  }
});

test('return bonus grows with time away and starts at a threshold', () => {
  assert.equal(R.returnBonusSeconds(60), 0);
  assert.equal(R.returnBonusSeconds(15 * 60), 30);
  assert.equal(R.returnBonusSeconds(2 * H), 60);
  assert.equal(R.returnBonusSeconds(5 * H), 90);
  assert.equal(R.returnBonusSeconds(12 * H), 120);
});

function away(seconds, setup) {
  const s = fresh();
  s.gens[0] = { bought: 10, owned: N.n(100) };
  setup?.(s);
  const r = G.applyOffline(s, seconds);
  return { s, r };
}

test('applyOffline uses the efficiency curve', () => {
  const { s, r } = away(10 * H);
  const full = fresh();
  full.gens[0] = { bought: 10, owned: N.n(100) };
  G.advance(full, 10 * H);
  assert.ok(N.cmp(s.dust, full.dust) < 0);
  assert.ok(r.away === 10 * H);
  assert.equal(fs(s).catchingUp, false);
});

test('no speck appears during offline catch-up', () => {
  const { s } = away(10 * H, (st) => {
    fs(st).wait = 0;
  });
  assert.equal(fs(s).seq, 0);
  assert.equal(fs(s).ev, null);
});

test('long absence makes a welcome panel, short one a toast, tiny one nothing', () => {
  const long = away(3 * H).s;
  const w = fs(long).welcome;
  assert.ok(w);
  assert.equal(w.bonusSeconds, 60);
  assert.ok(N.cmp(w.gained, N.ZERO) > 0);
  assert.equal(long.notes.length, 0);

  const mid = away(2 * 60).s;
  assert.equal(fs(mid).welcome, null);
  assert.equal(mid.notes.length, 1);
  assert.match(mid.notes[0], /^Back after 2m 0s\./);

  const tiny = away(10).s;
  assert.equal(fs(tiny).welcome, null);
  assert.equal(tiny.notes.length, 0);
});

test('welcome gain counts spending during offline steps', () => {
  // Dust goes down when something buys in offline steps. Gain is measured on run.
  const before = { run: N.n(1), dust: N.n(1) };
  const after = { run: N.n(101), dust: N.n(0.5) };
  const w = R.buildWelcome(7200, 7200, before, after);
  near(N.toNumber(w.gained), 100, 1e-9);
  // Run is below the old value after a condense: use the new run as is.
  const reset = R.buildWelcome(7200, 7200, before, { run: N.n(0.4), dust: N.n(0.4) });
  near(N.toNumber(reset.gained), 0.4, 1e-9);
});

test('claiming the welcome panel starts the charged reservoir once', () => {
  const { s } = away(3 * H);
  const base = G.globalMult(s);
  assert.equal(R.claimWelcome(s), true);
  assert.equal(fs(s).welcome, null);
  assert.equal(fxLeft(s, 'charge'), 60);
  near(ratio(G.globalMult(s), base), Math.log10(R.RETURN_MULT), 1e-9);
  assert.equal(R.claimWelcome(s), false);
  assert.equal(fxLeft(s, 'charge'), 60);
});

test('welcome text names time, gain, landmark jump and bonus', () => {
  const w = {
    away: 5 * H,
    effective: 3.5 * H,
    gained: N.n(2e-18),
    dustBefore: N.n(1e-20),
    dustAfter: N.n(2e-18),
    bonusSeconds: 90,
  };
  const t = R.welcomeText(w);
  const all = t.lines.join(' ');
  assert.match(all, /away 5h 0m/);
  assert.match(all, /counted as 3h 30m/);
  assert.match(all, /Dust gathered: \+2\.00e-18 kg/);
  assert.match(all, /2\.3 orders of magnitude/);
  assert.match(all, /passed the mass of a virus/);
  assert.equal(t.bonus, 'Charged reservoir: all dust x2 for 90 s.');
  const none = R.welcomeText({ ...w, effective: w.away, gained: N.ZERO, dustBefore: N.ZERO, dustAfter: N.ZERO, bonusSeconds: 0 });
  assert.equal(none.bonus, null);
  assert.match(none.lines.join(' '), /No dust gathered/);
  assert.ok(!none.lines.join(' ').includes('counted as'));
});

test('hidden-tab title estimate follows production and the efficiency curve', () => {
  const s = fresh();
  s.gens[0] = { bought: 1, owned: N.n(1e6) };
  s.dust = N.n(1e-100);
  const p = R.projectedDust(s, 10 * H);
  assert.ok(N.cmp(p, s.dust) > 0);
  near(N.log10(N.sub(p, s.dust)), N.log10(N.scale(G.dustPerSecond(s), R.offlineEffective(10 * H))), 1e-9);
  assert.equal(R.titleText(N.n(1.5e-50)), '~1.50e-50 kg - Smallest Thing');
});

// ---- save and load ----------------------------------------------------------

test('save round trip keeps heat, timers and counters, and drops transient fields', () => {
  const s = fresh();
  for (let i = 0; i < 10; i++) G.tap(s);
  R.addEffect(fs(s), 'frenzy', 12);
  fs(s).caught = 3;
  fs(s).wait = 77;
  fs(s).ev = { id: 9, ttl: 5, life: 10, ang: 1, dist: 0.5 };
  fs(s).welcome = { away: 1 };
  const saved = JSON.parse(JSON.stringify(G.toSave(s)));
  assert.deepEqual(Object.keys(saved.f.rhythm).sort(), ['caught', 'fx', 'heat', 'missed', 'seq', 'wait']);
  const back = fs(G.fromSave(saved, 0));
  assert.equal(back.ev, null);
  assert.equal(back.welcome, null);
  assert.equal(back.caught, 3);
  assert.equal(back.wait, 77);
  assert.equal(back.fx.frenzy, 12);
  near(back.heat, fs(s).heat, 1e-12);
});

test('garbage saved data gives safe values', () => {
  for (const junk of [
    null, 'x', 5, [], {},
    { heat: NaN, wait: 'a', seq: -4, caught: 'z', missed: null, fx: 'bad' },
    { heat: 99, wait: 1e9, fx: { frenzy: 1e9, tapfrenzy: -3, charge: [NaN] } },
    { heat: [1], fx: null },
  ]) {
    const f = R.fromSaveState(junk);
    assert.ok(f.heat >= 0 && f.heat <= 1);
    assert.ok(f.wait === null || (f.wait >= 0 && f.wait <= R.EVENT_WAIT_S[1]));
    assert.ok(f.seq >= 0 && f.caught >= 0 && f.missed >= 0);
    for (const v of Object.values(f.fx)) assert.ok(v >= 0 && v <= 600);
  }
  const s = G.fromSave({ ...G.toSave(fresh()), f: { rhythm: { heat: 'hot', fx: 7 } } }, 0);
  G.tick(s, 1);
  assert.ok(Number.isFinite(s.dust.m));
});
