import * as G from '../game.js';
import * as N from '../num.js';

// Layer 3: Compaction. Reset grains, collectors and methods for pebbles.
// Pebbles are placed in a small lattice. Where you put them matters (adjacency rules).

// ---- Tuning constants ----
export const COMPACT_AT_GRAINS = N.n(100); // grains needed for the first compaction
export const COMPACT_GROWTH = 1.6; // the requirement is multiplied by this after each compaction
export const PEBBLE_BASE = 3; // pebbles at exactly COMPACT_AT_GRAINS
export const PEBBLE_EXP = 0.5; // pebbles = BASE * (grains / COMPACT_AT_GRAINS) ^ EXP, rounded down

export const GRID = 3; // lattice is GRID x GRID
export const SLOTS = GRID * GRID;
export const SLOT_ORDER = [4, 1, 3, 5, 7, 0, 2, 6, 8]; // opening order, centre first
export const SLOTS_BASE = 3; // slots open at the first compaction
export const SIZE_MAX = 4; // most pebbles in one slot
export const REFUND = 0.5; // share of pebbles returned when a slot is cleared

export const BOND = 0.25; // slot bonus for each neighbour of the same kind
export const FEED = 0.75; // slot bonus for each neighbour of the kind that feeds it
export const CLASH = -0.25; // slot bonus for each neighbour of the opposite kind
export const MIN_FACTOR = 0.25; // a slot never drops below this factor

export const KINDS = [
  { id: 'dense', name: 'Dense', blurb: 'Tap power', base: 2 }, // x base ^ score
  { id: 'wide', name: 'Wide', blurb: 'Collector output', base: 2 }, // x base ^ score
  { id: 'deep', name: 'Deep', blurb: 'Grain strength', per: 0.5 }, // each grain adds +100% x (1 + per x score)
  { id: 'lens', name: 'Lens', blurb: 'Condense gain', per: 0.1 }, // grains per condense x (1 + per x score)
];
// Each kind is fed by the kind before it in this list. The last kind feeds the first.
const feeder = (k) => (k + KINDS.length - 1) % KINDS.length;
const opposite = (k) => (k + 2) % KINDS.length;

// ---- Pure rules ----
export const emptyGrid = () => Array.from({ length: SLOTS }, () => ({ kind: -1, size: 0 }));

export const slotsOpen = (count) => Math.min(SLOTS, SLOTS_BASE + Math.max(0, count | 0));
export const isOpen = (count, i) => {
  const at = SLOT_ORDER.indexOf(i);
  return at >= 0 && at < slotsOpen(count);
};

export function neighbours(i) {
  const r = Math.floor(i / GRID);
  const c = i % GRID;
  const out = [];
  if (r > 0) out.push(i - GRID);
  if (r < GRID - 1) out.push(i + GRID);
  if (c > 0) out.push(i - 1);
  if (c < GRID - 1) out.push(i + 1);
  return out;
}

// Cost in pebbles to add one more pebble to a slot that holds `size` now.
export const placeCost = (size) => size + 1;
// Pebbles spent in total to reach `size`.
export const spentOn = (size) => (size * (size + 1)) / 2;

// Pebble counts are whole numbers. Round after each change to drop float drift.
const settle = (x) => (x.e < 15 ? N.n(Math.round(N.toNumber(x))) : x);

const filled = (cell) => cell.kind >= 0 && cell.size > 0;

export function slotFactor(grid, i) {
  const cell = grid[i];
  if (!filled(cell)) return 0;
  let f = 1;
  for (const j of neighbours(i)) {
    const o = grid[j];
    if (!filled(o)) continue;
    if (o.kind === cell.kind) f += BOND;
    else if (o.kind === feeder(cell.kind)) f += FEED;
    else if (o.kind === opposite(cell.kind)) f += CLASH;
  }
  return Math.max(MIN_FACTOR, f);
}

export const slotScore = (grid, i) => (filled(grid[i]) ? grid[i].size * slotFactor(grid, i) : 0);

