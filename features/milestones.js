import { registerFeature, notify, GENS } from '../game.js';
import { ONE, ZERO, n, make, mul, cmp, gte, toJSON, fromJSON } from '../num.js';
import { LADDER, landmarkTicks, ordersTo } from '../scale.js';

// ---- numbers (all tunable) ------------------------------------------------

// Landmark rewards. Four kinds:
//   global: adds to the shared all-dust bonus (add is a fraction, 0.05 is +5%)
//   tap:    multiplies tap power
//   gen:    multiplies the output of every collector
//   cost:   multiplies the price of collectors (below 1 is a discount)
// Keyed by landmark name from scale.js. A landmark with no entry gives nothing.
export const REWARDS = {
  'a quantum as wide as the universe': { kind: 'global', add: 0.03 },
  'the graviton mass limit': { kind: 'tap', mult: 1.25 },
  'the photon mass limit': { kind: 'cost', mult: 0.97 },
  'a neutrino (upper limit)': { kind: 'gen', mult: 1.1 },
  'a green photon, as mass': { kind: 'global', add: 0.03 },
  'an electron': { kind: 'tap', mult: 1.25 },
  'a proton': { kind: 'global', add: 0.04 },
  'a water molecule': { kind: 'cost', mult: 0.97 },
  'a virus': { kind: 'gen', mult: 1.1 },
  'a human cell': { kind: 'global', add: 0.05 },
  'a grain of sand': { kind: 'tap', mult: 1.25 },
  'a paperclip': { kind: 'cost', mult: 0.96 },
  'a person': { kind: 'gen', mult: 1.1 },
  'the Moon': { kind: 'global', add: 0.08 },
  'the Earth': { kind: 'tap', mult: 1.25 },
  'the Sun': { kind: 'global', add: 0.1 },
  'the Milky Way': { kind: 'gen', mult: 1.15 },
  'the observable universe': { kind: 'global', add: 0.15 },
};

export const ACH_BONUS = 0.01; // global bonus per achievement (fraction)
export const GLOBAL_CAP = 3; // the combined global multiplier from this feature never passes this
export const COST_FLOOR = 0.5; // collector prices never drop below this share
export const FAST_RUN_S = 60; // seconds
export const FASTER_RUN_S = 20;

// ---- landmarks -------------------------------------------------------------

const L = LADDER.length;

// Totals when the first `c` landmarks are reached. Built once so a tick stays cheap.
export const TOTALS = [{ global: 0, tap: ONE, gen: ONE, cost: ONE }];
for (let c = 1; c <= L; c++) {
  const prev = TOTALS[c - 1];
  const t = { ...prev };
  const r = REWARDS[LADDER[c - 1].name];
  if (r?.kind === 'global') t.global = prev.global + r.add;
  else if (r?.kind === 'tap') t.tap = mul(prev.tap, n(r.mult));
  else if (r?.kind === 'gen') t.gen = mul(prev.gen, n(r.mult));
  else if (r?.kind === 'cost') t.cost = mul(prev.cost, n(r.mult));
  TOTALS.push(t);
}

const clampCount = (c) => Math.min(L, Math.max(0, Number.isFinite(c) ? Math.floor(c) : 0));

// How many landmarks a best dust amount has passed. Pure.
export function landmarksPassed(best) {
  let c = 0;
  while (c < L && gte(best, LADDER[c].at)) c++;
  return c;
}

// Combined global multiplier as a plain number, from landmarks and achievements. Capped.
export function globalFactor(count, achievements) {
  const raw = 1 + TOTALS[clampCount(count)].global + Math.max(0, achievements | 0) * ACH_BONUS;
  return Math.min(GLOBAL_CAP, raw);
}

export function rewardText(r) {
  if (!r) return 'No reward.';
  if (r.kind === 'global') return `All dust +${Math.round(r.add * 100)}%.`;
  if (r.kind === 'tap') return `Tap power x${r.mult}.`;
  if (r.kind === 'gen') return `All collectors x${r.mult}.`;
  if (r.kind === 'cost') return `Collectors cost ${Math.round((1 - r.mult) * 100)}% less.`;
  return 'No reward.';
}

