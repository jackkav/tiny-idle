import * as G from '../game.js';
import * as N from '../num.js';

// Challenges and run focus.
//
// Challenge rules (also shown to the player in the UI text):
// - A challenge is a fresh run with one rule bent. Your current run is lost. Grains stay.
// - Inside a challenge only that one rule applies. Grains, run focus and challenge rewards are paused.
// - Condensing is off inside a challenge. A challenge pays no grains.
// - Reach the goal in one run and the reward is yours for good. It pays once.
// - You can leave at any time. Leaving costs nothing but the run you were in.
//
// Run focus: after each condense you are offered 3 focus modifiers. You may pick one for this run.
// The offer is stored in the save and comes from stored data, so a reload cannot change it.
//
// Every number is a named constant so the economy can be rebalanced without touching the rules.

export const UNLOCK_AFTER_CONDENSES = 1;

// ---- challenge numbers -----------------------------------------------------
export const STEEP_GROWTH = 1.3; // extra price growth per collector bought
export const SLOW_SPEED = 0.25; // game speed in the slow challenge
export const SHORT_TIERS = 3; // collector tiers that work in the short ladder challenge
export const LONELY_NEEDS = 15; // tier 1 collectors you must have bought before higher tiers work
export const OUT_OF_REACH_EXP = 200; // methods cost x1e200 in the no methods challenge
export const SEED_CLINGS = 1; // free tier 1 collectors when a challenge cannot start from taps

// Goals: dust gathered in one run, in kg.
export const TARGETS = {
  bare: N.n(1e-86),
  short: N.n(1e-90),
  steep: N.n(1e-88),
  slow: N.n(1e-96),
  nomethods: N.n(1e-90),
  lonely: N.n(1e-90),
};

// Rewards.
export const REWARD_TAP_MULT = 10; // numb fingers
export const REWARD_GEN_MULT = 1.5; // short ladder
export const REWARD_GEN_COST = 0.8; // steep ladder
export const REWARD_GLOBAL_MULT = 1.5; // slow time
export const REWARD_UP_COST = 0.5; // no methods
export const REWARD_START_CLINGS = 20; // lonely first tier

// ---- run focus numbers -----------------------------------------------------
export const OFFER_SIZE = 3;
export const FOCUS_TAPPER = { tap: 10, gen: 0.5 };
export const FOCUS_SWARM = { gen: 3, tap: 0 };
export const FOCUS_THRIFTY = { upCost: 0.5, genCost: 2 };
export const FOCUS_SHALLOW = { first: 5, rest: 0.25 };
export const FOCUS_DEEP = { high: 4, low: 0.5, fromTier: 3 };
export const FOCUS_AUTOPILOT = { auto: 3, genCost: 1.25 };
export const FOCUS_SLOW_BURN = { seconds: 20, early: 0.3, late: 4 };
export const FOCUS_GAMBLE = { chance: 0.35, win: 6, lose: 0.4 };

const num = (x) => (typeof x === 'number' ? N.n(x) : x);
const val = (x, s, fs) => (typeof x === 'function' ? x(s, fs) : x);

