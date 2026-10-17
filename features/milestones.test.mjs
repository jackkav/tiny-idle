import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../game.js';
import * as N from '../num.js';
import { LADDER, landmarkTicks, ordersTo, describeScale, barFraction } from '../scale.js';
import './index.js';
import * as M from './milestones.js';

const fresh = () => G.newState(0);
const give = (s, kg) => {
  s.dust = N.n(kg);
  G.tick(s, 0.01);
};
const fs = (s) => s.f.milestones;
const roundTrip = (s) => G.fromSave(JSON.parse(JSON.stringify(G.toSave(s))), 0);

test('every landmark on the ladder has a reward and the ladder is sorted', () => {
  for (const lm of LADDER) assert.ok(M.REWARDS[lm.name], lm.name);
  for (let i = 1; i < LADDER.length; i++) assert.ok(LADDER[i].exp > LADDER[i - 1].exp);
});

test('a landmark pays once, even if dust falls and rises again', () => {
  const s = fresh();
  const first = LADDER[0];
  give(s, first.kg * 2);
  assert.equal(fs(s).lm, 1);
  const tapAfter = G.tapValue(s);
  const notes = s.notes.filter((t) => t.startsWith('Landmark')).length;
  assert.equal(notes, 1);
  s.dust = N.ZERO;
  give(s, first.kg * 2);
  G.tick(s, 1);
  assert.equal(fs(s).lm, 1);
  assert.equal(s.notes.filter((t) => t.startsWith('Landmark')).length, 1);
  assert.deepEqual(G.tapValue(s), tapAfter);
});

test('a landmark is reached by lifetime best dust, not by current dust', () => {
  const s = fresh();
  give(s, LADDER[1].kg * 2);
  assert.equal(fs(s).lm, 2);
  s.dust = N.ZERO;
  G.tick(s, 1);
  assert.equal(fs(s).lm, 2);
  assert.ok(N.gte(fs(s).best, LADDER[1].at));
});

test('best dust and landmarks survive a condense', () => {
  const s = fresh();
  give(s, LADDER[2].kg * 2);
  s.unlocked.condense = true;
  s.run = N.n(1e-60);
  const before = { lm: fs(s).lm, best: fs(s).best };
  assert.ok(G.condense(s));
  assert.equal(s.dust, N.ZERO);
  assert.equal(fs(s).lm, before.lm);
  assert.deepEqual(fs(s).best, before.best);
});

test('best dust and landmarks survive save and load', () => {
  const s = fresh();
  give(s, LADDER[3].kg * 2);
  const back = roundTrip(s);
  assert.equal(fs(back).lm, fs(s).lm);
  assert.deepEqual(fs(back).best, fs(s).best);
  assert.deepEqual(G.tapValue(back), G.tapValue(s));
});

test('rewards of different kinds change the right numbers', () => {
  const s = fresh();
  const base = { tap: G.tapValue(s), gen: G.genCost(s, 0), mult: G.genMult(s, 0) };
  fs(s).lm = LADDER.findIndex((l) => M.REWARDS[l.name].kind === 'tap') + 1;
  assert.ok(N.cmp(G.tapValue(s), base.tap) > 0);
  fs(s).lm = LADDER.length;
  assert.ok(N.cmp(G.genCost(s, 0), base.gen) < 0);
  assert.ok(N.cmp(G.genMult(s, 0), base.mult) > 0);
  assert.deepEqual(G.upCost(s, 'grip'), G.upCost(fresh(), 'grip'));
});

test('combined global bonus is capped', () => {
  assert.equal(M.globalFactor(0, 0), 1);
  assert.equal(M.globalFactor(LADDER.length, 1e6), M.GLOBAL_CAP);
  assert.ok(M.globalFactor(LADDER.length, M.ACHIEVEMENTS.length) < M.GLOBAL_CAP);
  assert.equal(M.globalFactor(-5, -5), 1);
  assert.equal(M.globalFactor(NaN, NaN), 1);
});

test('collector prices never fall below the floor', () => {
  const s = fresh();
  fs(s).lm = LADDER.length;
  const full = N.log10(G.genCost(s, 0)) - N.log10(G.genCost(fresh(), 0));
  assert.ok(full >= Math.log10(M.COST_FLOOR) - 1e-9);
});

test('ladder view shows reached, one next goal, two teasers and hides the rest', () => {
  const v0 = M.ladderView(0);
  assert.deepEqual([v0.reached, v0.next, v0.teasers], [0, 0, [1, 2]]);
  assert.equal(v0.hidden, LADDER.length - 3);
  const v = M.ladderView(5);
  assert.deepEqual([v.reached, v.next, v.teasers], [5, 5, [6, 7]]);
  assert.equal(v.reached + 1 + v.teasers.length + v.hidden, LADDER.length);
  const end = M.ladderView(LADDER.length);
  assert.deepEqual([end.next, end.teasers, end.hidden], [-1, [], 0]);
  assert.equal(M.ladderView(99).reached, LADDER.length);
});

