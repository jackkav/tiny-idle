import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../game.js';
import * as N from '../num.js';
import './index.js';
import * as C from './challenges.js';

// Other features change the same numbers (multipliers, costs, speed). These tests check the
// challenges feature alone, so remove the number hooks of every other feature in this process.
for (const f of G.getFeatures()) {
  if (f.id === 'challenges') continue;
  for (const h of ['globalMult', 'genMult', 'tapMult', 'costMult', 'autoTaps', 'speed']) delete f[h];
}

const close = (a, b, msg = '') => assert.ok(
  Math.abs(N.log10(a) - N.log10(b)) < 1e-9,
  `${msg} ${N.fmt(a, 6)} vs ${N.fmt(b, 6)}`,
);
const ratio = (a, b) => N.div(a, b);
const fsOf = (s) => s.f.challenges;
const ids = (list) => list.map((x) => x.id);

// A state that passed the unlock gate. The salt is fixed so offers are the same in every run.
function ready(condenses = 9) {
  const s = G.newState(0);
  s.condenses = condenses;
  s.unlocked.condense = true;
  fsOf(s).salt = 12345;
  return s;
}
const roundTrip = (s) => G.fromSave(JSON.parse(JSON.stringify(G.toSave(s))), 0);
const finish = (s, id) => {
  // Put the run over the goal and let tick notice it.
  s.run = N.scale(C.targetOf(id), 2);
  G.tick(s, 0.1);
};

// ---- the unlock gate ---------------------------------------------------------

test('challenges and focus are locked before the first condense', () => {
  const s = G.newState(0);
  assert.equal(C.enterChallenge(s, 'bare'), false);
  assert.equal(C.pickFocus(s, 'tapper'), false);
  G.tick(s, 1);
  assert.equal(fsOf(s).offer, null);
  assert.match(C.lockReason(s, 'bare'), /Condense once/);
});

test('a challenge with unmet needs cannot start and says why', () => {
  const s = ready(1);
  assert.equal(C.enterChallenge(s, 'slow'), false);
  assert.match(C.lockReason(s, 'slow'), /Needs 3 condenses/);
  const t = ready(9);
  assert.equal(C.enterChallenge(t, 'lonely'), false);
  assert.match(C.lockReason(t, 'lonely'), /Needs 3 challenges done/);
  assert.equal(C.enterChallenge(t, 'nope'), false);
});

// ---- each challenge changes the numbers it claims to ------------------------

test('numb fingers: taps give nothing and one free cling is given', () => {
  const s = ready();
  assert.ok(N.cmp(G.tapValue(s), N.ZERO) > 0);
  assert.ok(C.enterChallenge(s, 'bare'));
  assert.equal(G.tapValue(s).m, 0);
  const before = s.run;
  G.tap(s);
  assert.equal(N.cmp(s.run, before), 0);
  close(s.gens[0].owned, N.n(C.SEED_CLINGS));
  assert.equal(G.autoTaps(s), 0);
  G.tick(s, 1);
  assert.ok(N.cmp(s.run, N.ZERO) > 0, 'the free cling still makes dust');
});

test('short ladder: tiers above the limit make nothing', () => {
  const s = ready();
  const normal = G.genMult(s, C.SHORT_TIERS);
  C.enterChallenge(s, 'short');
  assert.equal(G.genMult(s, C.SHORT_TIERS).m, 0);
  assert.equal(G.genMult(s, G.GENS.length - 1).m, 0);
  close(G.genMult(s, C.SHORT_TIERS - 1), G.genMult(G.newState(0), C.SHORT_TIERS - 1));
  assert.ok(N.cmp(normal, N.ZERO) > 0);
  // A tier 6 collector adds nothing to tier 5 output.
  s.gens[5].owned = N.n(1e6);
  s.gens[4].owned = N.n(10);
  G.tick(s, 10);
  close(s.gens[4].owned, N.n(10));
});

test('steep ladder: each purchase makes the price climb faster', () => {
  const plain = G.newState(0);
  const s = ready();
  C.enterChallenge(s, 'steep');
  for (const bought of [0, 1, 5, 12]) {
    plain.gens[2].bought = bought;
    s.gens[2].bought = bought;
    close(ratio(G.genCost(s, 2), G.genCost(plain, 2)), N.pow(N.n(C.STEEP_GROWTH), bought), `bought ${bought}`);
  }
  // Methods are not affected.
  close(G.upCost(s, 'grip'), G.upCost(plain, 'grip'));
});

