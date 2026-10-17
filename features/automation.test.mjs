import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../game.js';
import * as N from '../num.js';
import './index.js';
import * as A from './automation.js';

const TAP = G.TAP;
const dustOf = (taps) => N.mul(N.n(taps), TAP);

// A state with grains, condenses and dust, and the given autobuyers on.
function make({ grains = 100, condenses = 20, dust = 0, on = [] } = {}) {
  const s = G.newState(0);
  s.grains = N.n(grains);
  s.condenses = condenses;
  s.dust = dustOf(dust);
  s.run = s.dust;
  for (const id of on) assert.ok(A.setOn(s, id, true), `could not turn on ${id}`);
  return s;
}

const tickBuyers = (s, seconds) => A.runAutobuyers(s, seconds);

test('a locked autobuyer cannot be turned on and buys nothing', () => {
  const s = make({ grains: 1, dust: 1e6 });
  assert.equal(A.setOn(s, 'gen0', true), false);
  s.f.automation.on.gen0 = true; // forged flag, for example from a bad save
  tickBuyers(s, 100);
  assert.equal(s.gens[0].bought, 0);
});

test('an autobuyer buys one item per interval, and only when the timer fires', () => {
  const s = make({ dust: 1e6, on: ['gen0'] });
  s.f.automation.reserve.gen0 = 0;
  tickBuyers(s, A.INTERVAL_BASE * 0.5);
  assert.equal(s.gens[0].bought, 0);
  tickBuyers(s, A.INTERVAL_BASE * 0.5);
  assert.equal(s.gens[0].bought, 1);
  tickBuyers(s, A.INTERVAL_BASE * 3);
  assert.equal(s.gens[0].bought, 4);
});

test('a gen autobuyer buys its own tier, a method autobuyer buys the cheapest method', () => {
  const s = make({ dust: 1e9, on: ['gen2'] });
  s.f.automation.reserve.gen2 = 0;
  tickBuyers(s, A.INTERVAL_BASE);
  assert.deepEqual(s.gens.map((g) => g.bought), [0, 0, 1, 0, 0, 0]);

  const m = make({ dust: 1e9, on: ['methods'] });
  tickBuyers(m, A.INTERVAL_BASE);
  assert.equal(G.upLevel(m, 'grip'), 1); // grip costs 25 taps, the lowest
  tickBuyers(m, A.INTERVAL_BASE);
  assert.equal(G.upLevel(m, 'grip'), 2); // 125 taps now, still below twitch at 400
  tickBuyers(m, A.INTERVAL_BASE * 3);
  assert.equal(G.upLevel(m, 'twitch'), 1);
});

test('the reserve keeps a share of dust unspent', () => {
  // Cling costs 10 taps. With 15 taps and a 50% reserve only 7.5 taps may be spent.
  const s = make({ dust: 15, on: ['gen0'] });
  s.f.automation.reserve.gen0 = 0.5;
  tickBuyers(s, A.INTERVAL_BASE);
  assert.equal(s.gens[0].bought, 0);
  s.dust = dustOf(25);
  tickBuyers(s, A.INTERVAL_BASE);
  assert.equal(s.gens[0].bought, 1);
  s.f.automation.reserve.gen0 = 0.9;
  s.dust = dustOf(15);
  tickBuyers(s, A.INTERVAL_BASE);
  assert.equal(s.gens[0].bought, 1);
});

test('slots limit how many autobuyers run', () => {
  const s = make({ condenses: 0 }); // one slot
  assert.equal(A.slotCount(s), 1);
  assert.equal(A.setOn(s, 'gen0', true), true);
  assert.equal(A.setOn(s, 'methods', true), false);
  assert.deepEqual(A.activeIds(s), ['gen0']);
  A.setOn(s, 'gen0', false);
  assert.equal(A.setOn(s, 'methods', true), true);
});

test('slots grow with condenses and stop at the cap', () => {
  const s = make();
  s.condenses = 0;
  assert.equal(A.slotCount(s), A.SLOT_BASE);
  s.condenses = A.SLOT_EVERY;
  assert.equal(A.slotCount(s), A.SLOT_BASE + 1);
  s.condenses = 10000;
  assert.equal(A.slotCount(s), A.SLOT_MAX);
  assert.equal(A.condensesToNextSlot(s), 0);
});

