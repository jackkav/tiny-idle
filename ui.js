import * as G from './game.js';
import './features/index.js'; // registers every feature before the first state is built
import * as N from './num.js';
import { fmt, fmtInt, gte, scale } from './num.js';
import { describeScale, barFraction } from './scale.js';

const SAVE_KEY = 'smallest-thing-v1';
const $ = (id) => document.getElementById(id);

// ---- State -----------------------------------------------------------------

function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) return G.fromSave(JSON.parse(raw));
  } catch {
    // Corrupt or blocked storage: start fresh.
  }
  return G.newState();
}

function save() {
  state.savedAt = Date.now();
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(G.toSave(state)));
  } catch {
    // Storage blocked or full. The game still runs.
  }
}

let state = load();

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('toasts').append(el);
  setTimeout(() => el.remove(), 4000);
}

// Offline progress. The rhythm feature shows the return message (toast or
// welcome panel) from the onReturn hook.
{
  const away = (Date.now() - state.savedAt) / 1000;
  if (away > 30) G.applyOffline(state, away);
}

// ---- Tapping ---------------------------------------------------------------

const tapBtn = $('tap');
let floaters = 0;

function doTap(x, y) {
  const v = G.tap(state);
  if (floaters < 12) {
    floaters++;
    const el = document.createElement('span');
    el.className = 'floater';
    el.textContent = `+${fmt(v)}`;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    $('floaters').append(el);
    setTimeout(() => {
      el.remove();
      floaters--;
    }, 900);
  }
}

tapBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  doTap(e.clientX, e.clientY);
});
tapBtn.addEventListener('keydown', (e) => {
  if (e.key !== ' ' && e.key !== 'Enter') return;
  e.preventDefault();
  if (e.repeat) return;
  const r = tapBtn.getBoundingClientRect();
  doTap(r.left + r.width / 2, r.top + r.height / 2);
});
// Pointer and key paths handle taps. Ignore the synthetic click so a tap never counts twice.
tapBtn.addEventListener('click', (e) => e.preventDefault());

// ---- Rows ------------------------------------------------------------------

function card({ name, desc }) {
  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = '<div class="name"></div><div class="desc"></div><div class="stat"></div><div class="actions"></div>';
  el.querySelector('.name').textContent = name;
  el.querySelector('.desc').textContent = desc;
  return el;
}

