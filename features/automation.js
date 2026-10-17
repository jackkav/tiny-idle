import * as G from '../game.js';
import * as N from '../num.js';

// Automation.
// Choice about grains: grains are never spent. The core multiplier reads state.grains,
// so spending them would make the player weaker. Instead:
//  - Autobuyers and auto-condense unlock when total grains reach a threshold.
//  - Speed levels cost "points". Points = whole grains owned minus points spent.
//    The ledger is ours (fs.spent). state.grains does not change.

export const ID = 'automation';

// Grains needed to unlock each autobuyer. Tune these for pacing.
export const UNLOCK_GRAINS = {
  gen0: 2,
  methods: 4,
  gen1: 6,
  gen2: 9,
  gen3: 13,
  gen4: 18,
  gen5: 25,
};
export const AUTO_CONDENSE_GRAINS = 30;

// Active slots: SLOT_BASE plus one more for every SLOT_EVERY condenses, up to SLOT_MAX.
export const SLOT_BASE = 1;
export const SLOT_EVERY = 3;
export const SLOT_MAX = 6;

// Speed: interval in real seconds. Each level multiplies it by SPEED_FACTOR.
export const INTERVAL_BASE = 6;
export const SPEED_FACTOR = 0.7;
export const SPEED_MAX = 8;
// Points for the next speed level: ceil(SPEED_COST_BASE * SPEED_COST_GROWTH ^ level).
export const SPEED_COST_BASE = 2;
export const SPEED_COST_GROWTH = 1.5;

// One timer fire buys at most one item. One tick runs at most this many fires.
export const MAX_FIRES_PER_TICK = 10;

export const RESERVE_CHOICES = [0, 0.25, 0.5, 0.75, 0.9];
export const MIN_GAIN_CHOICES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
export const DEFAULT_MIN_GAIN = 10;

export const AUTOBUYERS = [
  { id: 'methods', kind: 'up', name: 'Method buyer', desc: 'Buys the cheapest method you can afford.', reserve: 0 },
  ...G.GENS.map((g, k) => ({
    id: `gen${k}`,
    kind: 'gen',
    index: k,
    name: `${g.name} buyer`,
    desc: `Buys one ${g.name.toLowerCase()} at a time.`,
    reserve: 0.5,
  })),
];
const BY_ID = Object.fromEntries(AUTOBUYERS.map((a) => [a.id, a]));
export const IDS = AUTOBUYERS.map((a) => a.id);

const nearest = (list, x, fallback) => (list.includes(x) ? x : fallback);

export function init() {
  return {
    on: {},
    order: [...IDS],
    reserve: Object.fromEntries(AUTOBUYERS.map((a) => [a.id, a.reserve])),
    timers: {},
    speed: 0,
    spent: 0,
    cond: { on: false, min: DEFAULT_MIN_GAIN },
    quiet: false, // transient: true while offline catch-up runs
    log: { buys: 0, condenses: 0 }, // transient: offline summary
  };
}

export function toSave(fs) {
  return {
    on: fs.on,
    order: fs.order,
    reserve: fs.reserve,
    speed: fs.speed,
    spent: fs.spent,
    cond: fs.cond,
  };
}

export function fromSave(saved) {
  const fs = init();
  if (!saved || typeof saved !== 'object') return fs;
  if (saved.on && typeof saved.on === 'object') {
    for (const id of IDS) if (saved.on[id] === true) fs.on[id] = true;
  }
  if (Array.isArray(saved.order)) {
    const seen = saved.order.filter((id, i) => BY_ID[id] && saved.order.indexOf(id) === i);
    fs.order = [...seen, ...IDS.filter((id) => !seen.includes(id))];
  }
  if (saved.reserve && typeof saved.reserve === 'object') {
    for (const id of IDS) fs.reserve[id] = nearest(RESERVE_CHOICES, saved.reserve[id], fs.reserve[id]);
  }
  fs.speed = Math.min(SPEED_MAX, Math.max(0, saved.speed | 0));
  fs.spent = Math.max(0, saved.spent | 0);
  if (saved.cond && typeof saved.cond === 'object') {
    fs.cond.on = saved.cond.on === true;
    fs.cond.min = nearest(MIN_GAIN_CHOICES, saved.cond.min, DEFAULT_MIN_GAIN);
  }
  return fs;
}