test('slow time: game speed is reduced and taps are not', () => {
  const s = ready();
  assert.equal(G.speed(s), 1);
  C.enterChallenge(s, 'slow');
  assert.equal(G.speed(s), C.SLOW_SPEED);
  close(G.tapValue(s), G.tapValue(G.newState(0)));
  s.gens[0].owned = N.n(100);
  const a = G.newState(0);
  a.gens[0].owned = N.n(100);
  G.tick(s, 4);
  G.tick(a, 1);
  close(s.run, a.run);
});

test('bare collectors: methods are out of reach, collectors are not', () => {
  const s = ready();
  s.f.challenges.done = { bare: true, short: true };
  const plain = G.newState(0);
  C.enterChallenge(s, 'nomethods');
  for (const u of G.UPGRADES) assert.ok(N.log10(G.upCost(s, u.id)) > 100, u.id);
  close(G.genCost(s, 0), G.genCost(plain, 0));
  s.dust = N.n(1e-50);
  assert.equal(G.buyUp(s, 'grip'), false);
  assert.equal(G.buyGen(s, 0), true);
});

test('lonely first tier: higher tiers wait for enough tier 1 purchases', () => {
  const s = ready();
  s.f.challenges.done = { bare: true, short: true, steep: true };
  C.enterChallenge(s, 'lonely');
  s.gens[0].bought = C.LONELY_NEEDS - 1;
  assert.equal(G.genMult(s, 1).m, 0);
  assert.equal(G.genMult(s, 5).m, 0);
  assert.ok(G.genMult(s, 0).m > 0, 'tier 1 itself still works');
  s.gens[0].bought = C.LONELY_NEEDS;
  assert.ok(G.genMult(s, 1).m > 0);
  assert.ok(G.genMult(s, 5).m > 0);
});

test('grains are paused inside a challenge and back after it', () => {
  const s = ready();
  s.grains = N.n(500);
  const withGrains = G.globalMult(s);
  assert.ok(N.cmp(withGrains, N.n(500)) > 0);
  C.enterChallenge(s, 'short');
  close(G.globalMult(s), N.ONE);
  C.leaveChallenge(s);
  close(G.globalMult(s), withGrains);
});

// ---- entering, leaving, condensing -------------------------------------------

test('entering a challenge starts a fresh run and keeps grains', () => {
  const s = ready();
  s.grains = N.n(7);
  s.dust = N.n(1e-60);
  s.run = N.n(1e-60);
  s.gens[1] = { bought: 3, owned: N.n(3) };
  s.ups.grip = 2;
  assert.ok(C.enterChallenge(s, 'short'));
  assert.equal(s.dust.m, 0);
  assert.equal(s.run.m, 0);
  assert.equal(s.gens[1].bought, 0);
  assert.deepEqual(s.ups, {});
  assert.equal(N.cmp(s.grains, N.n(7)), 0);
  assert.equal(s.condenses, 9);
  assert.ok(s.notes.some((t) => /Challenge started/.test(t)));
});

test('only one challenge can run at a time', () => {
  const s = ready();
  assert.ok(C.enterChallenge(s, 'short'));
  assert.equal(C.enterChallenge(s, 'bare'), false);
  assert.equal(fsOf(s).active, 'short');
});

test('a challenge run cannot be condensed and pays no grains', () => {
  const s = ready();
  C.enterChallenge(s, 'short');
  s.run = N.n(1e-40);
  assert.equal(N.cmp(G.condenseGain(s), N.ZERO), 0);
  assert.equal(G.canCondense(s), false);
  assert.equal(G.condense(s), false);
  assert.equal(s.condenses, 9);
  C.leaveChallenge(s);
  s.run = N.n(1e-40);
  assert.ok(G.canCondense(s), 'normal rules are back');
});

test('if a condense still happens in a challenge, the challenge ends', () => {
  const s = ready();
  C.enterChallenge(s, 'short');
  const f = G.getFeatures().find((x) => x.id === 'challenges');
  s.condenses += 1;
  f.onCondense(s, N.ZERO);
  assert.equal(fsOf(s).active, null);
  assert.equal(fsOf(s).done.short, undefined);
});

