// DOM for the rhythm feature. Only functions here. Nothing runs on import,
// so tests can import rhythm.js in Node. Rules live in rhythm.js.

export const RHYTHM_CSS = `
#tap { box-shadow: 0 0 calc(var(--heat, 0) * 26px) calc(var(--heat, 0) * 3px) rgba(255, 212, 121, calc(var(--heat, 0) * 0.45)); }
#feature-rhythm { min-height: 46px; }
.rh-row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; justify-content: center; min-height: 44px; font-size: 13px; color: var(--muted); }
.rh-heat { display: flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }
.rh-bar { width: 84px; height: 4px; background: var(--line); border-radius: 2px; overflow: hidden; }
.rh-bar > i { display: block; height: 100%; width: 0; background: var(--accent); }
.rh-chip { padding: 3px 10px; border: 1px solid var(--accent); border-radius: 999px; color: var(--accent); font-variant-numeric: tabular-nums; }
.rh-speck { position: absolute; z-index: 3; width: 44px; height: 44px; margin: 0; padding: 0; border: 0; background: none; display: grid; place-items: center; transform: translate(-50%, -50%); cursor: pointer; touch-action: manipulation; }
.rh-speck:focus-visible { outline: 2px solid var(--accent); border-radius: 50%; }
.rh-core { display: block; width: 14px; height: 14px; border-radius: 50%; background: #bfeaff; box-shadow: 0 0 14px 4px rgba(143, 216, 255, 0.7); animation: rh-drift 3s ease-in-out infinite alternate; }
@keyframes rh-drift { from { transform: translate(-5px, -3px); } to { transform: translate(5px, 4px) scale(1.15); } }
.rh-back { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: var(--gutter); background: rgba(5, 7, 10, 0.72); }
.rh-card { width: min(100%, 420px); background: var(--panel); border: 1px solid var(--accent); border-radius: 16px; padding: 20px; box-shadow: 0 0 40px rgba(255, 212, 121, 0.18); animation: rh-in 260ms ease-out; }
.rh-card h2 { margin: 0 0 12px; color: var(--accent); font-size: 15px; }
.rh-card p { margin: 0 0 8px; }
.rh-card .rh-bonus { color: var(--ok); font-weight: 600; margin-top: 12px; }
.rh-card .buy { width: 100%; margin-top: 14px; }
@keyframes rh-in { from { opacity: 0; transform: translateY(10px) scale(0.97); } to { opacity: 1; transform: none; } }
html[data-motion="reduce"] .rh-core, html[data-motion="reduce"] .rh-card { animation: none; }
@media (prefers-reduced-motion: reduce) {
  .rh-core, .rh-card { animation: none; }
}
`;