// ---- pure rules ----

export const grainsWhole = (s) => Math.floor(N.toNumber(s.grains));
export const isUnlocked = (s, id) => grainsWhole(s) >= UNLOCK_GRAINS[id];
export const condUnlocked = (s) => grainsWhole(s) >= AUTO_CONDENSE_GRAINS;
export const slotCount = (s) => Math.min(SLOT_MAX, SLOT_BASE + Math.floor(s.condenses / SLOT_EVERY));
// Condenses still needed for the next slot, or 0 if all slots are open.
export const condensesToNextSlot = (s) =>
  slotCount(s) >= SLOT_MAX ? 0 : SLOT_EVERY - (s.condenses % SLOT_EVERY);

// Autobuyers that run now, in priority order. Extra "on" flags beyond the slots are ignored.
export function activeIds(s) {
  const fs = s.f[ID];
  return fs.order.filter((id) => fs.on[id] && isUnlocked(s, id)).slice(0, slotCount(s));
}

export const intervalOf = (s) => INTERVAL_BASE * SPEED_FACTOR ** s.f[ID].speed;
export const points = (s) => Math.max(0, grainsWhole(s) - s.f[ID].spent);
export const speedCost = (s) => Math.ceil(SPEED_COST_BASE * SPEED_COST_GROWTH ** s.f[ID].speed);

export function buySpeed(s) {
  const fs = s.f[ID];
  if (fs.speed >= SPEED_MAX || points(s) < speedCost(s)) return false;
  fs.spent += speedCost(s);
  fs.speed += 1;
  return true;
}

export function setOn(s, id, on) {
  const fs = s.f[ID];
  if (!BY_ID[id]) return false;
  if (!on) {
    fs.on[id] = false;
    return true;
  }
  if (!isUnlocked(s, id)) return false;
  if (activeIds(s).includes(id)) return true;
  if (activeIds(s).length >= slotCount(s)) return false;
  fs.on[id] = true;
  fs.timers[id] = 0;
  return true;
}

export function move(s, id, dir) {
  const o = s.f[ID].order;
  const i = o.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= o.length) return false;
  [o[i], o[j]] = [o[j], o[i]];
  return true;
}

export function setReserve(s, id, value) {
  if (!BY_ID[id] || !RESERVE_CHOICES.includes(value)) return false;
  s.f[ID].reserve[id] = value;
  return true;
}

export function setCond(s, patch) {
  const c = s.f[ID].cond;
  if ('on' in patch) {
    if (patch.on && !condUnlocked(s)) return false;
    c.on = !!patch.on;
  }
  if ('min' in patch) {
    if (!MIN_GAIN_CHOICES.includes(patch.min)) return false;
    c.min = patch.min;
  }
  return true;
}

// Can the player pay this cost and still keep the reserved share of dust?
export const affordable = (s, cost, reserve) => N.cmp(cost, N.scale(s.dust, 1 - reserve)) <= 0;

// Cheapest method that can be bought now, or null.
export function cheapestMethod(s) {
  let best = null;
  let bestCost = null;
  for (const u of G.UPGRADES) {
    if (!G.upAvailable(s, u.id)) continue;
    const c = G.upCost(s, u.id);
    if (best === null || N.cmp(c, bestCost) < 0) {
      best = u.id;
      bestCost = c;
    }
  }
  return best === null ? null : { id: best, cost: bestCost };
}

// Try to buy one item for one autobuyer. Returns true if bought.
export function buyOnce(s, id) {
  const def = BY_ID[id];
  const reserve = s.f[ID].reserve[id];
  if (def.kind === 'gen') {
    if (!affordable(s, G.genCost(s, def.index), reserve)) return false;
    return G.buyGen(s, def.index);
  }
  const pick = cheapestMethod(s);
  if (!pick || !affordable(s, pick.cost, reserve)) return false;
  return G.buyUp(s, pick.id);
}