test('leaving restores normal rules and costs nothing but the run', () => {
  const s = ready();
  s.grains = N.n(4);
  const tap = G.tapValue(s);
  const speed = G.speed(s);
  const cost = G.genCost(s, 3);
  C.enterChallenge(s, 'bare');
  C.enterChallenge(s, 'bare');
  assert.ok(C.leaveChallenge(s));
  assert.equal(fsOf(s).active, null);
  assert.equal(C.leaveChallenge(s), false);
  close(G.tapValue(s), tap);
  assert.equal(G.speed(s), speed);
  close(G.genCost(s, 3), cost);
  assert.equal(s.run.m, 0);
  assert.equal(fsOf(s).done.bare, undefined);
  assert.equal(C.lockReason(s, 'bare'), '', 'can try again');
  assert.equal(N.cmp(s.grains, N.n(4)), 0);
});

// ---- completion and rewards --------------------------------------------------

test('completion is noticed in tick and pays once', () => {
  const s = ready();
  C.enterChallenge(s, 'bare');
  G.tick(s, 0.1);
  assert.equal(fsOf(s).active, 'bare', 'not done below the goal');
  const before = G.tapValue(s);
  finish(s, 'bare');
  assert.equal(fsOf(s).active, null);
  assert.equal(fsOf(s).done.bare, true);
  assert.equal(s.run.m, 0, 'a fresh normal run starts');
  assert.ok(s.notes.some((t) => /Challenge done/.test(t)));
  close(ratio(G.tapValue(s), G.tapValue(G.newState(0))), N.n(C.REWARD_TAP_MULT));
  assert.equal(N.cmp(before, N.ZERO), 0);
  // It cannot be entered again, so the reward cannot be paid again.
  assert.equal(C.enterChallenge(s, 'bare'), false);
  s.run = N.scale(C.targetOf('bare'), 5);
  G.tick(s, 0.1);
  close(ratio(G.tapValue(s), G.tapValue(G.newState(0))), N.n(C.REWARD_TAP_MULT));
});

test('every challenge has a reward that matches its text and shows in the numbers', () => {
  const base = G.newState(0);
  const check = {
    bare: (s) => close(ratio(G.tapValue(s), G.tapValue(base)), N.n(C.REWARD_TAP_MULT)),
    short: (s) => close(ratio(G.genMult(s, 2), G.genMult(base, 2)), N.n(C.REWARD_GEN_MULT)),
    steep: (s) => close(ratio(G.genCost(s, 1), G.genCost(base, 1)), N.n(C.REWARD_GEN_COST)),
    slow: (s) => close(ratio(G.globalMult(s), G.globalMult(base)), N.n(C.REWARD_GLOBAL_MULT)),
    nomethods: (s) => close(ratio(G.upCost(s, 'grip'), G.upCost(base, 'grip')), N.n(C.REWARD_UP_COST)),
    lonely: (s) => close(s.gens[0].owned, N.n(C.REWARD_START_CLINGS)),
  };
  assert.deepEqual(Object.keys(check).sort(), ids(C.CHALLENGES).sort());
  for (const c of C.CHALLENGES) {
    // Finish it for real. The other challenges count as done so the needs are met.
    const s = ready();
    s.f.challenges.done = Object.fromEntries(C.CHALLENGES.filter((x) => x.id !== c.id).map((x) => [x.id, true]));
    assert.ok(C.enterChallenge(s, c.id), c.id);
    finish(s, c.id);
    assert.equal(fsOf(s).done[c.id], true, c.id);
    // Then check that this reward alone gives what the text says.
    const only = ready();
    only.f.challenges.done = { [c.id]: true };
    if (c.id === 'lonely') {
      only.run = N.n(1e-60);
      G.condense(only);
      only.grains = N.ZERO;
    }
    check[c.id](only);
  }
});

test('rewards stack and stay after a condense', () => {
  const s = ready(1);
  s.f.challenges.done = { bare: true, short: true };
  const base = G.newState(0);
  const tapBefore = G.tapValue(s);
  s.run = N.n(1e-60);
  assert.ok(G.condense(s));
  assert.equal(s.condenses, 2);
  assert.deepEqual(fsOf(s).done, { bare: true, short: true });
  // tap x10 and collectors x1.5 together. Grains also count now.
  const grainsOnly = N.add(N.ONE, s.grains);
  close(G.tapValue(s), N.mul(N.mul(G.tapValue(base), N.n(C.REWARD_TAP_MULT)), grainsOnly));
  close(
    G.genMult(s, 0),
    N.mul(N.mul(G.genMult(base, 0), N.n(C.REWARD_GEN_MULT)), grainsOnly),
  );
  assert.ok(N.cmp(tapBefore, G.tapValue(base)) > 0);
});

