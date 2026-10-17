// Pure rules for onboarding, settings, save strings and theme color.
// No DOM here, so tests can call every function.
import * as G from '../game.js';
import { gte } from '../num.js';

// ---------- settings ----------

export const SETTINGS_KEY = 'smallest-thing-settings-v1';
export const NOTATION_MODES = ['sci', 'eng', 'words'];

export const defaultSettings = (osReducedMotion = false) => ({
  notation: 'sci',
  sound: false,
  reducedMotion: !!osReducedMotion,
  hints: true,
});

// Never trust stored text. Any wrong field falls back to its default.
export function parseSettings(raw, osReducedMotion = false) {
  const out = defaultSettings(osReducedMotion);
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return out;
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  if (NOTATION_MODES.includes(data.notation)) out.notation = data.notation;
  if (typeof data.sound === 'boolean') out.sound = data.sound;
  if (typeof data.reducedMotion === 'boolean') out.reducedMotion = data.reducedMotion;
  if (typeof data.hints === 'boolean') out.hints = data.hints;
  return out;
}

// The URL parameter ?mute=1 always wins over the stored setting.
export const isMutedByUrl = (search) => /^(1|true)$/.test(new URLSearchParams(search || '').get('mute') ?? '');
export const soundOn = (settings, search) => settings.sound && !isMutedByUrl(search);

// ---------- save strings ----------

const MAX_SAVE_TEXT = 2_000_000;

export function encodeSave(saveObj) {
  const bytes = new TextEncoder().encode(JSON.stringify(saveObj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const isNumPair = (v) => Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]);

// Returns { ok: true, data } or { ok: false, error }. The error text is for the player.
export function decodeSave(text) {
  const clean = String(text ?? '').replace(/\s+/g, '');
  if (!clean) return { ok: false, error: 'Paste a save string first.' };
  if (clean.length > MAX_SAVE_TEXT) return { ok: false, error: 'This text is too long to be a save.' };
  let json;
  try {
    const bin = atob(clean);
    json = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return { ok: false, error: 'This is not a save string. The text is damaged or incomplete.' };
  }
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, error: 'This is not a save string. It does not hold save data.' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'This is not a save string. It does not hold save data.' };
  }
  if (data.v !== 1) return { ok: false, error: 'This save has an unknown version.' };
  if (!isNumPair(data.dust) || !Array.isArray(data.gens)) {
    return { ok: false, error: 'This save is missing data.' };
  }
  return { ok: true, data };
}

// ---------- onboarding hints ----------

const methodReady = (s) => G.UPGRADES.some((u) => G.upAvailable(s, u.id) && gte(s.dust, G.upCost(s, u.id)));
const anyMethod = (s) => Object.values(s.ups).some((l) => l > 0);

// Each step is shown in order. A step is done when its rule holds. A done step is stored and never returns.
export const HINT_STEPS = [
  {
    id: 'tap',
    done: (s) => s.taps >= 5,
    ready: () => true,
    text: () => 'Tap the speck.',
  },
  {
    id: 'collector',
    done: (s) => s.gens[0].bought > 0,
    ready: (s) => gte(s.dust, G.genCost(s, 0)),
    text: (s, fmt, ready) => (ready
      ? 'Buy a collector. It collects for you.'
      : `Keep tapping. A collector costs ${fmt(G.genCost(s, 0))} kg.`),
  },
  {
    id: 'method',
    done: anyMethod,
    ready: methodReady,
    text: (s, fmt, ready) => (ready
      ? 'Buy a method. A method makes your taps or your dust stronger.'
      : `Keep going. Your first method costs ${fmt(G.upCost(s, 'grip'))} kg.`),
  },
  {
    id: 'tier',
    done: (s) => s.gens[1].bought > 0,
    ready: (s) => gte(s.dust, G.genCost(s, 1)),
    text: (s, fmt, ready) => (ready
      ? 'Buy a higher collector. It makes the collector below it.'
      : `Save up for a higher collector. It costs ${fmt(G.genCost(s, 1))} kg.`),
  },
  {
    id: 'unlock',
    done: (s) => s.unlocked.condense,
    ready: () => true,
    text: (s) => `Own ${G.METHODS_TO_UNLOCK} different methods or collectors to unlock condensation. You own ${G.methodsOwned(s)}.`,
  },
  {
    id: 'condense',
    done: (s) => s.condenses > 0,
    ready: (s) => G.canCondense(s),
    text: (s, fmt, ready) => (ready
      ? 'Condense now. Dust, collectors and methods reset. You get grains. Each grain adds +100% to all dust.'
      : `Gather ${fmt(G.condenseAt(s))} kg in one run, then condense.`),
  },
];

export const HINT_IDS = HINT_STEPS.map((h) => h.id);

export const hintInit = () => ({ done: {} });
export const hintToSave = (fs) => ({ done: { ...fs.done } });
export function hintFromSave(saved) {
  const out = hintInit();
  const d = saved && typeof saved === 'object' ? saved.done : null;
  if (d && typeof d === 'object') for (const id of HINT_IDS) if (d[id] === true) out.done[id] = true;
  return out;
}

// Mark finished steps. A player who has condensed before skips all steps.
export function advanceHints(fs, s) {
  for (const step of HINT_STEPS) {
    if (fs.done[step.id]) continue;
    if (s.condenses > 0 || step.done(s)) fs.done[step.id] = true;
  }
}

// Returns the text of the first open step, or '' when all steps are done.
export function currentHint(fs, s, fmt) {
  const step = HINT_STEPS.find((h) => !fs.done[h.id]);
  if (!step) return '';
  return step.text(s, fmt, step.ready(s));
}

// ---------- theme color ----------

// The page moves from near-black blue toward a lighter violet as the player climbs the scale.
// Lightness has a cap, so text keeps a contrast of at least 4.5 to 1.
export function bgForFraction(frac) {
  const f = Math.round(Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 0)) * 100) / 100;
  const hue = Math.round(222 + 34 * f);
  const sat = 25;
  const l = 6 + 7 * f;
  const hsl = (light, s = sat) => `hsl(${hue} ${s}% ${light.toFixed(1)}%)`;
  return { bg: hsl(l), panel: hsl(l + 4.5), line: hsl(l + 11, 22), key: f };
}

// ---------- floaters ----------

// Gives each tap number its own drift. rand() returns a value in [0, 1).
export function floaterLook(rand, tapIndex) {
  const big = tapIndex > 0 && tapIndex % 10 === 0;
  return {
    dx: Math.round((rand() - 0.5) * 70),
    rise: Math.round(44 + rand() * 40 + (big ? 20 : 0)),
    size: big ? 17 : Math.round(12 + rand() * 3),
    big,
  };
}