export function runAutobuyers(s, dt) {
  const fs = s.f[ID];
  const interval = intervalOf(s);
  for (const id of activeIds(s)) {
    const t = (fs.timers[id] ?? 0) + dt;
    const fires = Math.min(MAX_FIRES_PER_TICK, Math.floor(t / interval));
    fs.timers[id] = t % interval;
    for (let i = 0; i < fires; i++) {
      if (!buyOnce(s, id)) break;
      fs.log.buys += 1;
    }
  }
}

// Returns true if it condensed.
export function runAutoCondense(s) {
  const fs = s.f[ID];
  if (!fs.cond.on || !condUnlocked(s) || !G.canCondense(s)) return false;
  const gain = G.condenseGain(s);
  if (N.toNumber(gain) < fs.cond.min) return false;
  if (!G.condense(s)) return false;
  fs.log.condenses += 1;
  if (!fs.quiet) G.notify(s, `Auto-condensed into ${N.fmtInt(gain)} grains`);
  return true;
}

export function step(s, dt) {
  runAutobuyers(s, dt);
  runAutoCondense(s); // last, so nothing is bought into a reset
}

export function onCondense(s) {
  s.f[ID].timers = {};
}

export function offline(s, seconds) {
  const fs = s.f[ID];
  fs.quiet = true;
  fs.log = { buys: 0, condenses: 0 };
  return seconds;
}

export function onReturn(s) {
  const fs = s.f[ID];
  fs.quiet = false;
  const { buys, condenses } = fs.log;
  if (buys > 0 || condenses > 0) {
    G.notify(s, `Autobuyers bought ${buys} items and condensed ${condenses} times while you were away`);
  }
  fs.log = { buys: 0, condenses: 0 };
}

// ---- UI ----