// Total score for each kind.
export function kindScores(grid) {
  const out = KINDS.map(() => 0);
  grid.forEach((cell, i) => {
    if (filled(cell)) out[cell.kind] += slotScore(grid, i);
  });
  return out;
}

export function effectsFor(grid) {
  const sc = kindScores(grid);
  return {
    scores: sc,
    tap: N.pow(N.n(KINDS[0].base), sc[0]),
    gens: N.pow(N.n(KINDS[1].base), sc[1]),
    grain: 1 + KINDS[2].per * sc[2], // factor on the strength of each grain
    condense: 1 + KINDS[3].per * sc[3],
  };
}

// Grains needed for the next compaction, after `count` compactions.
export const requirement = (count) => N.mul(COMPACT_AT_GRAINS, N.pow(N.n(COMPACT_GROWTH), Math.max(0, count | 0)));

export function pebbleGain(grains) {
  if (N.cmp(grains, COMPACT_AT_GRAINS) < 0) return N.ZERO;
  return N.floor(N.scale(N.pow(N.div(grains, COMPACT_AT_GRAINS), PEBBLE_EXP), PEBBLE_BASE));
}

export const canCompact = (s) => N.gte(s.grains, requirement(s.f.compaction.count)) && N.gte(pebbleGain(s.grains), N.ONE);

export function compact(s) {
  if (!canCompact(s)) return false;
  const gained = pebbleGain(s.grains);
  const fs = s.f.compaction;
  fs.pebbles = settle(N.add(fs.pebbles, gained));
  fs.total = settle(N.add(fs.total, gained));
  fs.count += 1;
  G.resetBelow(s);
  G.notify(s, `Compacted into ${N.fmtInt(gained)} pebbles`);
  return true;
}

export function canPlace(s, i, kind) {
  const fs = s.f.compaction;
  if (!Number.isInteger(i) || i < 0 || i >= SLOTS || !isOpen(fs.count, i)) return false;
  if (!Number.isInteger(kind) || kind < 0 || kind >= KINDS.length) return false;
  const cell = fs.grid[i];
  if (cell.size > 0 && cell.kind !== kind) return false;
  if (cell.size >= SIZE_MAX) return false;
  return N.gte(fs.pebbles, N.n(placeCost(cell.size)));
}

export function place(s, i, kind) {
  if (!canPlace(s, i, kind)) return false;
  const fs = s.f.compaction;
  const cell = fs.grid[i];
  fs.pebbles = settle(N.sub(fs.pebbles, N.n(placeCost(cell.size))));
  cell.kind = kind;
  cell.size += 1;
  return true;
}

export function clear(s, i) {
  const fs = s.f.compaction;
  if (!Number.isInteger(i) || i < 0 || i >= SLOTS) return false;
  const cell = fs.grid[i];
  if (cell.size <= 0) return false;
  fs.pebbles = settle(N.add(fs.pebbles, N.n(Math.floor(spentOn(cell.size) * REFUND))));
  cell.kind = -1;
  cell.size = 0;
  return true;
}