test('the lonely reward gives free clings at every run start, including after a condense', () => {
  const s = ready(5);
  s.f.challenges.done = { lonely: true };
  s.run = N.n(1e-60);
  G.condense(s);
  close(s.gens[0].owned, N.n(C.REWARD_START_CLINGS));
  C.enterChallenge(s, 'bare');
  close(s.gens[0].owned, N.n(C.SEED_CLINGS), 'rewards are paused in a challenge');
  C.leaveChallenge(s);
  close(s.gens[0].owned, N.n(C.REWARD_START_CLINGS));
});

// ---- run focus ---------------------------------------------------------------

test('a condense makes an offer of 3 different focuses', () => {
  const s = ready(0);
  s.run = N.n(1e-60);
  assert.ok(G.condense(s));
  const { offer } = fsOf(s);
  assert.equal(offer.length, C.OFFER_SIZE);
  assert.equal(new Set(offer).size, C.OFFER_SIZE);
  assert.ok(offer.every((id) => C.focusDef(id)));
  assert.equal(fsOf(s).pick, null);
});

test('the offer is a pure function of stored data and varies with the run', () => {
  assert.deepEqual(C.makeOffer(99, 3), C.makeOffer(99, 3));
  const seen = new Set();
  for (let c = 1; c <= 30; c++) seen.add(C.makeOffer(99, c).offer.join());
  assert.ok(seen.size > 5, 'offers differ between runs');
  const seenIds = new Set();
  for (let salt = 0; salt < 200; salt++) for (const id of C.makeOffer(salt, 1).offer) seenIds.add(id);
  assert.equal(seenIds.size, C.FOCUSES.length, 'every focus can be offered');
});

test('offer, pick and gamble survive save and load, and a reload cannot reroll', () => {
  const s = ready(0);
  s.run = N.n(1e-60);
  G.condense(s);
  const offer = [...fsOf(s).offer];
  const roll = fsOf(s).roll;
  assert.ok(C.pickFocus(s, offer[1]));
  for (let i = 0; i < 5; i++) {
    const back = roundTrip(s);
    G.tick(back, 0.1);
    assert.deepEqual(fsOf(back).offer, offer);
    assert.equal(fsOf(back).pick, offer[1]);
    assert.equal(fsOf(back).roll, roll);
  }
  // Without a pick, many reloads give the same offer and the same pick chance.
  const t = ready(0);
  t.run = N.n(1e-60);
  G.condense(t);
  const first = [...fsOf(t).offer];
  for (let i = 0; i < 5; i++) {
    const back = roundTrip(t);
    G.tick(back, 0.1);
    assert.deepEqual(fsOf(back).offer, first);
  }
});

test('a lost offer is rebuilt from stored data to the same offer', () => {
  const s = ready(0);
  s.run = N.n(1e-60);
  G.condense(s);
  const offer = [...fsOf(s).offer];
  const data = JSON.parse(JSON.stringify(G.toSave(s)));
  data.f.challenges.offer = ['x', 'y'];
  const back = G.fromSave(data, 0);
  G.tick(back, 0.1);
  assert.deepEqual(fsOf(back).offer, offer);
});

test('a save from before this feature with condenses gets an offer', () => {
  const s = ready(4);
  const data = JSON.parse(JSON.stringify(G.toSave(s)));
  delete data.f.challenges;
  const back = G.fromSave(data, 0);
  assert.equal(fsOf(back).offer, null);
  G.tick(back, 0.1);
  assert.equal(fsOf(back).offer.length, C.OFFER_SIZE);
});

test('a focus can be picked once, only from the offer, and not in a challenge', () => {
  const s = ready(0);
  s.run = N.n(1e-60);
  G.condense(s);
  const [a, b] = fsOf(s).offer;
  const other = C.FOCUSES.find((f) => !fsOf(s).offer.includes(f.id)).id;
  assert.equal(C.pickFocus(s, other), false);
  C.enterChallenge(s, 'bare');
  assert.equal(C.pickFocus(s, a), false);
  C.leaveChallenge(s);
  assert.ok(C.pickFocus(s, a));
  assert.equal(C.pickFocus(s, b), false);
  assert.equal(fsOf(s).pick, a);
});