const CSS = `
.ab-sum { color: var(--muted); font-size: 13px; margin-bottom: 8px; display: grid; gap: 2px; }
.ab-row .actions { align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.ab-row select { font: inherit; font-size: 13px; background: #1d2433; color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 6px; min-height: 44px; }
.ab-row .buy { min-width: 64px; }
.ab-row .buy.is-on { border-color: var(--ok); color: var(--ok); }
.ab-row .mv { min-width: 44px; }
.ab-speed { margin-bottom: 8px; }
`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label, onClick, cls = 'buy') {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function select(options, label, onChange) {
  const sel = el('select');
  sel.setAttribute('aria-label', label);
  for (const [value, text] of options) {
    const o = el('option', '', text);
    o.value = String(value);
    sel.append(o);
  }
  sel.addEventListener('change', () => onChange(Number(sel.value)));
  return sel;
}

const setSelect = (sel, v) => {
  if (document.activeElement !== sel) sel.value = String(v);
};

function card(name, desc) {
  const c = el('div', 'card ab-row');
  c.append(el('div', 'name', name), el('div', 'desc', desc), el('div', 'stat'), el('div', 'actions'));
  return c;
}

function mount(root, ctx) {
  const st = () => ctx.getState();
  const summary = el('div', 'ab-sum');
  const sumLines = [el('div'), el('div'), el('div')];
  summary.append(...sumLines);
  const speedCard = card('Speed', 'Faster autobuyers. Costs points. Points come from grains. Your grains stay.');
  speedCard.classList.add('ab-speed');
  const speedBtn = button('Faster', () => buySpeed(st()));
  speedBtn.append(el('small'));
  speedCard.querySelector('.actions').append(speedBtn);
  const list = el('div', 'list');
  root.append(summary, speedCard, list);

  const rows = {};
  for (const def of AUTOBUYERS) {
    const c = card(def.name, def.desc);
    const act = c.querySelector('.actions');
    const toggle = button('Off', () => {
      const s = st();
      if (!setOn(s, def.id, !activeIds(s).includes(def.id))) ctx.toast('No free slot. Turn another autobuyer off.');
    });
    const reserve = select(
      RESERVE_CHOICES.map((r) => [r, `Keep ${Math.round(r * 100)}%`]),
      `${def.name} reserve`,
      (v) => setReserve(st(), def.id, v),
    );
    const up = button('Up', () => move(st(), def.id, -1), 'buy mv');
    const down = button('Down', () => move(st(), def.id, 1), 'buy mv');
    act.append(toggle, reserve, up, down);
    rows[def.id] = { c, toggle, reserve, stat: c.querySelector('.stat') };
    list.append(c);
  }

  const cc = card('Auto-condense', 'Condenses for you when the gain is at least the minimum.');
  const ccToggle = button('Off', () => {
    const s = st();
    if (!setCond(s, { on: !s.f[ID].cond.on })) ctx.toast('Locked.');
  });
  const ccMin = select(MIN_GAIN_CHOICES.map((v) => [v, `Min ${v} grains`]), 'Minimum grains', (v) => setCond(st(), { min: v }));
  cc.querySelector('.actions').append(ccToggle, ccMin);
  root.append(cc);

  let shownOrder = '';
  return (s) => {
    const fs = s.f[ID];
    const act = activeIds(s);
    const slots = slotCount(s);
    const next = condensesToNextSlot(s);
    sumLines[0].textContent = `Slots: ${act.length} of ${slots} in use.`;
    sumLines[1].textContent = next > 0 ? `Next slot after ${next} more condenses.` : 'All slots open.';
    sumLines[2].textContent = `Order matters. The top autobuyer spends first. Interval: ${intervalOf(s).toFixed(2)} s.`;
    const maxed = fs.speed >= SPEED_MAX;
    speedCard.querySelector('.stat').textContent = `Level ${fs.speed} of ${SPEED_MAX}. Points: ${points(s)}.`;
    speedBtn.disabled = maxed || points(s) < speedCost(s);
    speedBtn.firstChild.textContent = maxed ? 'Done' : 'Faster';
    speedBtn.querySelector('small').textContent = maxed ? '' : `${speedCost(s)} points`;

    const key = fs.order.join(',');
    if (key !== shownOrder) {
      shownOrder = key;
      for (const id of fs.order) list.append(rows[id].c);
    }
    for (const def of AUTOBUYERS) {
      const r = rows[def.id];
      const open = isUnlocked(s, def.id);
      const on = act.includes(def.id);
      r.c.classList.toggle('locked', !open);
      r.toggle.disabled = !open || (!on && act.length >= slots);
      r.toggle.textContent = on ? 'On' : 'Off';
      r.toggle.classList.toggle('is-on', on);
      r.toggle.setAttribute('aria-pressed', String(on));
      r.reserve.disabled = !open;
      setSelect(r.reserve, fs.reserve[def.id]);
      r.stat.textContent = open
        ? `Priority ${fs.order.indexOf(def.id) + 1}. Keeps ${Math.round(fs.reserve[def.id] * 100)}% of dust.`
        : `Unlocks at ${UNLOCK_GRAINS[def.id]} grains. You have ${grainsWhole(s)}.`;
    }
    const open = condUnlocked(s);
    cc.classList.toggle('locked', !open);
    ccToggle.disabled = !open;
    ccToggle.textContent = fs.cond.on ? 'On' : 'Off';
    ccToggle.classList.toggle('is-on', fs.cond.on);
    ccToggle.setAttribute('aria-pressed', String(fs.cond.on));
    ccMin.disabled = !open;
    setSelect(ccMin, fs.cond.min);
    cc.querySelector('.stat').textContent = open
      ? 'Does not use a slot.'
      : `Unlocks at ${AUTO_CONDENSE_GRAINS} grains. You have ${grainsWhole(s)}.`;
  };
}

G.registerFeature({
  id: ID,
  init,
  toSave,
  fromSave,
  tick: step,
  onCondense,
  offline,
  onReturn,
  // Shown from the first condense on, so the first minutes stay simple.
  ui: { title: 'Autobuyers', order: 40, css: CSS, mount, visible: (s) => s.unlocked.condense || s.condenses > 0 },
});