test('extra on flags beyond the slots are ignored', () => {
  const s = make({ condenses: 0, dust: 1e6 });
  Object.assign(s.f.automation.on, { gen0: true, gen1: true });
  s.f.automation.reserve.gen0 = 0;
  s.f.automation.reserve.gen1 = 0;
  s.f.automation.order = ['gen1', 'gen0', ...A.IDS.filter((x) => x !== 'gen0' && x !== 'gen1')];
  assert.deepEqual(A.activeIds(s), ['gen1']);
});

test('priority order decides who spends first', () => {
  const rest = A.IDS.filter((x) => x !== 'gen0' && x !== 'methods');
  // 30 taps: cling costs 10, grip costs 25. Only the first buyer in line can pay for its item.
  const both = (order) => {
    const s = make({ condenses: 30, dust: 30, on: ['gen0', 'methods'] });
    s.f.automation.order = order;
    s.f.automation.reserve.gen0 = 0;
    s.f.automation.reserve.methods = 0;
    tickBuyers(s, A.INTERVAL_BASE);
    return s;
  };
  const genFirst = both(['gen0', 'methods', ...rest]);
  assert.equal(genFirst.gens[0].bought, 1);
  assert.equal(G.upLevel(genFirst, 'grip'), 0); // 20 taps left, grip needs 25
  const methodFirst = both(['methods', 'gen0', ...rest]);
  assert.equal(G.upLevel(methodFirst, 'grip'), 1);
  assert.equal(methodFirst.gens[0].bought, 0); // 5 taps left, cling needs 10
});

test('move swaps neighbours and refuses to go past the ends', () => {
  const s = make();
  const first = s.f.automation.order[0];
  assert.equal(A.move(s, first, -1), false);
  assert.equal(A.move(s, first, 1), true);
  assert.equal(s.f.automation.order[1], first);
});

test('speed levels cost points, not grains, and shorten the interval', () => {
  const s = make({ grains: 10 });
  const before = A.intervalOf(s);
  assert.equal(A.points(s), 10);
  assert.equal(A.buySpeed(s), true);
  assert.ok(A.intervalOf(s) < before);
  assert.equal(N.toNumber(s.grains), 10); // multiplier untouched
  assert.equal(A.points(s), 10 - A.SPEED_COST_BASE);
  const poor = make({ grains: 1 });
  assert.equal(A.buySpeed(poor), false);
  assert.equal(poor.f.automation.speed, 0);
});

test('speed stops at the maximum level', () => {
  const s = make({ grains: 1e6 });
  while (A.buySpeed(s));
  assert.equal(s.f.automation.speed, A.SPEED_MAX);
  assert.equal(A.buySpeed(s), false);
});

test('auto-condense is locked early, honours its minimum gain, then condenses', () => {
  const early = make({ grains: A.AUTO_CONDENSE_GRAINS - 1 });
  assert.equal(A.setCond(early, { on: true }), false);

  const s = make({ grains: A.AUTO_CONDENSE_GRAINS });
  s.unlocked.condense = true;
  assert.equal(A.setCond(s, { on: true, min: 5 }), true);
  s.run = N.mul(G.CONDENSE_AT, N.n(1e3)); // gain 3
  s.dust = s.run;
  assert.equal(A.runAutoCondense(s), false);
  s.run = N.mul(G.CONDENSE_AT, N.n(1e6)); // gain 6
  s.dust = s.run;
  const grainsBefore = N.toNumber(s.grains);
  assert.equal(A.runAutoCondense(s), true);
  assert.equal(N.toNumber(s.grains), grainsBefore + 6);
  assert.equal(s.dust, N.ZERO);
  assert.equal(s.condenses, 21);
});

test('auto-condense does nothing when switched off', () => {
  const s = make({ grains: A.AUTO_CONDENSE_GRAINS });
  s.unlocked.condense = true;
  s.run = N.mul(G.CONDENSE_AT, N.n(1e9));
  assert.equal(A.runAutoCondense(s), false);
});