test('the offer resets in the next condense', () => {
  const s = ready(0);
  s.run = N.n(1e-60);
  G.condense(s);
  C.pickFocus(s, fsOf(s).offer[0]);
  s.run = N.mul(G.condenseAt(s), N.n(1e3)); // the threshold rises with grains
  G.condense(s);
  assert.equal(fsOf(s).pick, null);
  assert.equal(fsOf(s).offerRun, 2);
  assert.deepEqual(fsOf(s).offer, C.makeOffer(fsOf(s).salt, 2).offer);
});

// Give a state a chosen focus, bypassing the dice.
const withFocus = (id) => {
  const s = ready(1);
  fsOf(s).offer = [id, ...C.FOCUSES.map((f) => f.id).filter((x) => x !== id).slice(0, 2)];
  fsOf(s).offerRun = s.condenses;
  assert.ok(C.pickFocus(s, id));
  return s;
};

test('each focus changes the numbers it claims to', () => {
  const base = G.newState(0);
  let s = withFocus('tapper');
  close(ratio(G.tapValue(s), G.tapValue(base)), N.n(C.FOCUS_TAPPER.tap));
  close(ratio(G.genMult(s, 0), G.genMult(base, 0)), N.n(C.FOCUS_TAPPER.gen));

  s = withFocus('swarm');
  assert.equal(G.tapValue(s).m, 0);
  close(ratio(G.genMult(s, 2), G.genMult(base, 2)), N.n(C.FOCUS_SWARM.gen));

  s = withFocus('thrifty');
  close(ratio(G.upCost(s, 'grip'), G.upCost(base, 'grip')), N.n(C.FOCUS_THRIFTY.upCost));
  close(ratio(G.genCost(s, 1), G.genCost(base, 1)), N.n(C.FOCUS_THRIFTY.genCost));

  s = withFocus('shallow');
  close(ratio(G.genMult(s, 0), G.genMult(base, 0)), N.n(C.FOCUS_SHALLOW.first));
  close(ratio(G.genMult(s, 3), G.genMult(base, 3)), N.n(C.FOCUS_SHALLOW.rest));

  s = withFocus('deep');
  close(ratio(G.genMult(s, 1), G.genMult(base, 1)), N.n(C.FOCUS_DEEP.low));
  close(ratio(G.genMult(s, 4), G.genMult(base, 4)), N.n(C.FOCUS_DEEP.high));

  s = withFocus('autopilot');
  assert.equal(G.autoTaps(s), C.FOCUS_AUTOPILOT.auto);
  close(ratio(G.genCost(s, 0), G.genCost(base, 0)), N.n(C.FOCUS_AUTOPILOT.genCost));
});

test('slow burn: weak at first, strong after the set time, and the clock resets each run', () => {
  const base = G.newState(0);
  const s = withFocus('burn');
  close(ratio(G.globalMult(s), G.globalMult(base)), N.n(C.FOCUS_SLOW_BURN.early));
  for (let i = 0; i < C.FOCUS_SLOW_BURN.seconds + 1; i++) G.tick(s, 1);
  close(ratio(G.globalMult(s), G.globalMult(base)), N.n(C.FOCUS_SLOW_BURN.late));
  s.run = N.n(1e-60);
  G.condense(s);
  assert.equal(fsOf(s).runTime, 0);
});

test('slow burn does not run its clock inside a challenge', () => {
  const s = withFocus('burn');
  C.enterChallenge(s, 'bare');
  for (let i = 0; i < 100; i++) G.tick(s, 1);
  assert.equal(fsOf(s).runTime, 0);
  C.leaveChallenge(s);
  assert.equal(fsOf(s).runTime, 0);
});

test('gamble outcome is fixed by the stored roll and kept across a reload', () => {
  const base = G.newState(0);
  for (const [roll, win] of [[0, true], [C.FOCUS_GAMBLE.chance - 0.001, true], [C.FOCUS_GAMBLE.chance, false], [0.99, false]]) {
    const s = ready(1);
    fsOf(s).offer = ['gamble', 'tapper', 'swarm'];
    fsOf(s).offerRun = 1;
    fsOf(s).roll = roll;
    assert.ok(C.pickFocus(s, 'gamble'));
    assert.equal(fsOf(s).gamble, win);
    const want = N.n(win ? C.FOCUS_GAMBLE.win : C.FOCUS_GAMBLE.lose);
    close(ratio(G.globalMult(s), G.globalMult(base)), want);
    const back = roundTrip(s);
    G.tick(back, 0.1);
    close(ratio(G.globalMult(back), G.globalMult(base)), want, 'after reload');
  }
});