// What the Scale panel shows. Reached ones, the next goal, up to two teasers, and a hidden count.
export function ladderView(count) {
  const c = clampCount(count);
  const next = c < L ? c : -1;
  const teasers = [];
  for (let i = c + 1; i < L && teasers.length < 2; i++) teasers.push(i);
  const shown = c + (next >= 0 ? 1 : 0) + teasers.length;
  return { reached: c, next, teasers, hidden: L - shown };
}

// ---- achievements ----------------------------------------------------------

const G10 = n(10);
const G100 = n(100);
const G1000 = n(1000);
const anyBought = (s, min) => s.gens.some((g) => g.bought >= min);

export const ACHIEVEMENTS = [
  { id: 'tap1', name: 'First touch', desc: 'Tap once.', test: (s) => s.taps >= 1 },
  { id: 'tap100', name: 'Fidgety', desc: 'Tap 100 times.', test: (s) => s.taps >= 100 },
  { id: 'tap1k', name: 'Tap dancer', desc: 'Tap 1000 times.', test: (s) => s.taps >= 1000 },
  { id: 'tap10k', name: 'Callused', desc: 'Tap 10000 times.', test: (s) => s.taps >= 10000 },
  ...GENS.map((g, k) => ({
    id: `gen${k}`,
    name: `Owner of ${g.name}`,
    desc: `Buy your first ${g.name}.`,
    test: (s) => s.gens[k]?.bought > 0,
  })),
  { id: 'method1', name: 'Method acting', desc: 'Buy a method.', test: (s) => Object.keys(s.ups).length > 0 },
  { id: 'tenfold', name: 'Tenfold', desc: 'Own 10 of one collector. Its output doubles.', test: (s) => anyBought(s, 10) },
  { id: 'hundredfold', name: 'Hundredfold', desc: 'Own 100 of one collector.', test: (s) => anyBought(s, 100) },
  { id: 'fullhouse', name: 'Full house', desc: 'Own every collector at the same time.', test: (s) => s.gens.every((g) => g.bought > 0) },
  { id: 'condense1', name: 'First squeeze', desc: 'Condense once.', test: (s) => s.condenses >= 1 },
  { id: 'condense10', name: 'Habit', desc: 'Condense 10 times.', test: (s) => s.condenses >= 10 },
  { id: 'grains10', name: 'A pinch', desc: 'Hold 10 grains.', test: (s) => gte(s.grains, G10) },
  { id: 'grains100', name: 'A handful', desc: 'Hold 100 grains.', test: (s) => gte(s.grains, G100) },
  { id: 'grains1000', name: 'A heap', desc: 'Hold 1000 grains.', test: (s) => gte(s.grains, G1000) },
  {
    id: 'fast60',
    name: 'Quick squeeze',
    desc: `Condense in ${FAST_RUN_S} seconds or less.`,
    test: (s, fs) => fs.fast !== null && fs.fast <= FAST_RUN_S,
  },
  {
    id: 'fast20',
    name: 'Flash squeeze',
    desc: `Condense in ${FASTER_RUN_S} seconds or less.`,
    test: (s, fs) => fs.fast !== null && fs.fast <= FASTER_RUN_S,
  },
];
const ACH_IDS = new Set(ACHIEVEMENTS.map((a) => a.id));

// ---- state rules (pure, take the game state) -------------------------------

// Raise lifetime best dust and pay any landmark that was passed. Each landmark pays once
// because `lm` only grows.
export function checkLandmarks(s) {
  const fs = s.f.milestones;
  if (cmp(s.dust, fs.best) > 0) fs.best = s.dust;
  while (fs.lm < L && gte(fs.best, LADDER[fs.lm].at)) {
    const lm = LADDER[fs.lm];
    fs.lm++;
    notify(s, `Landmark: ${lm.name}. ${rewardText(REWARDS[lm.name])}`);
  }
}