function buyButton(label, onClick, extraClass = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `buy ${extraClass}`.trim();
  b.innerHTML = '<span></span><small></small>';
  b.firstChild.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

const genRows = G.GENS.map((def, k) => {
  const el = card({ name: def.name, desc: def.blurb });
  const buy = buyButton('Buy', () => G.buyGen(state, k));
  const max = buyButton('Max', () => G.buyGenMax(state, k), 'max');
  max.querySelector('small').remove();
  el.querySelector('.actions').append(max, buy);
  $('gens').append(el);
  return { el, stat: el.querySelector('.stat'), buy, max };
});

const upRows = G.UPGRADES.map((def) => {
  const el = card({ name: def.name, desc: def.desc });
  const buy = buyButton('Buy', () => G.buyUp(state, def.id));
  el.querySelector('.actions').append(buy);
  $('ups').append(el);
  return { def, el, stat: el.querySelector('.stat'), buy };
});

// ---- Condensation panel ----------------------------------------------------

const condenseBody = $('condense-body');
const condenseCard = card({ name: 'Condense', desc: '' });
const condenseBtn = buyButton('Condense', () => {
  if (!G.canCondense(state)) return;
  if (!confirm('Condense? Dust, collectors and methods reset. Grains stay.')) return;
  const gained = G.condenseGain(state);
  G.condense(state);
  toast(`Condensed into ${fmt(gained, 0)} grains`);
  save();
});
condenseCard.querySelector('.actions').append(condenseBtn);
condenseBody.append(condenseCard);

// ---- Features ----------------------------------------------------------------
// Each feature with a ui gets its own section. mount() returns a render(state) function.

const featureCtx = {
  getState: () => state,
  G, N, fmt, fmtInt, toast, save,
  replaceState: (next) => { state = next; },
  dom: { tap: tapBtn, floaters: $('floaters'), body: document.body },
};
const featureRenders = [];
for (const f of [...G.getFeatures()].filter((x) => x.ui).sort((a, b) => (a.ui.order ?? 50) - (b.ui.order ?? 50))) {
  const section = document.createElement('section');
  section.id = `feature-${f.id}`;
  if (f.ui.title) {
    const h = document.createElement('h2');
    h.textContent = f.ui.title;
    section.append(h);
  }
  const body = document.createElement('div');
  section.append(body);
  $('features').append(section);
  if (f.ui.css) {
    const style = document.createElement('style');
    style.textContent = f.ui.css;
    document.head.append(style);
  }
  const r = f.ui.mount(body, featureCtx);
  if (r) featureRenders.push(() => r(state));
}

// ---- Rendering -------------------------------------------------------------

const el = {
  dust: $('dust'), rate: $('rate'), scale: $('scale'), fill: $('fill'),
  speck: $('speck'), condense: $('condense'),
};

function render() {
  el.dust.textContent = fmt(state.dust, 2);
  el.rate.textContent = `${fmt(G.dustPerSecond(state), 2)} kg per second`;
  el.scale.textContent = describeScale(state.dust);
  const frac = barFraction(state.dust);
  el.fill.style.width = `${(frac * 100).toFixed(2)}%`;
  const px = 3 + frac * 90;
  el.speck.style.width = el.speck.style.height = `${px.toFixed(1)}px`;

  tapBtn.title = `+${fmt(G.tapValue(state))} kg per tap`;

  G.GENS.forEach((def, k) => {
    const row = genRows[k];
    const g = state.gens[k];
    const cost = G.genCost(state, k);
    row.el.hidden = !(k === 0 || g.bought > 0 || state.gens[k - 1].bought > 0);
    row.stat.textContent = `${fmtInt(g.owned)} owned, x${fmt(G.genMult(state, k), 2)} output`;
    const afford = gte(state.dust, cost);
    row.buy.disabled = !afford;
    row.max.disabled = !afford;
    row.buy.querySelector('small').textContent = `${fmt(cost)} kg`;
  });

  upRows.forEach(({ def, el: card, stat, buy }) => {
    const lvl = G.upLevel(state, def.id);
    const maxed = lvl >= (def.max ?? 1);
    const available = G.upAvailable(state, def.id);
    const cost = G.upCost(state, def.id);
    // Show a method once it can be bought or nearly afforded, and keep owned ones visible.
    card.hidden = !(lvl > 0 || (available && gte(scale(state.dust, 10), cost)));
    stat.textContent = def.max > 1 ? `Level ${lvl}` : maxed ? 'Owned' : '';
    buy.disabled = !available || !gte(state.dust, cost);
    buy.querySelector('small').textContent = maxed ? 'owned' : `${fmt(cost)} kg`;
    buy.firstChild.textContent = maxed ? 'Done' : 'Buy';
  });

  renderCondense();
  for (const r of featureRenders) r();
}

function renderCondense() {
  const desc = condenseCard.querySelector('.desc');
  const stat = condenseCard.querySelector('.stat');
  const methods = G.methodsOwned(state);
  const visible = state.unlocked.condense || methods >= 3;
  el.condense.hidden = !visible;
  if (!visible) return;
  condenseCard.classList.toggle('locked', !state.unlocked.condense);
  if (!state.unlocked.condense) {
    desc.textContent = `Own ${G.METHODS_TO_UNLOCK} different methods or collectors to unlock. You own ${methods}.`;
    stat.textContent = '';
    condenseBtn.disabled = true;
    condenseBtn.firstChild.textContent = 'Locked';
    condenseBtn.querySelector('small').textContent = '';
    return;
  }
  const gain = G.condenseGain(state);
  desc.innerHTML = '';
  desc.append(
    `Squeeze this run into grains. Each grain adds +100% to all dust. You have `,
  );
  const gr = document.createElement('span');
  gr.className = 'grains';
  gr.textContent = `${fmtInt(state.grains)} grains (x${fmt(G.grainMult(state), 2)})`;
  desc.append(gr, '.');
  stat.textContent = `One grain per factor of ten above ${fmt(G.CONDENSE_AT)} kg gathered in one run. This run: ${fmt(state.run)} kg.`;
  const ok = G.canCondense(state);
  condenseBtn.disabled = !ok;
  condenseBtn.firstChild.textContent = ok ? `Condense for ${fmtInt(gain)} grains` : 'Condense';
  condenseBtn.querySelector('small').textContent = '';
}

// ---- Loop ------------------------------------------------------------------

let last = performance.now();
let lastRender = 0;
let lastSave = last;

function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  if (dt > 1) G.applyOffline(state, dt);
  else if (dt > 0) G.tick(state, dt);
  while (state.notes.length) toast(state.notes.shift());
  if (now - lastRender > 66) {
    lastRender = now;
    render();
  }
  if (now - lastSave > 5000) {
    lastSave = now;
    save();
  }
  requestAnimationFrame(frame);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) save();
});
addEventListener('pagehide', save);

$('reset').addEventListener('click', () => {
  if (!confirm('Erase all progress and start again?')) return;
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to clear.
  }
  state = G.newState();
});

// Handle for poking at the game from the console while iterating.
window.game = { G, get state() { return state; } };

render();
requestAnimationFrame(frame);
