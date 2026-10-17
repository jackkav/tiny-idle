// Pure game logic. No DOM, so the browser UI and the tests share the same code.
import {
  ZERO, ONE, n, add, sub, mul, div, pow, scale, cmp, gte, floor, log10, toJSON, fromJSON,
} from './num.js';

// One tap is worth 0.01e-99 kg. Everything else is priced in taps.
export const TAP = n(1e-101);
const taps = (x) => mul(n(x), TAP);

// Each collector makes the collector one tier below it. Tier 1 makes dust.
export const GENS = [
  { id: 'cling', name: 'Static cling', blurb: 'Dust sticks to dust.', base: 10, growth: 1.4 },
  { id: 'draft', name: 'Draft', blurb: 'A faint push of air.', base: 300, growth: 2.25 },
  { id: 'eddy', name: 'Eddy', blurb: 'Air that turns back on itself.', base: 1e4, growth: 2.5 },
  { id: 'whirl', name: 'Whirl', blurb: 'A small, patient storm.', base: 3e5, growth: 2.75 },
  { id: 'cyclone', name: 'Cyclone', blurb: 'The room gets involved.', base: 1e7, growth: 3 },
  { id: 'jet', name: 'Jet stream', blurb: 'The planet gets involved.', base: 3e8, growth: 3.25 },
];

// Every 10 purchases of a collector doubles its output, up to 10 doublings.
export const MILESTONE = 10;
export const MILESTONE_MAX = 10;

export const UPGRADES = [
  { id: 'grip', name: 'Stickier finger', desc: 'Tap power x2 per level.', base: 25, growth: 5, max: 40 },
  { id: 'twitch', name: 'Twitchy finger', desc: 'Taps once per second by itself.', base: 400, growth: 1 },
  { id: 'hummer', name: 'Hummingbird', desc: 'Taps 10 times per second by itself.', base: 2e5, growth: 1, requires: 'twitch' },
  { id: 'surge1', name: 'Static charge', desc: 'All dust x2.', base: 5e3, growth: 1 },
  { id: 'surge2', name: 'Magnetism', desc: 'All dust x3.', base: 5e7, growth: 1, requires: 'surge1' },
  { id: 'surge3', name: 'Gravity well', desc: 'All dust x4.', base: 1e13, growth: 1, requires: 'surge2' },
  { id: 'surge4', name: 'Tidal lock', desc: 'All dust x5.', base: 1e20, growth: 1, requires: 'surge3' },
];
const SURGE = { surge1: 2, surge2: 3, surge3: 4, surge4: 5 };

// Condensation turns a run's dust into grains. Grains survive a reset.
// One grain per factor of ten the run beat the threshold by.
export const CONDENSE_AT = n(1e-70);
export const METHODS_TO_UNLOCK = 8;

export function newState(now = Date.now()) {
  return {
    dust: ZERO,
    run: ZERO, // dust gathered since the last condensation
    gens: GENS.map(() => ({ bought: 0, owned: ZERO })),
    ups: {},
    grains: ZERO,
    condenses: 0,
    taps: 0,
    unlocked: { condense: false },
    savedAt: now,
  };
}

const upDef = (id) => UPGRADES.find((u) => u.id === id);
export const upLevel = (s, id) => s.ups[id] ?? 0;

// ---- Multipliers -----------------------------------------------------------

export const grainMult = (s) => add(ONE, s.grains);

export function globalMult(s) {
  let m = grainMult(s);
  for (const [id, x] of Object.entries(SURGE)) if (upLevel(s, id) > 0) m = scale(m, x);
  return m;
}

export const genMult = (s, k) =>
  mul(globalMult(s), pow(n(2), Math.min(MILESTONE_MAX, Math.floor(s.gens[k].bought / MILESTONE))));

export const tapValue = (s) => mul(scale(TAP, 2 ** upLevel(s, 'grip')), globalMult(s));

export function autoTaps(s) {
  if (upLevel(s, 'hummer') > 0) return 10;
  return upLevel(s, 'twitch') > 0 ? 1 : 0;
}

export function dustPerSecond(s) {
  const fromGens = mul(mul(s.gens[0].owned, genMult(s, 0)), TAP);
  return add(fromGens, scale(tapValue(s), autoTaps(s)));
}

// ---- Actions ---------------------------------------------------------------

function gain(s, amount) {
  s.dust = add(s.dust, amount);
  s.run = add(s.run, amount);
}

export function tap(s) {
  const v = tapValue(s);
  gain(s, v);
  s.taps += 1;
  return v;
}