test('a focus is paused in a challenge and returns after it', () => {
  const base = G.newState(0);
  const s = withFocus('tapper');
  C.enterChallenge(s, 'short');
  close(G.tapValue(s), G.tapValue(base));
  C.leaveChallenge(s);
  close(ratio(G.tapValue(s), G.tapValue(base)), N.n(C.FOCUS_TAPPER.tap));
});

// ---- save safety -------------------------------------------------------------

test('a challenge in progress survives save and load', () => {
  const s = ready();
  C.enterChallenge(s, 'short');
  G.tick(s, 5);
  const back = roundTrip(s);
  assert.equal(fsOf(back).active, 'short');
  assert.equal(G.genMult(back, 4).m, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(G.toSave(back))), JSON.parse(JSON.stringify(G.toSave(s))));
});

test('garbage feature data is safe', () => {
  const junk = [
    null, 7, 'x', [], { active: 'nope', done: { bare: 1, zzz: true, short: 'true' }, offer: 'abc', pick: {}, roll: 'q', salt: NaN, runTime: -5 },
    { active: 'bare', done: { bare: true } },
    { offer: ['a', 'a', 'a'], pick: 'tapper' },
    { offer: ['tapper', 'swarm', 'gamble'], pick: 'burn', gamble: true, roll: 99 },
  ];
  for (const bad of junk) {
    const s = G.newState(0);
    s.condenses = 3;
    const data = JSON.parse(JSON.stringify(G.toSave(s)));
    data.f.challenges = bad;
    const back = G.fromSave(data, 0);
    G.tick(back, 1);
    G.tap(back);
    const fs = fsOf(back);
    assert.ok(Number.isFinite(back.dust.m) && Number.isFinite(back.dust.e));
    assert.ok(fs.active === null || (C.challengeDef(fs.active) && !fs.done[fs.active]));
    assert.ok(Object.keys(fs.done).every((id) => C.challengeDef(id) && fs.done[id] === true));
    assert.ok(fs.pick === null || fs.offer.includes(fs.pick));
    assert.ok(fs.roll >= 0 && fs.roll <= 1 && fs.runTime >= 0);
    assert.equal(fs.offer.length, C.OFFER_SIZE);
  }
});

test('a save with a pick of gamble but no stored win is a loss, not a crash', () => {
  const s = ready(1);
  const data = JSON.parse(JSON.stringify(G.toSave(s)));
  data.f.challenges = { offer: ['gamble', 'tapper', 'swarm'], offerRun: 1, pick: 'gamble', roll: 0.1 };
  const back = G.fromSave(data, 0);
  assert.equal(fsOf(back).gamble, false);
  assert.ok(Number.isFinite(N.log10(G.globalMult(back))));
});

// ---- the goals are winnable --------------------------------------------------

// A simple bot: tap a little and always buy the cheapest thing it can afford.
function bot(s, tapsPerSecond, seconds, stop) {
  let acc = 0;
  for (let t = 0; t < seconds && !stop(); t += 0.25) {
    acc += tapsPerSecond * 0.25;
    while (acc >= 1) {
      G.tap(s);
      acc -= 1;
    }
    G.tick(s, 0.25);
    for (let guard = 0; guard < 50; guard++) {
      let best = null;
      let bestCost = null;
      for (let k = 0; k < G.GENS.length; k++) {
        const c = G.genCost(s, k);
        if (N.cmp(c, s.dust) <= 0 && (!bestCost || N.cmp(c, bestCost) < 0)) [best, bestCost] = [() => G.buyGen(s, k), c];
      }
      for (const u of G.UPGRADES) {
        if (!G.upAvailable(s, u.id)) continue;
        const c = G.upCost(s, u.id);
        if (N.cmp(c, s.dust) <= 0 && (!bestCost || N.cmp(c, bestCost) < 0)) [best, bestCost] = [() => G.buyUp(s, u.id), c];
      }
      if (!best) break;
      best();
    }
  }
}

test('a plain bot can finish every challenge within the time limit', () => {
  const LIMIT_SECONDS = 20 * 60;
  for (const c of C.CHALLENGES) {
    const s = ready();
    s.f.challenges.done = Object.fromEntries(C.CHALLENGES.filter((x) => x.id !== c.id).map((x) => [x.id, true]));
    assert.ok(C.enterChallenge(s, c.id), c.id);
    bot(s, 3, LIMIT_SECONDS, () => fsOf(s).done[c.id]);
    assert.equal(fsOf(s).done[c.id], true, `${c.id} not finished in ${LIMIT_SECONDS} s`);
  }
});
