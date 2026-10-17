// Onboarding hints, settings panel, sound, tap juice and page color.
// Rules live in ux-logic.js. This file only touches the DOM.
import { registerFeature } from '../game.js';
import { setNotation, fmt as fmtNum, n } from '../num.js';
import { barFraction } from '../scale.js';
import {
  SETTINGS_KEY, defaultSettings, parseSettings, isMutedByUrl, soundOn, encodeSave, decodeSave,
  hintInit, hintToSave, hintFromSave, advanceHints, currentHint, bgForFraction, floaterLook,
} from './ux-logic.js';

const hasDom = typeof document !== 'undefined';
const $ = (id) => document.getElementById(id);

// The tap hook and the click hook read the current settings from here.
const runtime = { settings: defaultSettings(false), tapFx: null, search: '' };

function osReducedMotion() {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function loadSettings() {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY), osReducedMotion());
  } catch {
    return defaultSettings(osReducedMotion());
  }
}

function storeSettings() {
  try {
    // Keep the motion choice only when it differs from the OS setting, so a later OS change still applies.
    const out = { ...runtime.settings };
    if (out.reducedMotion === osReducedMotion()) delete out.reducedMotion;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(out));
  } catch {
  }
}

function applySettings() {
  setNotation(runtime.settings.notation);
  document.documentElement.dataset.motion = runtime.settings.reducedMotion ? 'reduce' : 'full';
}

// Settings apply at load, before the first render.
if (hasDom) {
  runtime.settings = loadSettings();
  runtime.search = location.search;
  applySettings();
}

// ---------- sound ----------

function makeAudio() {
  let ac = null;
  let lastTap = 0;
  const context = () => {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try {
        ac = new AC();
      } catch {
        return null;
      }
    }
    if (ac.state === 'suspended') ac.resume?.();
    return ac;
  };
  const note = (freq, delay, dur, vol) => {
    const c = context();
    if (!c) return;
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  };
  return {
    prime: context,
    tap() {
      const now = performance.now();
      if (now - lastTap < 60) return;
      lastTap = now;
      note(520 + Math.random() * 120, 0, 0.06, 0.035);
    },
    buy() {
      note(660, 0, 0.08, 0.04);
      note(880, 0.07, 0.1, 0.04);
    },
  };
}

// ---------- mount ----------