export function tick(s, dt) {
  gain(s, scale(mul(mul(s.gens[0].owned, genMult(s, 0)), TAP), dt));
  for (let k = 1; k < GENS.length; k++) {
    const made = scale(mul(s.gens[k].owned, genMult(s, k)), dt);
    s.gens[k - 1].owned = add(s.gens[k - 1].owned, made);
  }
  const auto = autoTaps(s);
  if (auto > 0) gain(s, scale(tapValue(s), auto * dt));
  checkUnlocks(s);
}

// Run a long span in coarse steps. Coarse steps under-count a little, never over-count.
export function advance(s, seconds, maxSteps = 20000) {
  if (!(seconds > 0)) return;
  const steps = Math.min(maxSteps, Math.ceil(seconds / 0.25));
  const dt = seconds / steps;
  for (let i = 0; i < steps; i++) tick(s, dt);
}

export const genCost = (s, k) => mul(taps(GENS[k].base), pow(n(GENS[k].growth), s.gens[k].bought));

export function buyGen(s, k) {
  const cost = genCost(s, k);
  if (cmp(s.dust, cost) < 0) return false;
  s.dust = sub(s.dust, cost);
  s.gens[k].bought += 1;
  s.gens[k].owned = add(s.gens[k].owned, ONE);
  return true;
}

export function buyGenMax(s, k) {
  let count = 0;
  while (count < 1000 && buyGen(s, k)) count++;
  return count;
}

export function upCost(s, id) {
  const d = upDef(id);
  return mul(taps(d.base), pow(n(d.growth), upLevel(s, id)));
}

export function upAvailable(s, id) {
  const d = upDef(id);
  if (upLevel(s, id) >= (d.max ?? 1)) return false;
  return !d.requires || upLevel(s, d.requires) > 0;
}

export function buyUp(s, id) {
  if (!upAvailable(s, id)) return false;
  const cost = upCost(s, id);
  if (cmp(s.dust, cost) < 0) return false;
  s.dust = sub(s.dust, cost);
  s.ups[id] = upLevel(s, id) + 1;
  return true;
}

// ---- Unlocks and condensation ----------------------------------------------

// Distinct ways of speeding up collection that the player owns right now.
export function methodsOwned(s) {
  return s.gens.filter((g) => g.bought > 0).length + Object.values(s.ups).filter((l) => l > 0).length;
}

export function checkUnlocks(s) {
  if (!s.unlocked.condense && methodsOwned(s) >= METHODS_TO_UNLOCK) {
    s.unlocked.condense = true;
    return 'condense';
  }
  return null;
}

// Grains for condensing now: how many orders of magnitude the run is above the threshold.
export function condenseGain(s) {
  if (cmp(s.run, CONDENSE_AT) < 0) return ZERO;
  return floor(n(log10(div(s.run, CONDENSE_AT))));
}

export const canCondense = (s) => s.unlocked.condense && gte(condenseGain(s), ONE);

export function condense(s) {
  if (!canCondense(s)) return false;
  s.grains = add(s.grains, condenseGain(s));
  s.dust = ZERO;
  s.run = ZERO;
  s.gens = GENS.map(() => ({ bought: 0, owned: ZERO }));
  s.ups = {};
  s.condenses += 1;
  return true;
}

// ---- Save and load ---------------------------------------------------------

export function toSave(s) {
  return {
    v: 1,
    dust: toJSON(s.dust),
    run: toJSON(s.run),
    gens: s.gens.map((g) => ({ bought: g.bought, owned: toJSON(g.owned) })),
    ups: s.ups,
    grains: toJSON(s.grains),
    condenses: s.condenses,
    taps: s.taps,
    unlocked: s.unlocked,
    savedAt: s.savedAt,
  };
}

export function fromSave(data, now = Date.now()) {
  const s = newState(now);
  if (!data || data.v !== 1) return s;
  s.dust = fromJSON(data.dust);
  s.run = fromJSON(data.run);
  GENS.forEach((_, k) => {
    const g = data.gens?.[k];
    if (g) s.gens[k] = { bought: Math.max(0, g.bought | 0), owned: fromJSON(g.owned) };
  });
  for (const u of UPGRADES) {
    const lvl = data.ups?.[u.id] | 0;
    if (lvl > 0) s.ups[u.id] = Math.min(lvl, u.max ?? 1);
  }
  s.grains = fromJSON(data.grains);
  s.condenses = data.condenses | 0;
  s.taps = data.taps | 0;
  s.unlocked = { condense: !!data.unlocked?.condense };
  s.savedAt = Number.isFinite(data.savedAt) ? data.savedAt : now;
  return s;
}
