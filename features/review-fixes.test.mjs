// Regression tests for bugs found in the review of the merged features.
// They run with every feature registered, because each bug was an interaction between features.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../game.js';
import * as N from '../num.js';
import './index.js';
import * as C from './challenges.js';
import * as K from './compaction.js';
import * as R from './rhythm.js';

const lattice = (s, kind, slots = [4, 1, 3, 5]) => {
  s.f.compaction.pebbles = N.n(100);
  for (const i of slots) for (let n = 0; n < 4; n++) K.place(s, i, kind);
};
const DEEP = 2;

test('swarm focus cannot leave the player with no way to earn dust', () => {
  const s = G.newState(0);
  s.condenses = 1;
  s.unlocked.condense = true;
  G.tick(s, 0.1); // makes the first offer
  s.f.challenges.offer = ['swarm', 'tapper', 'gamble'];
  assert.ok(C.pickFocus(s, 'swarm'));
  assert.equal(N.toNumber(G.tapValue(s)), 0, 'swarm turns taps off');
  assert.ok(N.cmp(s.gens[0].owned, N.ONE) >= 0, 'but one free cling exists');
  G.advance(s, 120);
  assert.ok(N.cmp(s.dust, N.ZERO) > 0, 'and it makes dust');
});

test('lattice power raises the condense threshold', () => {
  const s = G.newState(0);
  s.grains = N.n(1000);
  const plain = G.condenseAt(s);
  lattice(s, DEEP);
  assert.ok(N.cmp(G.condenseAt(s), plain) > 0);
});

test('permanent bonuses are paused inside a challenge', () => {
  const s = G.newState(0);
  s.condenses = 9;
  s.unlocked.condense = true;
  s.grains = N.n(1000);
  lattice(s, DEEP);
  s.f.milestones.lm = 6;
  s.f.milestones.achN = 10;
  const outside = G.globalMult(s);
  assert.ok(N.cmp(outside, N.n(1000)) > 0);
  assert.ok(C.enterChallenge(s, 'short'));
  // Only the challenge rule applies. Grains, lattice and milestones do not.
  assert.equal(N.cmp(G.globalMult(s), N.ONE), 0);
  assert.equal(N.cmp(G.tapValue(s), G.TAP), 0);
});

test('compaction waits until a challenge ends', () => {
  const s = G.newState(0);
  s.condenses = 9;
  s.unlocked.condense = true;
  s.grains = N.n(1e4);
  assert.ok(K.canCompact(s));
  C.enterChallenge(s, 'short');
  assert.equal(K.canCompact(s), false);
  assert.equal(K.compact(s), false);
});

test('a compaction is not a fast condense', () => {
  const s = G.newState(0);
  s.unlocked.condense = true;
  s.grains = N.n(1e4);
  s.f.milestones.fast = 1000;
  s.f.milestones.runTime = 5;
  assert.ok(K.compact(s));
  assert.equal(s.f.milestones.fast, 1000);
  assert.equal(s.f.milestones.ach.fast20, undefined);
});

test('an offline catch-up counts all dust across condenses', () => {
  const s = G.newState(0);
  const before = s.flow;
  s.dust = N.n(1);
  s.run = N.n(1);
  G.gain(s, N.n(5));
  s.dust = N.ZERO; // a condense wipes dust and run, never the flow
  s.run = N.ZERO;
  assert.equal(N.toNumber(N.sub(s.flow, before)), 5);
});

test('offline hooks are chained, not last-wins', () => {
  const s = G.newState(0);
  const seen = [];
  const first = { id: 'test-a', offline: (st, sec) => { seen.push(sec); return sec / 2; } };
  const second = { id: 'test-b', offline: (st, sec) => { seen.push(sec); return sec / 2; } };
  G.registerFeature(first);
  G.registerFeature(second);
  // Registered after the real features, so they see what the real features returned.
  G.applyOffline(s, 1000);
  const [a, b] = seen.slice(-2);
  assert.equal(b, a / 2, 'the second hook received the first hook result');
});

test('two returns before the panel is taken are added up', () => {
  const a = { away: 400, effective: 400, gained: N.n(10), dustBefore: N.n(1), dustAfter: N.n(11), bonusSeconds: 0 };
  const b = { away: 3600, effective: 3600, gained: N.n(30), dustBefore: N.n(11), dustAfter: N.n(41), bonusSeconds: 0 };
  const m = R.mergeWelcome(a, b);
  assert.equal(m.away, 4000);
  assert.equal(N.toNumber(m.gained), 40);
  assert.equal(N.toNumber(m.dustBefore), 1);
  assert.equal(N.toNumber(m.dustAfter), 41);
});

test('the welcome panel uses the core total when it is given', () => {
  const before = { run: N.n(100), dust: N.n(100) };
  const after = { run: N.n(2), dust: N.n(2) }; // a condense happened near the end
  const w = R.buildWelcome(7200, 7200, before, after, N.n(900));
  assert.equal(N.toNumber(w.gained), 900);
});

test('offers do not repeat after a compaction resets the condense count', () => {
  const s = G.newState(0);
  s.condenses = 1;
  s.unlocked.condense = true;
  s.f.challenges.salt = 777;
  G.tick(s, 0.1);
  const idx = s.f.challenges.nonce;
  s.f.challenges.offerRun = 0; // the next run needs a new offer, as after a compaction and a condense
  G.tick(s, 0.1);
  assert.equal(s.f.challenges.nonce, idx + 1, 'a new offer index, not the one used before');
  assert.deepEqual(s.f.challenges.offer, C.makeOffer(777, idx).offer);
});
