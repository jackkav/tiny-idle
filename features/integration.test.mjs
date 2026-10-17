// Runs with every registered feature. Catches broken hooks, NaN and save problems after merges.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../game.js';
import * as N from '../num.js';
import './index.js';

const finite = (a) => Number.isFinite(a.m) && Number.isFinite(a.e);

test('every feature has a unique id', () => {
  const ids = G.getFeatures().map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('a long scripted run keeps all numbers finite', () => {
  const s = G.newState(0);
  for (let i = 0; i < 20000; i++) {
    if (i % 4 === 0) G.tap(s);
    G.tick(s, 0.25);
    for (let k = 0; k < G.GENS.length; k++) G.buyGen(s, k);
    for (const u of G.UPGRADES) G.buyUp(s, u.id);
    if (G.canCondense(s) && N.toNumber(G.condenseGain(s)) >= 10) G.condense(s);
  }
  assert.ok(finite(s.dust) && finite(s.run) && finite(s.grains));
  assert.ok(s.gens.every((g) => finite(g.owned)));
});

test('save round trip is stable with all features', () => {
  const s = G.newState(5);
  for (let i = 0; i < 400; i++) {
    G.tap(s);
    G.tick(s, 0.5);
    G.buyGen(s, 0);
  }
  const once = JSON.parse(JSON.stringify(G.toSave(s)));
  const back = G.fromSave(once, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(G.toSave(back))), once);
});

test('garbage feature data in a save does not crash loading', () => {
  const data = JSON.parse(JSON.stringify(G.toSave(G.newState(1))));
  for (const f of G.getFeatures()) data.f[f.id] = { junk: 'x', n: [NaN], deep: { a: null } };
  const s = G.fromSave(data, 1);
  G.tick(s, 1);
  assert.ok(finite(s.dust));
});

test('offline time never produces negative or non-finite dust', () => {
  const s = G.newState(0);
  s.gens[0] = { bought: 10, owned: N.n(10) };
  const r = G.applyOffline(s, 3 * 3600);
  assert.ok(finite(r.gained) && finite(s.dust));
  assert.ok(r.away <= G.OFFLINE_CAP_S);
});