// A mod is a plain object. All fields are optional.
//   tap: number          tap value x
//   global: number | fn  all dust x
//   gen: number          all collector output x
//   genBy: fn(k, s)      collector output x for tier k
//   cost: { gen, up }    price x (number or Num)
//   steep: number        collector price x this ^ (collectors bought of that tier)
//   speed: number        game speed x
//   auto: number         extra automatic taps per second
//   startClings: number  free tier 1 collectors at the start of a run
export const CHALLENGES = [
  {
    id: 'bare',
    name: 'Numb fingers',
    rule: `Taps give no dust. You start with ${SEED_CLINGS} free Static cling.`,
    mod: { tap: 0 },
    seed: SEED_CLINGS,
    needs: { condenses: 1, done: 0 },
    reward: { tap: REWARD_TAP_MULT },
    rewardText: `Tap power x${REWARD_TAP_MULT}, for good.`,
  },
  {
    id: 'short',
    name: 'Short ladder',
    rule: `Only the first ${SHORT_TIERS} collector tiers make anything.`,
    mod: { genBy: (k) => (k >= SHORT_TIERS ? 0 : 1) },
    needs: { condenses: 1, done: 0 },
    reward: { gen: REWARD_GEN_MULT },
    rewardText: `All collectors make x${REWARD_GEN_MULT} more, for good.`,
  },
  {
    id: 'steep',
    name: 'Steep ladder',
    rule: `Each collector you buy makes the next one of its tier x${STEEP_GROWTH} dearer, on top of the normal rise.`,
    mod: { steep: STEEP_GROWTH },
    needs: { condenses: 2, done: 0 },
    reward: { cost: { gen: REWARD_GEN_COST } },
    rewardText: `Collectors cost x${REWARD_GEN_COST}, for good.`,
  },
  {
    id: 'slow',
    name: 'Slow time',
    rule: `The game runs at x${SLOW_SPEED} speed.`,
    mod: { speed: SLOW_SPEED },
    needs: { condenses: 3, done: 0 },
    reward: { global: REWARD_GLOBAL_MULT },
    rewardText: `All dust x${REWARD_GLOBAL_MULT}, for good.`,
  },
  {
    id: 'nomethods',
    name: 'Bare collectors',
    rule: 'Methods cost far too much to buy. Only collectors and taps work.',
    mod: { cost: { up: N.make(1, OUT_OF_REACH_EXP) } },
    needs: { condenses: 3, done: 2 },
    reward: { cost: { up: REWARD_UP_COST } },
    rewardText: `Methods cost x${REWARD_UP_COST}, for good.`,
  },
  {
    id: 'lonely',
    name: 'Lonely first tier',
    rule: `Collectors above tier 1 make nothing until you have bought ${LONELY_NEEDS} of tier 1.`,
    mod: { genBy: (k, s) => (k >= 1 && s.gens[0].bought < LONELY_NEEDS ? 0 : 1) },
    needs: { condenses: 5, done: 3 },
    reward: { startClings: REWARD_START_CLINGS },
    rewardText: `Every run starts with ${REWARD_START_CLINGS} free Static clings.`,
  },
];

export const targetOf = (id) => TARGETS[id];
export const challengeDef = (id) => CHALLENGES.find((c) => c.id === id);

export const FOCUSES = [
  {
    id: 'tapper',
    name: 'Heavy hands',
    desc: `Taps x${FOCUS_TAPPER.tap}. Collectors x${FOCUS_TAPPER.gen}.`,
    mod: { tap: FOCUS_TAPPER.tap, gen: FOCUS_TAPPER.gen },
  },
  {
    id: 'swarm',
    name: 'Swarm',
    desc: `Collectors x${FOCUS_SWARM.gen}. Taps give nothing.`,
    mod: { gen: FOCUS_SWARM.gen, tap: FOCUS_SWARM.tap },
  },
  {
    id: 'thrifty',
    name: 'Thrifty tinkerer',
    desc: `Methods cost x${FOCUS_THRIFTY.upCost}. Collectors cost x${FOCUS_THRIFTY.genCost}.`,
    mod: { cost: { up: FOCUS_THRIFTY.upCost, gen: FOCUS_THRIFTY.genCost } },
  },
  {
    id: 'shallow',
    name: 'Shallow',
    desc: `Tier 1 collectors x${FOCUS_SHALLOW.first}. Higher tiers x${FOCUS_SHALLOW.rest}.`,
    mod: { genBy: (k) => (k === 0 ? FOCUS_SHALLOW.first : FOCUS_SHALLOW.rest) },
  },
  {
    id: 'deep',
    name: 'Deep',
    desc: `Tiers ${FOCUS_DEEP.fromTier + 1} and up x${FOCUS_DEEP.high}. Lower tiers x${FOCUS_DEEP.low}.`,
    mod: { genBy: (k) => (k >= FOCUS_DEEP.fromTier ? FOCUS_DEEP.high : FOCUS_DEEP.low) },
  },
  {
    id: 'autopilot',
    name: 'Autopilot',
    desc: `${FOCUS_AUTOPILOT.auto} free taps per second. Collectors cost x${FOCUS_AUTOPILOT.genCost}.`,
    mod: { auto: FOCUS_AUTOPILOT.auto, cost: { gen: FOCUS_AUTOPILOT.genCost } },
  },
  {
    id: 'burn',
    name: 'Slow burn',
    desc: `All dust x${FOCUS_SLOW_BURN.early} for ${FOCUS_SLOW_BURN.seconds} seconds, then x${FOCUS_SLOW_BURN.late} for the rest of the run.`,
    mod: { global: (s, fs) => (fs.runTime < FOCUS_SLOW_BURN.seconds ? FOCUS_SLOW_BURN.early : FOCUS_SLOW_BURN.late) },
  },
  {
    id: 'gamble',
    name: 'Gamble',
    desc: `${Math.round(FOCUS_GAMBLE.chance * 100)} percent chance of all dust x${FOCUS_GAMBLE.win}. Otherwise all dust x${FOCUS_GAMBLE.lose}. Settled when you pick it.`,
    // The outcome is stored in fs.gamble when the focus is picked.
    mod: { global: (s, fs) => (fs.gamble ? FOCUS_GAMBLE.win : FOCUS_GAMBLE.lose) },
  },
];
export const focusDef = (id) => FOCUSES.find((f) => f.id === id);