test('distance to the next landmark is in orders of magnitude and never negative', () => {
  const lm = { exp: -30 };
  assert.ok(Math.abs(ordersTo(N.n(1e-100), lm) - 70) < 1e-9);
  assert.ok(Math.abs(ordersTo(N.ZERO, lm) - 71) < 1e-9);
  assert.equal(ordersTo(N.n(1), lm), 0);
});

test('achievements unlock once and each adds the same small bonus', () => {
  const s = fresh();
  s.taps = 1;
  G.tick(s, 0.1);
  assert.ok(fs(s).ach.tap1);
  assert.equal(fs(s).achN, 1);
  G.tick(s, 0.1);
  assert.equal(fs(s).achN, 1);
  assert.equal(s.notes.filter((t) => t === 'Achievement: First touch').length, 1);
  assert.ok(Math.abs(M.globalFactor(0, 1) - (1 + M.ACH_BONUS)) < 1e-12);
});

test('collector, tap, condense and grain achievements trigger from state', () => {
  const s = fresh();
  s.gens.forEach((g) => (g.bought = 1));
  s.taps = 10000;
  s.ups.grip = 1;
  s.condenses = 10;
  s.grains = N.n(1000);
  G.tick(s, 0.1);
  for (const id of ['gen0', 'gen5', 'fullhouse', 'tap10k', 'tap100', 'method1', 'condense10', 'grains1000', 'grains10']) {
    assert.ok(fs(s).ach[id], id);
  }
  assert.ok(!fs(s).ach.tenfold);
  s.gens[2].bought = 100;
  G.tick(s, 0.1);
  assert.ok(fs(s).ach.tenfold && fs(s).ach.hundredfold);
});

test('a fast condense unlocks the speed achievements and a slow one does not', () => {
  const slow = fresh();
  slow.unlocked.condense = true;
  slow.run = N.n(1e-60);
  G.tick(slow, M.FAST_RUN_S + 5);
  slow.run = N.n(1e-60);
  G.condense(slow);
  assert.ok(!fs(slow).ach.fast60);
  assert.equal(fs(slow).runTime, 0);

  const quick = fresh();
  quick.unlocked.condense = true;
  quick.run = N.n(1e-60);
  G.tick(quick, M.FASTER_RUN_S - 5);
  quick.run = N.n(1e-60);
  G.condense(quick);
  assert.ok(fs(quick).ach.fast60 && fs(quick).ach.fast20);
});

test('achievements and run time survive save and load', () => {
  const s = fresh();
  s.taps = 100;
  G.tick(s, 7);
  const back = roundTrip(s);
  assert.deepEqual(Object.keys(fs(back).ach).sort(), Object.keys(fs(s).ach).sort());
  assert.equal(fs(back).achN, fs(s).achN);
  assert.equal(fs(back).runTime, 7);
});

test('garbage milestone data in a save is safe', () => {
  const junk = [
    null, 5, 'x', [], {},
    { best: 'no', lm: 'many', ach: 'all', runTime: -3, fast: 'x' },
    { best: [NaN, 1], lm: 1e9, ach: ['nope', 7, null, 'tap1'], runTime: Infinity, fast: NaN },
    { lm: 99, best: [1, 50] },
  ];
  for (const d of junk) {
    const data = JSON.parse(JSON.stringify(G.toSave(fresh())));
    data.f.milestones = d;
    const s = G.fromSave(data, 0);
    G.tick(s, 1);
    const f = fs(s);
    assert.ok(f.lm >= 0 && f.lm <= LADDER.length);
    assert.ok(Number.isFinite(f.runTime) && f.runTime >= 0);
    assert.ok(f.fast === null || Number.isFinite(f.fast));
    assert.equal(f.achN, Object.keys(f.ach).length);
    assert.ok(Number.isFinite(M.globalFactor(f.lm, f.achN)));
  }
});

test('a saved landmark count cannot exceed what the saved best dust has earned', () => {
  const data = JSON.parse(JSON.stringify(G.toSave(fresh())));
  data.f.milestones = { best: N.toJSON(N.n(LADDER[1].kg * 2)), lm: LADDER.length, ach: [], runTime: 0, fast: null };
  assert.equal(fs(G.fromSave(data, 0)).lm, 2);
});

test('an offline catch-up of 20000 steps stays fast and pays landmarks on the way', () => {
  const s = fresh();
  s.gens[0] = { bought: 50, owned: N.n(1e60) };
  const t0 = performance.now();
  G.advance(s, 12 * 3600);
  assert.ok(performance.now() - t0 < 5000);
  assert.ok(fs(s).lm >= 1);
});

test('scale.js keeps old behaviour and adds ticks for every ladder landmark', () => {
  assert.match(describeScale(N.n(1e-101)), /an electron/);
  assert.equal(barFraction(N.ZERO), 0);
  const ticks = landmarkTicks();
  assert.equal(ticks.length, LADDER.length);
  for (let i = 0; i < ticks.length; i++) {
    assert.ok(ticks[i].frac > 0 && ticks[i].frac < 1);
    if (i > 0) assert.ok(ticks[i].frac > ticks[i - 1].frac);
  }
});