// ---- Feature ----
G.registerFeature({
  id: 'compaction',
  init: () => ({ pebbles: N.ZERO, total: N.ZERO, count: 0, grid: emptyGrid() }),
  toSave: (fs) => ({
    pebbles: N.toJSON(fs.pebbles),
    total: N.toJSON(fs.total),
    count: fs.count,
    grid: fs.grid.map((c) => ({ kind: c.kind, size: c.size })),
  }),
  fromSave(saved) {
    const fs = { pebbles: N.ZERO, total: N.ZERO, count: 0, grid: emptyGrid() };
    if (!saved || typeof saved !== 'object') return fs;
    fs.pebbles = N.fromJSON(saved.pebbles);
    fs.total = N.fromJSON(saved.total);
    fs.count = Math.min(1e6, Math.max(0, saved.count | 0));
    if (Array.isArray(saved.grid)) {
      for (let i = 0; i < SLOTS; i++) {
        const c = saved.grid[i];
        const kind = c && Number.isInteger(c.kind) ? c.kind : -1;
        const size = c && Number.isInteger(c.size) ? c.size : 0;
        if (kind >= 0 && kind < KINDS.length && size >= 1 && isOpen(fs.count, i)) {
          fs.grid[i] = { kind, size: Math.min(SIZE_MAX, size) };
        }
      }
    }
    return fs;
  },
  tapMult: (s) => effectsFor(s.f.compaction.grid).tap,
  genMult: (s) => effectsFor(s.f.compaction.grid).gens,
  globalMult(s) {
    const k = effectsFor(s.f.compaction.grid).grain;
    if (k === 1 || N.isZero(s.grains)) return N.ONE;
    // Core already counts 1 + grains. This adds the rest so the total is 1 + grains x k.
    return N.div(N.add(N.ONE, N.scale(s.grains, k)), N.add(N.ONE, s.grains));
  },
  condenseGain: (s, gain) => N.scale(gain, effectsFor(s.f.compaction.grid).condense),
  ui: {
    title: 'Compaction',
    order: 60,
    css: `
      .cmp-bar { height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; margin-top: 6px; }
      .cmp-bar > div { height: 100%; background: var(--ok); width: 0; }
      .cmp-palette { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
      .cmp-palette button { flex: 1 1 70px; min-height: 44px; background: #1d2433; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; padding: 4px 8px; line-height: 1.2; }
      .cmp-palette button small { display: block; color: var(--muted); font-size: 11px; }
      .cmp-palette button[aria-pressed="true"] { border-color: var(--accent); background: #232c40; }
      .cmp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; max-width: 360px; margin: 0 auto; }
      .cmp-slot { aspect-ratio: 1; min-height: 64px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; cursor: pointer; display: grid; place-content: center; text-align: center; font-size: 13px; line-height: 1.25; padding: 2px; }
      .cmp-slot small { color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
      .cmp-slot.filled { border-color: var(--accent); }
      .cmp-slot:disabled { opacity: 0.35; cursor: default; }
      .cmp-effects { margin: 12px 0 0; padding: 0; list-style: none; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
      .cmp-effects b { color: var(--text); font-weight: 600; }
      .cmp-help { font-size: 12px; color: var(--muted); margin: 10px 0 0; }
    `,
    mount(root, ctx) {
      const { fmt, fmtInt } = ctx;
      let tool = 0; // kind index, or -1 for clear
      let lastEffects = '';
      root.innerHTML = `
        <div class="card" style="grid-template-columns:1fr">
          <div class="name">Compaction</div>
          <div class="desc cmp-desc"></div>
          <div class="cmp-bar"><div></div></div>
          <div class="stat cmp-stat"></div>
          <div class="actions" style="grid-column:1;grid-row:auto"><button type="button" class="buy cmp-go" style="width:100%"><span></span><small></small></button></div>
        </div>
        <div class="cmp-lattice">
          <div class="cmp-pool stat" style="margin:12px 0 0"></div>
          <div class="cmp-palette"></div>
          <div class="cmp-grid"></div>
          <ul class="cmp-effects"></ul>
          <p class="cmp-help"></p>
        </div>`;
      const $ = (c) => root.querySelector(c);
      const goBtn = $('.cmp-go');
      goBtn.addEventListener('click', () => {
        const s = ctx.getState();
        if (!canCompact(s)) return;
        const gain = pebbleGain(s.grains);
        if (!confirm(`Compact? Dust, collectors, methods, grains and condense count reset. You get ${fmtInt(gain)} pebbles.`)) return;
        compact(s);
        ctx.save();
      });
      const tools = [...KINDS.map((k, i) => ({ i, name: k.name, sub: k.blurb })), { i: -1, name: 'Clear', sub: `Refund ${REFUND * 100}%` }];
      const toolBtns = tools.map((t) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.innerHTML = '<span></span><small></small>';
        b.firstChild.textContent = t.name;
        b.querySelector('small').textContent = t.sub;
        b.addEventListener('click', () => { tool = t.i; });
        $('.cmp-palette').append(b);
        return b;
      });
      const slotBtns = Array.from({ length: SLOTS }, (_, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cmp-slot';
        b.innerHTML = '<span></span><small></small>';
        b.addEventListener('click', () => {
          const s = ctx.getState();
          if (tool < 0) clear(s, i);
          else place(s, i, tool);
        });
        $('.cmp-grid').append(b);
        return b;
      });
      $('.cmp-help').textContent = `Adding a pebble to a slot costs its size plus 1. A neighbour of the same kind: +${BOND * 100}%. A neighbour that feeds the slot: +${FEED * 100}%. A neighbour of the opposite kind: ${CLASH * 100}%. Feeding order: ${KINDS.map((k) => k.name).join(', ')}, then back to ${KINDS[0].name}.`;
      return (s) => {
        const fs = s.f.compaction;
        const show = s.unlocked.condense || N.gte(s.grains, N.ONE) || fs.count > 0;
        root.parentElement.hidden = !show;
        if (!show) return;
        const ready = canCompact(s);
        const req = requirement(fs.count);
        const showLattice = fs.count > 0 || ready;
        $('.cmp-lattice').hidden = !showLattice;
        const frac = Math.min(1, Math.max(0, N.toNumber(s.grains) / N.toNumber(req)));
        $('.cmp-bar > div').style.width = `${(frac * 100).toFixed(1)}%`;
        $('.cmp-desc').textContent = fs.count > 0
          ? 'Press everything into pebbles. Collectors, methods and grains reset. The lattice stays.'
          : 'A new layer. Press your grains into pebbles and place them in a lattice.';
        $('.cmp-stat').textContent = ready
          ? `You would get ${fmtInt(pebbleGain(s.grains))} pebbles.`
          : `Needs ${fmtInt(req)} grains. You have ${fmtInt(s.grains)}.`;
        goBtn.disabled = !ready;
        goBtn.firstChild.textContent = ready ? `Compact for ${fmtInt(pebbleGain(s.grains))} pebbles` : 'Locked';
        goBtn.querySelector('small').textContent = '';
        if (!showLattice) return;
        $('.cmp-pool').textContent = `${fmtInt(fs.pebbles)} pebbles to place. ${fmtInt(fs.total)} earned in all. ${fs.count} compactions.`;
        toolBtns.forEach((b, j) => b.setAttribute('aria-pressed', String(tools[j].i === tool)));
        const open = slotsOpen(fs.count);
        slotBtns.forEach((b, i) => {
          const cell = fs.grid[i];
          const order = SLOT_ORDER.indexOf(i);
          b.disabled = order >= open;
          b.classList.toggle('filled', cell.size > 0);
          if (order >= open) {
            b.firstChild.textContent = 'Locked';
            b.querySelector('small').textContent = `After compaction ${order - SLOTS_BASE + 1}`;
          } else if (cell.size > 0) {
            b.firstChild.textContent = `${KINDS[cell.kind].name} ${cell.size}`;
            b.querySelector('small').textContent = `score ${slotScore(fs.grid, i).toFixed(2)}`;
          } else {
            b.firstChild.textContent = 'Empty';
            b.querySelector('small').textContent = '';
          }
        });
        const e = effectsFor(fs.grid);
        const text = [
          `<b>Dense</b>: taps x${fmt(e.tap)} (score ${e.scores[0].toFixed(1)})`,
          `<b>Wide</b>: collectors x${fmt(e.gens)} (score ${e.scores[1].toFixed(1)})`,
          `<b>Deep</b>: each grain is worth x${e.grain.toFixed(2)} (score ${e.scores[2].toFixed(1)})`,
          `<b>Lens</b>: condense gives x${e.condense.toFixed(2)} grains (score ${e.scores[3].toFixed(1)})`,
        ].map((l) => `<li>${l}</li>`).join('');
        if (text !== lastEffects) {
          lastEffects = text;
          $('.cmp-effects').innerHTML = text;
        }
      };
    },
  },
});