function mount(root, ctx) {
  const dlg = $('settings');
  const hintEl = $('hint');
  const speck = $('speck');
  if (!dlg || !hintEl || !speck) return undefined; // markup is missing, so do nothing
  const audio = makeAudio();
  const settings = runtime.settings;
  const mutedByUrl = isMutedByUrl(runtime.search);
  const audible = () => soundOn(runtime.settings, runtime.search);

  // Audio may only start after a user gesture.
  const prime = () => {
    if (audible()) audio.prime();
  };
  document.addEventListener('pointerdown', prime, { passive: true });
  document.addEventListener('keydown', prime);

  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('#gens .buy, #ups .buy, #condense-body .buy');
    if (b && audible()) audio.buy();
  });

  // Tap feedback. The core calls onTap after each tap.
  runtime.tapFx = () => {
    if (audible()) audio.tap();
    if (runtime.settings.reducedMotion) return;
    speck.animate?.(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.9)' }, { transform: 'scale(1)' }],
      { duration: 170, easing: 'ease-out' },
    );
    ctx.dom.tap.animate?.(
      [{ boxShadow: '0 0 0 0 rgba(255, 212, 121, 0.35)' }, { boxShadow: '0 0 0 16px rgba(255, 212, 121, 0)' }],
      { duration: 320, easing: 'ease-out' },
    );
  };

  // Each floater drifts in its own way. The core adds the element. We only set style values.
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver((list) => {
      for (const rec of list) {
        for (const el of rec.addedNodes) {
          if (!el.classList?.contains('floater')) continue;
          const look = floaterLook(Math.random, ctx.getState().taps);
          el.style.setProperty('--dx', `${look.dx}px`);
          el.style.setProperty('--rise', `${look.rise}px`);
          el.style.fontSize = `${look.size}px`;
          if (look.big) el.classList.add('big-floater');
        }
      }
    }).observe(ctx.dom.floaters, { childList: true });
  }

  // Settings panel.
  const notation = $('set-notation');
  const example = $('set-notation-example');
  const sound = $('set-sound');
  const soundNote = $('set-sound-note');
  const motion = $('set-motion');
  const hints = $('set-hints');
  const text = $('save-text');
  const msg = $('save-msg');
  const say = (t) => {
    msg.textContent = t;
  };

  const showExample = () => {
    example.textContent = `Example: ${fmtNum(n(1.234e-101), 2, notation.value)} kg and ${fmtNum(n(5.6e37), 2, notation.value)} kg`;
  };
  const sync = () => {
    notation.value = settings.notation;
    sound.checked = settings.sound && !mutedByUrl;
    sound.disabled = mutedByUrl;
    soundNote.hidden = !mutedByUrl;
    motion.checked = settings.reducedMotion;
    hints.checked = settings.hints;
    showExample();
  };
  sync();

  $('gear').addEventListener('click', () => {
    sync();
    say('');
    if (dlg.showModal) dlg.showModal();
    else dlg.setAttribute('open', '');
  });
  const close = () => {
    if (dlg.close) dlg.close();
    else dlg.removeAttribute('open');
  };
  $('settings-close').addEventListener('click', close);
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close();
  });

  notation.addEventListener('change', () => {
    settings.notation = notation.value;
    applySettings();
    showExample();
    storeSettings();
  });
  sound.addEventListener('change', () => {
    settings.sound = sound.checked;
    storeSettings();
    if (sound.checked && audible()) {
      audio.prime();
      audio.buy();
    }
  });
  motion.addEventListener('change', () => {
    settings.reducedMotion = motion.checked;
    applySettings();
    storeSettings();
  });
  hints.addEventListener('change', () => {
    settings.hints = hints.checked;
    storeSettings();
  });

  $('save-export').addEventListener('click', () => {
    const s = ctx.getState();
    s.savedAt = Date.now();
    text.value = encodeSave(ctx.G.toSave(s));
    text.focus();
    text.select();
    const done = () => say('Save string is ready and copied. Keep it in a safe place.');
    const fail = () => say('Save string is ready. Copy the text above.');
    try {
      navigator.clipboard.writeText(text.value).then(done, fail);
    } catch {
      fail();
    }
  });
  $('save-import').addEventListener('click', () => {
    const r = decodeSave(text.value);
    if (!r.ok) {
      say(r.error);
      return;
    }
    if (!confirm('Replace your current progress with this save?')) return;
    const next = ctx.G.fromSave(r.data);
    next.savedAt = Date.now();
    ctx.replaceState(next);
    ctx.save();
    text.value = '';
    say('Save imported.');
  });

  // Runs about 15 times per second.
  const secUps = $('sec-ups');
  const upsList = $('ups');
  let lastHint = null;
  let lastKey = -1;
  return (s) => {
    const fs = s.f.ux;
    advanceHints(fs, s);
    const t = runtime.settings.hints ? currentHint(fs, s, ctx.fmt) : '';
    if (t !== lastHint) {
      lastHint = t;
      hintEl.textContent = t;
      hintEl.hidden = !t;
    }
    // Hide the Methods header until a method card is visible. Do not show an empty section.
    if (secUps && upsList) secUps.hidden = !Array.from(upsList.children).some((c) => !c.hidden);

    const theme = bgForFraction(barFraction(s.dust));
    if (theme.key !== lastKey) {
      lastKey = theme.key;
      const st = document.documentElement.style;
      st.setProperty('--bg', theme.bg);
      st.setProperty('--panel', theme.panel);
      st.setProperty('--line', theme.line);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.bg);
    }
  };
}

registerFeature({
  id: 'ux',
  init: hintInit,
  toSave: hintToSave,
  fromSave: hintFromSave,
  onTap(s, value) {
    runtime.tapFx?.(s, value);
  },
  ui: hasDom ? { order: 90, mount } : undefined,
});
