// Pacing checks. They run the real game with simulated players (tools/sim.mjs).
// Bands are wide on purpose. If a new feature moves a number outside a band, retune the constants
// in game.js (see the Pacing section of README.md) or move the band on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, longestGap, buyScore } from './sim.mjs';
import * as N from '../num.js';

const MIN = 60;
const within = (x, lo, hi, what) => assert.ok(x >= lo && x <= hi, `${what}: ${x.toFixed(1)} is outside ${lo} to ${hi}`);

const memo = new Map();
const cached = (key, make) => {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key);
};
const firstRun = (bot) => cached(bot, () => simulate({ bot, minutes: 20, stopAtFirstCondense: true, patience: 0 }).runs[0]);
const longRuns = (patience) => cached(`long${patience}`, () => simulate({ bot: 'greedy', minutes: 150, maxRuns: 6, patience }).runs);

test('active player: first buy is quick and there is always something to buy', () => {
  for (const bot of ['greedy', 'best']) {
    const r = firstRun(bot);
    assert.ok(r.firstBuy <= 5, `${bot} first buy at ${r.firstBuy}s`);
    assert.ok(r.longestGap10 <= 60, `${bot} waited ${r.longestGap10}s with nothing to buy`);
  }
});

test('active player: condense unlocks at about 5 to 6 minutes and pays at about 8 to 10 minutes', () => {
  for (const bot of ['greedy', 'best']) {
    const r = firstRun(bot);
    within(r.unlockTime, 4.5 * MIN, 6.5 * MIN, `${bot} unlock`);
    within(r.thresholdTime, 7.5 * MIN, 10.5 * MIN, `${bot} threshold`);
    assert.ok(r.unlockTime < r.thresholdTime, 'unlock comes before the threshold');
  }
});

test('collector tiers arrive in order with room between them', () => {
  const t = firstRun('greedy').tierTimes;
  for (let k = 1; k < t.length; k++) {
    assert.ok(t[k] !== null, `tier ${k + 1} was never bought`);
    assert.ok(t[k] - t[k - 1] >= 20, `tier ${k + 1} came ${(t[k] - t[k - 1]).toFixed(0)}s after tier ${k}`);
    assert.ok(t[k] - t[k - 1] <= 4 * MIN, `tier ${k + 1} came too late after tier ${k}`);
  }
});

test('runs 2 to 6 take 4 to 12 minutes whether the player condenses at once or waits', () => {
  for (const patience of [0, 60]) {
    const runs = longRuns(patience);
    assert.ok(runs.length >= 6 && runs[5].end !== null, `patience ${patience}: fewer than 6 runs`);
    runs.slice(1, 6).forEach((r, i) => within(r.duration, 4 * MIN, 12 * MIN, `patience ${patience} run ${i + 2}`));
  }
});

test('payout per run grows over runs 2 to 6 and waiting pays more than condensing at once', () => {
  const quick = longRuns(0);
  const slow = longRuns(60);
  for (const runs of [quick, slow]) {
    const gains = runs.slice(1, 6).map((r) => r.gain);
    for (let i = 1; i < gains.length; i++) assert.ok(gains[i] > gains[i - 1], `gains ${gains.join(' ')}`);
  }
  assert.ok(slow[1].gain > quick[1].gain);
  assert.ok(slow[1].duration > quick[1].duration);
});

test('idle player reaches the first condense within 15 minutes', () => {
  const r = firstRun('idle');
  within(r.thresholdTime, 5 * MIN, 15 * MIN, 'idle threshold');
});

test('longestGap counts the wait before the first buy and ignores buys after the limit', () => {
  assert.equal(longestGap([4, 10, 40, 41], Infinity), 30);
  assert.equal(longestGap([4, 10, 700], 600), 6);
  assert.equal(longestGap([], 600), 0);
});

test('best-buy score prefers a cheap, strong buy over a costly or weak one', () => {
  const income = N.n(1e-100);
  const score = (cost, gain) => buyScore(N.n(cost), income, N.n(gain));
  assert.ok(N.cmp(score(1e-99, 1e-100), score(1e-98, 1e-100)) < 0, 'lower cost wins');
  assert.ok(N.cmp(score(1e-99, 5e-100), score(1e-99, 1e-100)) < 0, 'higher gain wins');
});