export function checkAchievements(s) {
  const fs = s.f.milestones;
  if (fs.achN >= ACHIEVEMENTS.length) return;
  for (const a of ACHIEVEMENTS) {
    if (fs.ach[a.id] || !a.test(s, fs)) continue;
    fs.ach[a.id] = 1;
    fs.achN++;
    notify(s, `Achievement: ${a.name}`);
  }
}

registerFeature({
  id: 'milestones',

  init() {
    return { best: ZERO, lm: 0, ach: {}, achN: 0, runTime: 0, fast: null };
  },

  toSave(fs) {
    return { best: toJSON(fs.best), lm: fs.lm, ach: Object.keys(fs.ach), runTime: fs.runTime, fast: fs.fast };
  },

  fromSave(d) {
    const best = fromJSON(d?.best);
    const ach = {};
    if (Array.isArray(d?.ach)) for (const id of d.ach) if (ACH_IDS.has(id)) ach[id] = 1;
    const time = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);
    // A saved count can never be higher than what the saved best dust has earned.
    const lm = Math.min(clampCount(d?.lm), landmarksPassed(best));
    return { best, lm, ach, achN: Object.keys(ach).length, runTime: time(d?.runTime) ?? 0, fast: time(d?.fast) };
  },

  tick(s, dt) {
    s.f.milestones.runTime += dt;
    checkLandmarks(s);
    checkAchievements(s);
  },

  onCondense(s) {
    const fs = s.f.milestones;
    fs.fast = fs.fast === null ? fs.runTime : Math.min(fs.fast, fs.runTime);
    fs.runTime = 0;
    checkLandmarks(s);
    checkAchievements(s);
  },

  globalMult(s) {
    const fs = s.f.milestones;
    return make(globalFactor(fs.lm, fs.achN), 0);
  },
  tapMult(s) {
    return TOTALS[clampCount(s.f.milestones.lm)].tap;
  },
  genMult(s) {
    return TOTALS[clampCount(s.f.milestones.lm)].gen;
  },
  costMult(s, kind) {
    if (kind !== 'gen') return ONE;
    const c = TOTALS[clampCount(s.f.milestones.lm)].cost;
    return cmp(c, n(COST_FLOOR)) < 0 ? n(COST_FLOOR) : c;
  },

  ui: {
    title: 'Scale',
    order: 20,
    css: `
      #bar { position: relative; }
      .ms-tick { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--muted); opacity: 0.7; z-index: 1; }
      .ms-tick.reached { background: var(--ok); opacity: 1; }
      .ms-goal { background: var(--panel); border: 1px solid var(--accent); border-radius: 12px; padding: 12px 14px; margin-bottom: 8px; }
      .ms-goal .ms-name { font-weight: 600; }
      .ms-goal .ms-far { color: var(--accent); font-variant-numeric: tabular-nums; }
      .ms-small { color: var(--muted); font-size: 13px; }
      .ms-row { display: flex; justify-content: space-between; gap: 12px; padding: 6px 2px; font-size: 14px; border-bottom: 1px solid var(--line); }
      .ms-row.locked { color: var(--muted); }
      .ms-row.unknown { color: var(--muted); letter-spacing: 0.2em; }
      .ms-row .ms-mass { font-variant-numeric: tabular-nums; color: var(--muted); white-space: nowrap; }
      .ms-reward { color: var(--ok); font-size: 13px; }
      details.ms-box { margin-top: 10px; }
      details.ms-box summary { cursor: pointer; color: var(--muted); font-size: 14px; padding: 6px 0; }
      .ms-ach { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; padding-top: 6px; }
      .ms-chip { border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; font-size: 13px; opacity: 0.45; }
      .ms-chip.done { opacity: 1; border-color: var(--ok); }
      .ms-chip .ms-name { font-weight: 600; }
      .ms-chip .ms-desc { color: var(--muted); font-size: 12px; }
    `,
    mount(root, ctx) {
      const doc = root.ownerDocument;
      const mk = (tag, cls, text) => {
        const e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
      };
      const goal = mk('div', 'ms-goal');
      const teasers = mk('div');
      const unknown = mk('div');
      const reached = mk('details', 'ms-box');
      const reachedSum = mk('summary');
      const reachedList = mk('div');
      reached.append(reachedSum, reachedList);
      const ach = mk('details', 'ms-box');
      const achSum = mk('summary');
      const achList = mk('div', 'ms-ach');
      ach.append(achSum, achList);
      root.append(goal, teasers, unknown, reached, ach);

      const chips = ACHIEVEMENTS.map((a) => {
        const c = mk('div', 'ms-chip');
        c.append(mk('div', 'ms-name', a.name), mk('div', 'ms-desc', a.desc));
        achList.append(c);
        return c;
      });

      const bar = doc.getElementById('bar');
      const tickEls = new Map();
      const massText = (lm) => `${ctx.fmt(lm.at, 2)} kg`;
      const row = (lm, cls, withReward) => {
        const r = mk('div', `ms-row ${cls}`);
        const left = mk('span', '', lm.name);
        if (withReward) left.append(mk('div', 'ms-reward', rewardText(REWARDS[lm.name])));
        r.append(left, mk('span', 'ms-mass', massText(lm)));
        return r;
      };

      let drawn = -1;
      let drawnAch = -1;
      let farEl = null;

      const redraw = (count) => {
        const v = ladderView(count);
        goal.replaceChildren();
        farEl = null;
        if (v.next >= 0) {
          const lm = LADDER[v.next];
          farEl = mk('div', 'ms-far');
          goal.append(
            mk('div', 'ms-small', 'Next landmark'),
            mk('div', 'ms-name', `${lm.name}, ${massText(lm)}`),
            farEl,
            mk('div', 'ms-reward', `Reward: ${rewardText(REWARDS[lm.name])}`),
          );
        } else {
          goal.append(mk('div', 'ms-name', 'Every landmark reached.'), mk('div', 'ms-small', 'You hold the mass of the observable universe.'));
        }
        teasers.replaceChildren(...v.teasers.map((i) => row(LADDER[i], 'locked', false)));
        unknown.replaceChildren();
        if (v.hidden > 0) unknown.append(mk('div', 'ms-row unknown', v.hidden === 1 ? '?' : `? (${v.hidden} more)`));
        reachedSum.textContent = `Reached ${v.reached} of ${LADDER.length}`;
        reachedList.replaceChildren(...LADDER.slice(0, v.reached).map((lm) => row(lm, '', true)));
        // Bar ticks for the landmarks the player may see. Others stay secret.
        const visible = new Set([...Array(v.reached).keys(), ...(v.next >= 0 ? [v.next] : []), ...v.teasers]);
        if (bar) {
          for (const t of landmarkTicks()) {
            let el = tickEls.get(t.index);
            if (!visible.has(t.index)) {
              el?.remove();
              tickEls.delete(t.index);
              continue;
            }
            if (!el) {
              el = mk('div', 'ms-tick');
              el.style.left = `${(t.frac * 100).toFixed(2)}%`;
              el.title = t.name;
              bar.append(el);
              tickEls.set(t.index, el);
            }
            el.classList.toggle('reached', t.index < v.reached);
          }
        }
        drawn = count;
      };

      return (s) => {
        const fs = s.f.milestones;
        if (drawn !== fs.lm) redraw(fs.lm);
        if (farEl) {
          const orders = ordersTo(fs.best, LADDER[fs.lm]);
          farEl.textContent = `${orders.toFixed(1)} orders of magnitude to go. Best so far: ${ctx.fmt(fs.best, 2)} kg.`;
        }
        if (drawnAch !== fs.achN) {
          drawnAch = fs.achN;
          achSum.textContent = `Achievements ${fs.achN} of ${ACHIEVEMENTS.length}. Each gives all dust +${Math.round(ACH_BONUS * 100)}%.`;
          ACHIEVEMENTS.forEach((a, i) => chips[i].classList.toggle('done', !!fs.ach[a.id]));
        }
      };
    },
  },
});