// ---- state -----------------------------------------------------------------

const freshState = (salt) => ({
  salt, // fixed per save. Keeps offers different between players but stable for one player.
  offer: null, // focus ids offered for this run, or null
  offerRun: 0, // value of s.condenses when the offer was made
  nonce: 0, // counts offers made, so a compaction does not replay old offers
  roll: 0, // stored random number for the gamble focus
  pick: null, // picked focus id, or null
  gamble: false, // outcome of the gamble, settled at pick time
  runTime: 0, // seconds in this run, for the slow burn focus
  active: null, // id of the running challenge, or null
  done: {}, // id -> true
});

const randomSalt = () => Math.floor(Math.random() * 2 ** 31);

// Small seeded generator. The same seed gives the same numbers.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The offer depends only on stored data: the salt and the offer counter.
export function makeOffer(salt, index) {
  const next = rng((salt >>> 0) ^ Math.imul(index + 1, 0x9e3779b1));
  const ids = FOCUSES.map((f) => f.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return { offer: ids.slice(0, OFFER_SIZE), roll: next() };
}

const fsOf = (s) => s.f.challenges;
export const isUnlocked = (s) => s.condenses >= UNLOCK_AFTER_CONDENSES;
export const doneCount = (fs) => CHALLENGES.filter((c) => fs.done[c.id]).length;

// `again` rebuilds the offer of the current run from stored data (a damaged save). It does not use
// a new offer index.
function newOffer(s, again = false) {
  const fs = fsOf(s);
  const index = again ? Math.max(0, fs.nonce - 1) : fs.nonce++;
  const { offer, roll } = makeOffer(fs.salt, index);
  fs.offer = offer;
  fs.roll = roll;
  fs.offerRun = s.condenses;
  fs.pick = null;
  fs.gamble = false;
  fs.runTime = 0;
}

// Why a challenge cannot start now. Empty string when it can.
export function lockReason(s, id) {
  const c = challengeDef(id);
  if (!c) return 'Unknown challenge.';
  const fs = fsOf(s);
  if (!isUnlocked(s)) return 'Condense once to unlock challenges.';
  if (fs.done[id]) return 'Done.';
  if (s.condenses < c.needs.condenses) return `Needs ${c.needs.condenses} condenses. You have ${s.condenses}.`;
  if (doneCount(fs) < c.needs.done) return `Needs ${c.needs.done} challenges done. You have ${doneCount(fs)}.`;
  return '';
}

// ---- rules -----------------------------------------------------------------

// The mods that apply right now.
// In a challenge only the challenge rule applies. Otherwise rewards and the picked focus apply.
export function activeMods(s) {
  const fs = fsOf(s);
  if (fs.active) return [challengeDef(fs.active).mod];
  const out = [];
  for (const c of CHALLENGES) if (fs.done[c.id]) out.push(c.reward);
  if (fs.pick) out.push(focusDef(fs.pick).mod);
  return out;
}

const product = (s, pick) => {
  let m = N.ONE;
  for (const mod of activeMods(s)) {
    const x = pick(mod);
    if (x !== undefined) m = N.mul(m, num(x));
  }
  return m;
};

export function globalMultOf(s) {
  const fs = fsOf(s);
  const m = product(s, (mod) => (mod.global === undefined ? undefined : val(mod.global, s, fs)));
  // Grains are paused in a challenge.
  return fs.active ? N.mul(m, N.div(N.ONE, G.grainMult(s))) : m;
}
export const genMultOf = (s, k) =>
  product(s, (mod) => {
    if (mod.gen === undefined && mod.genBy === undefined) return undefined;
    return (mod.gen ?? 1) * (mod.genBy ? mod.genBy(k, s) : 1);
  });
export const tapMultOf = (s) => product(s, (mod) => mod.tap);
export const speedOf = (s) => activeMods(s).reduce((a, mod) => a * (mod.speed ?? 1), 1);
export const autoTapsOf = (s) => activeMods(s).reduce((a, mod) => a + (mod.auto ?? 0), 0);
export function costMultOf(s, kind, index) {
  let m = product(s, (mod) => mod.cost?.[kind]);
  if (kind === 'gen') {
    for (const mod of activeMods(s)) if (mod.steep) m = N.mul(m, N.pow(N.n(mod.steep), s.gens[index].bought));
  }
  return m;
}
export function startClingsOf(s) {
  const fs = fsOf(s);
  if (fs.active) return challengeDef(fs.active).seed ?? 0;
  const total = activeMods(s).reduce((a, mod) => a + (mod.startClings ?? 0), 0);
  // A focus that turns taps off needs one free cling, or the run could never start.
  return activeMods(s).some((mod) => mod.tap === 0) ? Math.max(1, total) : total;
}

// ---- actions ---------------------------------------------------------------

function giveStart(s) {
  const clings = startClingsOf(s);
  if (clings > 0) s.gens[0].owned = N.add(s.gens[0].owned, N.n(clings));
}

// Start a fresh run without paying grains. Used when a challenge starts, ends or is left.
function freshRun(s, why) {
  s.dust = N.ZERO;
  s.run = N.ZERO;
  s.gens = G.GENS.map(() => ({ bought: 0, owned: N.ZERO }));
  s.ups = {};
  fsOf(s).runTime = 0;
  giveStart(s);
  // Other features may keep per-run state. They can implement onRunReset(s, why).
  for (const f of G.getFeatures()) if (f.id !== 'challenges') f.onRunReset?.(s, why);
}

export function enterChallenge(s, id) {
  const fs = fsOf(s);
  if (fs.active || lockReason(s, id)) return false;
  fs.active = id;
  freshRun(s, 'challenge');
  G.notify(s, `Challenge started: ${challengeDef(id).name}`);
  return true;
}

export function leaveChallenge(s) {
  const fs = fsOf(s);
  if (!fs.active) return false;
  const c = challengeDef(fs.active);
  fs.active = null;
  freshRun(s, 'leave');
  G.notify(s, `Left the challenge: ${c.name}`);
  return true;
}

// 0 to 1, on the exponent scale from one tap up to the goal.
export function challengeProgress(s) {
  const fs = fsOf(s);
  if (!fs.active) return 0;
  const t = N.log10(targetOf(fs.active));
  const r = N.log10(s.run);
  if (!Number.isFinite(r)) return 0;
  return Math.min(1, Math.max(0, (r - G.TAP.e) / (t - G.TAP.e)));
}

// Called from tick. Pays the reward once: a done challenge cannot be entered again.
export function checkCompletion(s) {
  const fs = fsOf(s);
  if (!fs.active) return false;
  if (N.cmp(s.run, targetOf(fs.active)) < 0) return false;
  const c = challengeDef(fs.active);
  fs.done[c.id] = true;
  fs.active = null;
  freshRun(s, 'challenge-done');
  G.notify(s, `Challenge done: ${c.name}. ${c.rewardText}`);
  return true;
}

export function pickFocus(s, id) {
  const fs = fsOf(s);
  if (!isUnlocked(s) || fs.active || fs.pick || !fs.offer || !fs.offer.includes(id)) return false;
  fs.pick = id;
  // The run already began. Make sure a focus without taps cannot leave the player with nothing.
  if (startClingsOf(s) > 0 && N.cmp(s.gens[0].owned, N.ONE) < 0) s.gens[0].owned = N.ONE;
  if (id === 'gamble') fs.gamble = fs.roll < FOCUS_GAMBLE.chance;
  G.notify(s, `Focus: ${focusDef(id).name}${id === 'gamble' ? (fs.gamble ? '. You won.' : '. You lost.') : ''}`);
  return true;
}

// ---- feature ---------------------------------------------------------------

const validOffer = (o) =>
  Array.isArray(o) && o.length === OFFER_SIZE && new Set(o).size === OFFER_SIZE && o.every((id) => !!focusDef(id));

export function loadState(saved) {
  const fs = freshState(randomSalt());
  if (!saved || typeof saved !== 'object') return fs;
  if (Number.isFinite(saved.salt)) fs.salt = saved.salt >>> 0;
  fs.offerRun = Math.max(0, saved.offerRun | 0);
  fs.nonce = Math.max(0, Math.min(1e9, saved.nonce | 0));
  if (validOffer(saved.offer)) fs.offer = [...saved.offer];
  if (Number.isFinite(saved.roll)) fs.roll = Math.min(1, Math.max(0, saved.roll));
  if (fs.offer && typeof saved.pick === 'string' && fs.offer.includes(saved.pick)) fs.pick = saved.pick;
  fs.gamble = fs.pick === 'gamble' && saved.gamble === true;
  if (Number.isFinite(saved.runTime)) fs.runTime = Math.max(0, saved.runTime);
  if (saved.done && typeof saved.done === 'object') {
    for (const c of CHALLENGES) if (saved.done[c.id] === true) fs.done[c.id] = true;
  }
  if (typeof saved.active === 'string' && challengeDef(saved.active) && !fs.done[saved.active]) {
    fs.active = saved.active;
  }
  return fs;
}

export const saveState = (fs) => ({ ...fs, offer: fs.offer ? [...fs.offer] : null, done: { ...fs.done } });

function tick(s, dt) {
  const fs = fsOf(s);
  // A save from before this feature, or with a bad offer, gets its offer rebuilt from stored data.
  if (isUnlocked(s) && (fs.offerRun !== s.condenses || !fs.offer)) newOffer(s, fs.offerRun === s.condenses && fs.nonce > 0);
  if (!fs.active) fs.runTime += dt;
  checkCompletion(s);
}

function onCondense(s) {
  const fs = fsOf(s);
  // Safety net. condenseGain is zero in a challenge, so this should not happen.
  if (fs.active) {
    fs.active = null;
    G.notify(s, 'The challenge ended.');
  }
  newOffer(s);
  giveStart(s);
}

// ---- ui --------------------------------------------------------------------

const CSS = `
.ch-note { margin: 0 0 10px; }
.ch-offer, .ch-list { display: grid; gap: 8px; margin-bottom: 14px; }
.ch-sub { font-size: 13px; color: var(--muted); font-weight: 600; margin: 14px 0 6px; }
.ch-card .actions { grid-row: 1 / span 5; }
@media (max-width: 380px) { .ch-card .actions { grid-row: auto; } }
.ch-card.done { border-color: var(--ok); }
.ch-card.active { border-color: var(--accent); }
.ch-card .state { font-size: 13px; grid-column: 1; }
.ch-card.done .state { color: var(--ok); }
.ch-bar { grid-column: 1; height: 4px; background: var(--line); border-radius: 2px; overflow: hidden; }
.ch-bar > div { height: 100%; width: 0; background: var(--accent); }
.ch-picked { color: var(--ok); }
`;

function mountUi(root, ctx) {
  const { fmt } = ctx;
  const lock = document.createElement('p');
  lock.className = 'muted';
  lock.textContent = 'Locked. Condense once to unlock run focus and challenges.';
  const body = document.createElement('div');
  root.append(lock, body);

  const sub = (text) => {
    const h = document.createElement('div');
    h.className = 'ch-sub';
    h.textContent = text;
    return h;
  };
  const note = (text) => {
    const p = document.createElement('p');
    p.className = 'muted ch-note';
    p.textContent = text;
    return p;
  };

  // Run focus
  const offerBox = document.createElement('div');
  offerBox.className = 'ch-offer';
  const pickedLine = document.createElement('p');
  pickedLine.className = 'muted ch-picked';
  body.append(
    sub('Run focus'),
    note('After each condense you may pick one of 3 focus rules for this run. The pick is final for the run.'),
    pickedLine,
    offerBox,
  );

  let offerKey = '';
  const buildOffer = (fs) => {
    offerBox.textContent = '';
    for (const id of fs.offer ?? []) {
      const def = focusDef(id);
      const card = document.createElement('div');
      card.className = 'card ch-card';
      card.innerHTML = '<div class="name"></div><div class="desc"></div><div class="actions"></div>';
      card.querySelector('.name').textContent = def.name;
      card.querySelector('.desc').textContent = def.desc;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'buy';
      b.textContent = 'Pick';
      b.addEventListener('click', () => {
        if (pickFocus(ctx.getState(), id)) ctx.save();
      });
      card.querySelector('.actions').append(b);
      offerBox.append(card);
    }
  };

  // Challenges
  const list = document.createElement('div');
  list.className = 'ch-list';
  const status = document.createElement('p');
  status.className = 'muted ch-note';
  body.append(
    sub('Challenges'),
    note(
      'A challenge is a fresh run with one rule bent. Your current run is lost and grains stay. '
        + 'Grains, run focus and rewards are paused inside it. Condensing is off and pays no grains. '
        + 'Reach the goal in one run for a reward that stays for good. You may leave at any time.',
    ),
    status,
    list,
  );

  const rows = CHALLENGES.map((c) => {
    const card = document.createElement('div');
    card.className = 'card ch-card';
    card.innerHTML = '<div class="name"></div><div class="desc"></div><div class="stat"></div>'
      + '<div class="state"></div><div class="ch-bar"><div></div></div><div class="actions"></div>';
    card.querySelector('.name').textContent = c.name;
    card.querySelector('.desc').textContent = c.rule;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'buy';
    card.querySelector('.actions').append(btn);
    btn.addEventListener('click', () => {
      const s = ctx.getState();
      if (fsOf(s).active === c.id) leaveChallenge(s);
      else if (confirm(`Start "${c.name}"? Your current run is lost. Grains stay.`)) enterChallenge(s, c.id);
      else return;
      ctx.save();
    });
    list.append(card);
    return {
      c, card, btn, state: card.querySelector('.state'), bar: card.querySelector('.ch-bar'),
      fill: card.querySelector('.ch-bar > div'),
    };
  });

  let notationKey = null;
  return (s) => {
    const fs = fsOf(s);
    // The goal text depends on the number notation, so draw it again when that changes.
    const nk = ctx.N.getNotation?.();
    if (nk !== notationKey) {
      notationKey = nk;
      for (const r of rows) {
        r.card.querySelector('.stat').textContent = `Goal: ${fmt(targetOf(r.c.id))} kg of dust in one run. Reward: ${r.c.rewardText}`;
      }
    }
    const open = isUnlocked(s);
    lock.hidden = open;
    body.hidden = !open;
    if (!open) return;

    const key = `${(fs.offer ?? []).join()}|${fs.pick}|${fs.active}`;
    if (key !== offerKey) {
      offerKey = key;
      buildOffer(fs);
    }
    pickedLine.hidden = !fs.pick;
    if (fs.pick) {
      const def = focusDef(fs.pick);
      const outcome = fs.pick === 'gamble' ? (fs.gamble ? ' You won.' : ' You lost.') : '';
      pickedLine.textContent = `Focus for this run: ${def.name}. ${def.desc}${outcome}${fs.active ? ' Paused in a challenge.' : ''}`;
    }
    offerBox.hidden = !!fs.pick;
    for (const b of offerBox.querySelectorAll('button')) b.disabled = !!fs.active;

    status.textContent = fs.active
      ? `In a challenge. Grains, focus and rewards are paused. Condensing is off. This run: ${fmt(s.run)} kg.`
      : `${doneCount(fs)} of ${CHALLENGES.length} challenges done.`;

    for (const r of rows) {
      const isActive = fs.active === r.c.id;
      const done = !!fs.done[r.c.id];
      const reason = lockReason(s, r.c.id);
      r.card.classList.toggle('done', done);
      r.card.classList.toggle('active', isActive);
      r.card.classList.toggle('locked', !done && !isActive && !!reason);
      r.state.textContent = done ? 'Done. Reward is active.' : isActive ? 'Running.' : reason || 'Ready.';
      r.bar.hidden = !isActive;
      if (isActive) r.fill.style.width = `${(challengeProgress(s) * 100).toFixed(1)}%`;
      r.btn.hidden = done;
      r.btn.textContent = isActive ? 'Leave' : 'Start';
      r.btn.disabled = isActive ? false : !!fs.active || !!reason;
    }
  };
}

G.registerFeature({
  id: 'challenges',
  init: () => freshState(randomSalt()),
  toSave: saveState,
  fromSave: loadState,
  tick,
  onCondense,
  globalMult: globalMultOf,
  genMult: genMultOf,
  tapMult: tapMultOf,
  autoTaps: autoTapsOf,
  speed: speedOf,
  costMult: costMultOf,
  condenseGain: (s, gain) => (fsOf(s).active ? N.ZERO : gain),
  ui: { title: 'Challenges and focus', order: 40, css: CSS, mount: mountUi, visible: (s) => isUnlocked(s) },
});