test('a condense clears timers and nothing is bought into the reset', () => {
  const s = make({ grains: A.AUTO_CONDENSE_GRAINS, dust: 1e6, on: ['gen0'] });
  s.unlocked.condense = true;
  A.setCond(s, { on: true, min: 1 });
  s.f.automation.reserve.gen0 = 0;
  s.run = N.mul(G.CONDENSE_AT, N.n(1e5));
  s.f.automation.timers.gen0 = A.INTERVAL_BASE * 0.9;
  // The buyer fires first (timer crosses the interval) and then auto-condense wipes the run.
  A.step(s, A.INTERVAL_BASE * 0.2);
  assert.equal(s.condenses, 21);
  assert.equal(s.gens[0].bought, 0);
  assert.equal(s.dust, N.ZERO);
  assert.deepEqual(s.f.automation.timers, {});
  // Right after the reset the buyer has no dust and no stored time to spend.
  A.step(s, 0.01);
  assert.equal(s.gens[0].bought, 0);
});

test('save and load keep settings and drop garbage', () => {
  const s = make({ dust: 100, on: ['gen0', 'methods'] });
  s.f.automation.reserve.gen0 = 0.75;
  A.move(s, 'gen3', -1);
  A.buySpeed(s);
  A.setCond(s, { on: true, min: 50 });
  const back = G.fromSave(JSON.parse(JSON.stringify(G.toSave(s))), 0);
  assert.deepEqual(back.f.automation.on, s.f.automation.on);
  assert.deepEqual(back.f.automation.order, s.f.automation.order);
  assert.equal(back.f.automation.reserve.gen0, 0.75);
  assert.equal(back.f.automation.speed, 1);
  assert.equal(back.f.automation.spent, s.f.automation.spent);
  assert.deepEqual(back.f.automation.cond, { on: true, min: 50 });

  const bad = A.fromSave({
    on: { gen0: 'yes', nope: true },
    order: ['gen1', 'gen1', 'zzz'],
    reserve: { gen0: 7, gen1: 0.9 },
    speed: 999,
    spent: -5,
    cond: { on: true, min: 3 },
  });
  assert.deepEqual(bad.on, {});
  assert.equal(bad.order[0], 'gen1');
  assert.deepEqual([...bad.order].sort(), [...A.IDS].sort());
  assert.equal(bad.reserve.gen0, 0.5);
  assert.equal(bad.reserve.gen1, 0.9);
  assert.equal(bad.speed, A.SPEED_MAX);
  assert.equal(bad.spent, 0);
  assert.equal(bad.cond.min, A.DEFAULT_MIN_GAIN);
});

test('autobuyer settings survive a condense', () => {
  const s = make({ grains: 50, dust: 1e6, on: ['gen0'] });
  s.unlocked.condense = true;
  s.run = N.mul(G.CONDENSE_AT, N.n(1e4));
  assert.ok(G.condense(s));
  assert.deepEqual(A.activeIds(s), ['gen0']); // settings survive the reset
});

test('offline catch-up with autobuyers and auto-condense stays fast and finite', () => {
  const s = make({ grains: 200, condenses: 40, dust: 0, on: ['methods', 'gen0', 'gen1', 'gen2', 'gen3', 'gen4'] });
  s.unlocked.condense = true;
  A.setCond(s, { on: true, min: 1 });
  s.dust = dustOf(1e4);
  s.run = s.dust;
  const t0 = performance.now();
  const r = G.applyOffline(s, G.OFFLINE_CAP_S);
  const ms = performance.now() - t0;
  assert.ok(ms < 3000, `took ${ms} ms`);
  assert.ok(Number.isFinite(r.gained.m) && Number.isFinite(s.dust.m) && Number.isFinite(s.grains.m));
  assert.ok(s.condenses > 40); // auto-condense ran during catch-up
  assert.equal(s.f.automation.quiet, false);
  assert.equal(s.notes.filter((x) => x.startsWith('Auto-condensed')).length, 0); // no spam
  assert.equal(s.notes.filter((x) => x.startsWith('Autobuyers bought')).length, 1);
});