const FLOAT_LABEL = { burst: 'Lucky', jackpot: 'Jackpot', frenzy: 'Frenzy', tapfrenzy: 'Tap frenzy' };
const TITLE_EVERY_MS = 30000;

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// R is the rules from rhythm.js. Returns the render function.
export function mountRhythm(root, ctx, R) {
  const getFs = () => ctx.getState().f.rhythm;

  // Heat and effects row, just under the tap target.
  const row = el('div', 'rh-row');
  const heat = el('div', 'rh-heat');
  const heatText = el('span');
  const bar = el('span', 'rh-bar');
  const barFill = document.createElement('i');
  bar.append(barFill);
  heat.append(heatText, bar);
  row.append(heat);
  const chips = {};
  for (const id of ['frenzy', 'tapfrenzy', 'charge']) {
    chips[id] = el('span', 'rh-chip');
    chips[id].hidden = true;
    row.append(chips[id]);
  }
  root.append(row);

  // Drifting speck. It sits in the tap zone, around the tap target.
  const zone = ctx.dom.tap.parentElement;
  const speck = el('button', 'rh-speck');
  speck.type = 'button';
  speck.setAttribute('aria-label', 'Drifting speck. Catch it for a bonus.');
  speck.append(el('span', 'rh-core'));
  speck.hidden = true;
  zone.append(speck);
  let shownId = 0;

  function catchIt(e) {
    e.preventDefault();
    const s = ctx.getState();
    const r = R.catchSpeck(s, R.rng);
    if (!r) return;
    speck.hidden = true;
    const box = speck.getBoundingClientRect();
    const f = el('span', 'floater', FLOAT_LABEL[r.kind] ?? 'Caught');
    f.style.left = `${box.left + box.width / 2}px`;
    f.style.top = `${box.top + box.height / 2}px`;
    ctx.dom.floaters.append(f);
    setTimeout(() => f.remove(), 900);
  }
  speck.addEventListener('pointerdown', catchIt);
  speck.addEventListener('click', catchIt);

  function place(ev) {
    const z = zone.getBoundingClientRect();
    const b = ctx.dom.tap.getBoundingClientRect();
    const r = b.width / 2;
    const cx = b.left - z.left + r;
    const cy = b.top - z.top + b.height / 2;
    const rx = r * (1.15 + 0.85 * ev.dist);
    const ry = r * (1.05 + 0.25 * ev.dist);
    const x = Math.min(z.width - 22, Math.max(22, cx + Math.cos(ev.ang) * rx));
    speck.style.left = `${x.toFixed(1)}px`;
    const y = Math.min(z.height - 22, Math.max(22, cy + Math.sin(ev.ang) * ry));
    speck.style.top = `${y.toFixed(1)}px`;
  }

  // Welcome-back panel.
  const back = el('div', 'rh-back');
  back.hidden = true;
  const card = el('div', 'rh-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'rh-title');
  const title = el('h2');
  title.id = 'rh-title';
  const lines = el('div');
  const bonus = el('div', 'rh-bonus');
  const go = el('button', 'buy', 'Collect');
  go.type = 'button';
  card.append(title, lines, bonus, go);
  back.append(card);
  ctx.dom.body.append(back);
  let shownWelcome = null;
  let returnFocus = null;

  function close() {
    R.claimWelcome(ctx.getState());
    ctx.save();
  }
  go.addEventListener('click', close);
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back) close();
  });
  // Listen on the document, in the capture phase, so Escape and the focus trap still work after
  // a click on the card text moved focus to the body, and no key reaches the game behind.
  document.addEventListener('keydown', (e) => {
    if (back.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab' || !card.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      go.focus();
    }
  }, true);

  function showWelcome(w) {
    const t = R.welcomeText(w);
    title.textContent = t.title;
    lines.replaceChildren(...t.lines.map((l) => el('p', '', l)));
    bonus.textContent = t.bonus ?? '';
    bonus.hidden = !t.bonus;
    go.textContent = t.bonus ? 'Collect and go' : 'Continue';
    returnFocus = document.activeElement;
    back.hidden = false;
    go.focus();
  }

  // Tab hidden: tell the rules and show dust in the document title.
  let base = document.title;
  let hiddenAt = 0;
  let titleTimer = null;
  const setTitle = () => {
    document.title = R.titleText(R.projectedDust(ctx.getState(), (Date.now() - hiddenAt) / 1000));
  };
  function onVisibility() {
    R.setHidden(getFs(), document.hidden);
    if (document.hidden) {
      if (titleTimer) return;
      base = document.title;
      hiddenAt = Date.now();
      setTitle();
      titleTimer = setInterval(setTitle, TITLE_EVERY_MS);
    } else if (titleTimer) {
      clearInterval(titleTimer);
      titleTimer = null;
      document.title = base;
    }
  }
  document.addEventListener('visibilitychange', onVisibility);
  if (document.hidden) onVisibility();

  return (s) => {
    const fs = s.f.rhythm;
    if (!document.hidden) R.setHidden(fs, false); // state is replaced on reset
    // heat
    ctx.dom.tap.style.setProperty('--heat', fs.heat.toFixed(2));
    const cold = fs.heat < 0.02;
    heat.style.opacity = cold && s.taps >= 200 ? '0' : '1';
    heatText.textContent = cold ? 'Tap steadily to build rhythm' : `Rhythm x${R.heatMultiplier(fs.heat).toFixed(1)}`;
    bar.hidden = cold;
    barFill.style.width = `${(fs.heat * 100).toFixed(0)}%`;
    // effects
    for (const [id, chip] of Object.entries(chips)) {
      const left = fs.fx[id];
      chip.hidden = !(left > 0);
      if (left > 0) {
        const text = `${R.FX_INFO[id].name} x${R.FX_INFO[id].mult} ${Math.ceil(left)}s`;
        if (chip.textContent !== text) chip.textContent = text;
      }
    }
    // speck
    const ev = fs.ev;
    if (!ev) {
      speck.hidden = true;
      shownId = 0;
    } else {
      if (ev.id !== shownId) {
        shownId = ev.id;
        speck.hidden = false;
      }
      place(ev);
      speck.style.opacity = ev.ttl < R.EVENT_FADE_S ? Math.max(0, ev.ttl / R.EVENT_FADE_S).toFixed(2) : '1';
    }
    // welcome panel
    if (fs.welcome !== shownWelcome) {
      shownWelcome = fs.welcome;
      if (shownWelcome) showWelcome(shownWelcome);
      else {
        back.hidden = true;
        if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
      }
    }
  };
}
