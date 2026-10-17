import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../game.js';
import * as N from '../num.js';
import * as C from './compaction.js';

const DENSE = 0;
const WIDE = 1;
const DEEP = 2;
const LENS = 3;

const fresh = () => G.newState(0);
const pebbles = (s) => N.toNumber(s.f.compaction.pebbles);
const withGrains = (g) => {
  const s = fresh();
  s.grains = N.n(g);
  return s;
};
const withPebbles = (p, count = 0) => {
  const s = fresh();
  s.f.compaction.pebbles = N.n(p);
  s.f.compaction.count = count;
  return s;
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('pebble formula: zero below the unlock, base at the unlock, grows with the root', () => {
  assert.ok(N.isZero(C.pebbleGain(N.n(99))));
  assert.equal(N.toNumber(C.pebbleGain(N.n(100))), C.PEBBLE_BASE);
  assert.equal(N.toNumber(C.pebbleGain(N.n(400))), Math.floor(C.PEBBLE_BASE * 2));
  assert.equal(N.toNumber(C.pebbleGain(N.n(10000))), Math.floor(C.PEBBLE_BASE * 10));
  assert.ok(N.gte(C.pebbleGain(N.n(1e30)), C.pebbleGain(N.n(1e20))));
});

test('compaction is locked until the grain requirement is met', () => {
  const s = withGrains(99);
  assert.equal(C.canCompact(s), false);
  assert.equal(C.compact(s), false);
  assert.equal(s.f.compaction.count, 0);
  assert.equal(N.toNumber(s.grains), 99);
  s.grains = N.n(100);
  assert.equal(C.canCompact(s), true);
});

test('the requirement grows after each compaction', () => {
  assert.equal(N.toNumber(C.requirement(0)), 100);
  near(N.toNumber(C.requirement(1)) / 100, C.COMPACT_GROWTH);
  near(N.toNumber(C.requirement(3)) / 100, C.COMPACT_GROWTH ** 3);
  const s = withGrains(100);
  s.f.compaction.count = 1;
  assert.equal(C.canCompact(s), false, 'old requirement is not enough');
  s.grains = C.requirement(1);
  assert.equal(C.canCompact(s), true);
});

test('compaction resets everything below and keeps the lattice and totals', () => {
  const s = withGrains(250);
  s.dust = N.n(5);
  s.run = N.n(5);
  s.gens[2] = { bought: 4, owned: N.n(4) };
  s.ups.grip = 3;
  s.condenses = 7;
  s.taps = 42;
  s.f.compaction.pebbles = N.n(2);
  C.place(s, 4, WIDE);
  assert.equal(C.compact(s), true);
  const fs = s.f.compaction;
  assert.ok(N.isZero(s.dust) && N.isZero(s.run) && N.isZero(s.grains));
  assert.ok(s.gens.every((g) => g.bought === 0 && N.isZero(g.owned)));
  assert.deepEqual(s.ups, {});
  assert.equal(s.condenses, 0);
  assert.equal(s.taps, 42);
  assert.equal(fs.count, 1);
  assert.equal(fs.grid[4].size, 1);
  assert.equal(N.toNumber(fs.pebbles), 1 + N.toNumber(C.pebbleGain(N.n(250))));
  assert.equal(N.toNumber(fs.total), N.toNumber(C.pebbleGain(N.n(250))));
  assert.equal(C.canCompact(s), false);
});

test('slots open in order and grow with each compaction', () => {
  assert.equal(C.slotsOpen(0), C.SLOTS_BASE);
  assert.equal(C.slotsOpen(2), C.SLOTS_BASE + 2);
  assert.equal(C.slotsOpen(99), C.SLOTS);
  assert.equal(C.isOpen(0, 4), true);
  assert.equal(C.isOpen(0, 8), false);
  assert.equal(C.isOpen(99, 8), true);
});

test('placing costs size plus one and respects slots, kind and maximum', () => {
  const s = withPebbles(100);
  assert.equal(C.place(s, 4, DENSE), true);
  assert.equal(pebbles(s), 99);
  assert.equal(C.place(s, 4, DENSE), true);
  assert.equal(pebbles(s), 97);
  assert.equal(C.place(s, 4, WIDE), false, 'other kind in a used slot');
  assert.equal(C.place(s, 8, DENSE), false, 'closed slot');
  assert.equal(C.place(s, 4, 9), false, 'bad kind');
  assert.equal(C.place(s, -1, DENSE), false);
  assert.equal(C.place(s, 1.5, DENSE), false);
  C.place(s, 4, DENSE);
  C.place(s, 4, DENSE);
  assert.equal(s.f.compaction.grid[4].size, C.SIZE_MAX);
  assert.equal(C.place(s, 4, DENSE), false, 'full');
  assert.equal(pebbles(s), 100 - C.spentOn(C.SIZE_MAX));
});

test('placing fails without enough pebbles', () => {
  const s = withPebbles(1);
  assert.equal(C.place(s, 4, DENSE), true);
  assert.equal(C.place(s, 4, DENSE), false);
  assert.equal(pebbles(s), 0);
});

test('clearing refunds part of the cost', () => {
  const s = withPebbles(10);
  for (let i = 0; i < 3; i++) C.place(s, 4, DENSE);
  assert.equal(pebbles(s), 10 - 6);
  assert.equal(C.clear(s, 4), true);
  assert.equal(pebbles(s), 4 + Math.floor(6 * C.REFUND));
  assert.equal(s.f.compaction.grid[4].size, 0);
  assert.equal(C.clear(s, 4), false);
  assert.equal(C.clear(s, 99), false);
});

const gridWith = (cells) => {
  const g = C.emptyGrid();
  for (const [i, kind, size] of cells) g[i] = { kind, size };
  return g;
};

test('adjacency: lone slot scores its size', () => {
  const g = gridWith([[4, DENSE, 3]]);
  near(C.slotScore(g, 4), 3);
});

test('adjacency: same kind neighbours add a bond', () => {
  const g = gridWith([[4, DENSE, 2], [1, DENSE, 1], [3, DENSE, 1]]);
  near(C.slotFactor(g, 4), 1 + 2 * C.BOND);
  near(C.slotFactor(g, 1), 1 + C.BOND);
});

test('adjacency: the feeding kind helps, but only in one direction', () => {
  const g = gridWith([[4, WIDE, 1], [1, DENSE, 1]]); // Dense feeds Wide
  near(C.slotFactor(g, 4), 1 + C.FEED);
  near(C.slotFactor(g, 1), 1); // Wide is next in line for Dense: no bonus
});

test('adjacency: the last kind feeds the first', () => {
  const g = gridWith([[4, DENSE, 1], [1, LENS, 1]]);
  near(C.slotFactor(g, 4), 1 + C.FEED);
});

test('adjacency: opposite kinds clash and the factor has a floor', () => {
  const g = gridWith([[4, DENSE, 1], [1, DEEP, 1]]);
  near(C.slotFactor(g, 4), 1 + C.CLASH);
  const crowd = gridWith([[4, DENSE, 1], [1, DEEP, 1], [3, DEEP, 1], [5, DEEP, 1], [7, DEEP, 1]]);
  assert.equal(C.slotFactor(crowd, 4), C.MIN_FACTOR);
});

test('adjacency uses grid edges, not wrap-around', () => {
  assert.deepEqual(C.neighbours(2).sort(), [1, 5]);
  assert.deepEqual(C.neighbours(3).sort(), [0, 4, 6]);
  const g = gridWith([[2, DENSE, 1], [3, DENSE, 1]]); // end of row 0 and start of row 1
  near(C.slotFactor(g, 2), 1);
});

test('a fed pair scores more than a bonded pair', () => {
  const total = (g) => C.kindScores(g).reduce((a, b) => a + b, 0);
  const fed = gridWith([[4, DENSE, 1], [1, WIDE, 1]]);
  const bonded = gridWith([[4, DENSE, 1], [1, DENSE, 1]]);
  assert.ok(total(fed) > total(bonded));
});

test('effects: scores map to the stated multipliers', () => {
  const g = gridWith([[4, DENSE, 2], [1, WIDE, 2], [3, DEEP, 2], [5, LENS, 2]]);
  const e = C.effectsFor(g);
  const sc = C.kindScores(g);
  near(N.toNumber(e.tap), 2 ** sc[DENSE]);
  near(N.toNumber(e.gens), 2 ** sc[WIDE]);
  near(e.grain, 1 + 0.5 * sc[DEEP]);
  near(e.condense, 1 + 0.1 * sc[LENS]);
  const none = C.effectsFor(C.emptyGrid());
  assert.deepEqual(none.tap, N.ONE);
  assert.equal(none.grain, 1);
});

test('hooks: empty lattice changes nothing', () => {
  const a = fresh();
  const b = fresh();
  b.grains = a.grains = N.n(50);
  assert.deepEqual(G.tapValue(a), G.tapValue(b));
  assert.deepEqual(G.grainMult(a), G.grainMult(b));
});

test('hooks: dense, wide and deep change the core numbers', () => {
  const base = fresh();
  base.grains = N.n(10);
  base.gens[0] = { bought: 1, owned: N.ONE };
  const s = withPebbles(100);
  s.grains = N.n(10);
  s.gens[0] = { bought: 1, owned: N.ONE };
  C.place(s, 4, DENSE);
  C.place(s, 1, WIDE);
  C.place(s, 3, DEEP);
  const sc = C.kindScores(s.f.compaction.grid);
  // Deep: total grain term is 1 + grains x k.
  const k = 1 + 0.5 * sc[DEEP];
  const global = N.toNumber(G.globalMult(s)) / N.toNumber(G.globalMult(base));
  near(global, (1 + 10 * k) / 11);
  // Dense: tap power, on top of the shared global part.
  near(N.toNumber(G.tapValue(s)) / N.toNumber(G.tapValue(base)), global * 2 ** sc[DENSE]);
  // Wide: collector output, on top of the shared global part.
  near(N.toNumber(G.genMult(s, 0)) / N.toNumber(G.genMult(base, 0)), global * 2 ** sc[WIDE]);
});

test('hooks: lens raises condense gain', () => {
  const s = withPebbles(100);
  s.unlocked.condense = true;
  s.run = N.mul(G.condenseAt(s), N.n(1e10));
  const plain = N.toNumber(G.condenseGain(s));
  assert.ok(plain >= 10);
  C.place(s, 4, LENS);
  C.place(s, 4, LENS);
  const k = 1 + 0.1 * C.kindScores(s.f.compaction.grid)[LENS];
  assert.equal(N.toNumber(G.condenseGain(s)), Math.floor(plain * k));
});

test('save and load keep the lattice, pebbles and count', () => {
  const s = withPebbles(30, 2);
  C.place(s, 4, DENSE);
  C.place(s, 4, DENSE);
  C.place(s, 1, WIDE);
  s.f.compaction.total = N.n(33);
  const data = JSON.parse(JSON.stringify(G.toSave(s)));
  const back = G.fromSave(data, 0);
  assert.deepEqual(back.f.compaction, s.f.compaction);
  assert.deepEqual(JSON.parse(JSON.stringify(G.toSave(back))), data);
});

test('garbage saved data loads as a safe lattice', () => {
  const bad = [
    null, 5, 'x', [], {},
    { pebbles: 'a', total: [NaN, 1], count: -4, grid: 'no' },
    { pebbles: [1, Infinity], count: 1e99, grid: [null, 7, { kind: 'a', size: 2 }, { kind: 99, size: 1 }, { kind: 1, size: -3 }] },
    { count: 0, grid: Array.from({ length: 20 }, () => ({ kind: 0, size: 1e9 })) },
  ];
  for (const x of bad) {
    const data = JSON.parse(JSON.stringify(G.toSave(fresh())));
    data.f.compaction = x;
    const s = G.fromSave(data, 0);
    const fs = s.f.compaction;
    assert.equal(fs.grid.length, C.SLOTS);
    assert.ok(Number.isFinite(fs.pebbles.m) && Number.isFinite(fs.pebbles.e));
    assert.ok(fs.count >= 0 && fs.count <= 1e6);
    for (let i = 0; i < C.SLOTS; i++) {
      const c = fs.grid[i];
      assert.ok(c.size >= 0 && c.size <= C.SIZE_MAX);
      if (c.size > 0) assert.ok(C.isOpen(fs.count, i));
    }
    G.tick(s, 1);
  }
});

test('a saved slot that is still locked is dropped', () => {
  const data = JSON.parse(JSON.stringify(G.toSave(fresh())));
  data.f.compaction = { pebbles: [1, 0], total: [1, 0], count: 0, grid: gridWith([[8, DENSE, 2]]) };
  const s = G.fromSave(data, 0);
  assert.equal(s.f.compaction.grid[8].size, 0);
});
