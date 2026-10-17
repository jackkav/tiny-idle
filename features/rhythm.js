// Active play and return moments.
// 1. Drifting speck: a rare event the player can catch for a random effect.
// 2. Heat: steady tapping raises tap value. It decays when the player stops.
// 3. Return moments: offline efficiency curve, welcome-back panel, return bonus.
// All rules are pure functions. The random function is always passed in.
import * as G from '../game.js';
import * as N from '../num.js';
import * as SC from '../scale.js';
import { mountRhythm, RHYTHM_CSS } from './rhythm-ui.js';

// ---- constants (no fixed kg amounts here: payouts scale with production) ----

// Drifting speck
export const EVENT_FIRST_WAIT_S = [25, 50]; // first speck of a new game comes early
export const EVENT_WAIT_S = [60, 180]; // gap between specks
export const EVENT_LIFE_S = 10; // how long a speck stays
export const EVENT_FADE_S = 1.5; // last seconds of a speck fade out (ui)
export const LIVE_MAX_DT = 1.5; // a bigger step is not live play

// Catch effects. Weights are relative. Pick uses one random draw.
export const EFFECT_WEIGHTS = { burst: 45, frenzy: 30, tapfrenzy: 22, jackpot: 3 };
export const BURST_SECONDS = 45; // burst = this many seconds of production
export const BURST_FLOOR_TAPS = 25; // but never less than this many taps
export const JACKPOT_SECONDS = 600;
export const JACKPOT_FLOOR_TAPS = 500;
export const FRENZY_MULT = 7;
export const FRENZY_S = 20;
export const TAP_FRENZY_MULT = 20;
export const TAP_FRENZY_S = 15;

// Heat
export const HEAT_PER_TAP = 0.04; // 25 taps from cold to full
export const HEAT_DECAY_PER_S = 0.12; // breakeven is 3 taps per second
export const HEAT_BONUS = 1.5; // full heat makes taps worth 1 + 1.5 = x2.5

// Offline efficiency. Rate applies to the time inside each band.
export const OFFLINE_BANDS = [
  { until: 2 * 3600, rate: 1 },
  { until: 6 * 3600, rate: 0.6 },
  { until: 12 * 3600, rate: 0.3 },
];

// Return moments
export const TOAST_MIN_AWAY_S = 30; // short absence: a toast
export const PANEL_MIN_AWAY_S = 5 * 60; // longer absence: the welcome panel
export const RETURN_MULT = 2;
export const RETURN_BONUS = [ // ascending by minAway
  { minAway: 15 * 60, seconds: 30 },
  { minAway: 3600, seconds: 60 },
  { minAway: 4 * 3600, seconds: 90 },
  { minAway: 8 * 3600, seconds: 120 },
];

// Longest time an effect timer can have. Used to check saved data.
const FX_LIMIT_S = 600;

export const FX_INFO = {
  frenzy: { name: 'Frenzy', mult: FRENZY_MULT, seconds: FRENZY_S },
  tapfrenzy: { name: 'Tap frenzy', mult: TAP_FRENZY_MULT, seconds: TAP_FRENZY_S },
  charge: { name: 'Charged', mult: RETURN_MULT, seconds: 0 },
};
const FRENZY_NUM = N.n(FRENZY_MULT);
const TAP_FRENZY_NUM = N.n(TAP_FRENZY_MULT);
const RETURN_NUM = N.n(RETURN_MULT);

// ---- state ------------------------------------------------------------------

export const initState = () => ({
  heat: 0, // 0 to 1
  wait: null, // seconds until the next speck. null means roll on the first live step
  seq: 0, // number of specks made. Used as id.
  caught: 0,
  missed: 0,
  fx: { frenzy: 0, tapfrenzy: 0, charge: 0 }, // seconds left
  ev: null, // active speck { id, ttl, life, ang, dist }. Not saved.
  hidden: false, // tab hidden. Not saved.
  catchingUp: false, // offline steps are running. Not saved.
  before: null, // dust before offline steps. Not saved.
  welcome: null, // welcome-back data waiting for the player. Not saved.
});

const clamp = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);

export function toSaveState(fs) {
  return { heat: fs.heat, wait: fs.wait, seq: fs.seq, caught: fs.caught, missed: fs.missed, fx: { ...fs.fx } };
}

export function fromSaveState(saved) {
  const fs = initState();
  if (!saved || typeof saved !== 'object') return fs;
  fs.heat = clamp(saved.heat, 0, 1, 0);
  fs.wait = clamp(saved.wait, 0, EVENT_WAIT_S[1], null);
  fs.seq = Math.max(0, saved.seq | 0);
  fs.caught = Math.max(0, saved.caught | 0);
  fs.missed = Math.max(0, saved.missed | 0);
  for (const k of Object.keys(fs.fx)) fs.fx[k] = clamp(saved.fx?.[k], 0, FX_LIMIT_S, 0);
  return fs;
}

// ---- heat -------------------------------------------------------------------

export const heatMultiplier = (heat) => 1 + HEAT_BONUS * heat;

export function addHeat(fs) {
  fs.heat = Math.min(1, fs.heat + HEAT_PER_TAP);
}

// ---- effects ----------------------------------------------------------------

export const fxActive = (fs, id) => fs.fx[id] > 0;

// Same effect again refreshes the timer to the longer value. It never doubles the
// multiplier. Different effects multiply with each other.
export function addEffect(fs, id, seconds) {
  if (!FX_INFO[id] || !(seconds > 0)) return;
  fs.fx[id] = Math.min(FX_LIMIT_S, Math.max(fs.fx[id], seconds));
}

export function fxGlobalMult(fs) {
  let m = N.ONE;
  if (fxActive(fs, 'frenzy')) m = N.mul(m, FRENZY_NUM);
  if (fxActive(fs, 'charge')) m = N.mul(m, RETURN_NUM);
  return m;
}

export function fxTapMult(fs) {
  const heat = N.n(heatMultiplier(fs.heat));
  return fxActive(fs, 'tapfrenzy') ? N.mul(heat, TAP_FRENZY_NUM) : heat;
}

// ---- drifting speck ---------------------------------------------------------

const between = (range, rng) => range[0] + rng() * (range[1] - range[0]);

export const rollWait = (fs, rng) => between(fs.seq === 0 ? EVENT_FIRST_WAIT_S : EVENT_WAIT_S, rng);

// One step of heat decay, effect timers and the speck scheduler.
// A speck only comes in live play: not while the tab is hidden, not in offline steps.
export function stepRhythm(fs, dt, rng) {
  if (!(dt > 0)) return;
  fs.heat = Math.max(0, fs.heat - HEAT_DECAY_PER_S * dt);
  for (const k of Object.keys(fs.fx)) fs.fx[k] = Math.max(0, fs.fx[k] - dt);
  if (fs.hidden || fs.catchingUp || dt > LIVE_MAX_DT) {
    fs.ev = null;
    return;
  }
  if (fs.ev) {
    fs.ev.ttl -= dt;
    if (fs.ev.ttl <= 0) {
      fs.ev = null;
      fs.missed += 1;
      fs.wait = rollWait(fs, rng);
    }
    return;
  }
  if (fs.wait === null) fs.wait = rollWait(fs, rng);
  fs.wait -= dt;
  if (fs.wait <= 0) {
    fs.seq += 1;
    fs.wait = null;
    // ang is the angle around the tap target. dist 0 is near its edge, 1 is far.
    fs.ev = { id: fs.seq, ttl: EVENT_LIFE_S, life: EVENT_LIFE_S, ang: rng() * 2 * Math.PI, dist: rng() };
  }
}

export function setHidden(fs, hidden) {
  fs.hidden = !!hidden;
  if (fs.hidden) fs.ev = null;
}

export function pickEffect(rng) {
  const entries = Object.entries(EFFECT_WEIGHTS);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rng() * total;
  for (const [id, w] of entries) {
    r -= w;
    if (r < 0) return id;
  }
  return entries[0][0];
}

// Dust for a number of seconds of production, never below a number of taps.
export function payout(s, seconds, floorTaps) {
  const byProduction = N.scale(G.dustPerSecond(s), seconds);
  const byTaps = N.scale(G.tapValue(s), floorTaps);
  return N.cmp(byProduction, byTaps) >= 0 ? byProduction : byTaps;
}

// Catch the active speck. Returns { kind, amount, text } or null.
export function catchSpeck(s, rng) {
  const fs = s.f.rhythm;
  if (!fs.ev) return null;
  fs.ev = null;
  fs.caught += 1;
  fs.wait = rollWait(fs, rng);
  const kind = pickEffect(rng);
  let text;
  let amount = N.ZERO;
  if (kind === 'burst' || kind === 'jackpot') {
    const jack = kind === 'jackpot';
    amount = payout(s, jack ? JACKPOT_SECONDS : BURST_SECONDS, jack ? JACKPOT_FLOOR_TAPS : BURST_FLOOR_TAPS);
    G.gain(s, amount);
    text = `${jack ? 'Jackpot' : 'Lucky speck'}. +${N.fmt(amount)} kg.`;
  } else {
    const info = FX_INFO[kind];
    addEffect(fs, kind, info.seconds);
    text = `${info.name}. ${kind === 'frenzy' ? 'All dust' : 'Taps'} x${info.mult} for ${info.seconds} s.`;
  }
  G.notify(s, text);
  return { kind, amount, text };
}

// ---- offline ----------------------------------------------------------------

// Seconds of work that count for a time away. Never more than the time away.
// The last band rate holds past its end.
export function offlineEffective(seconds) {
  if (!(seconds > 0)) return 0;
  let total = 0;
  let from = 0;
  OFFLINE_BANDS.forEach((band, i) => {
    const to = i === OFFLINE_BANDS.length - 1 ? Infinity : band.until;
    if (seconds > from) total += (Math.min(seconds, to) - from) * band.rate;
    from = band.until;
  });
  return Math.min(total, seconds);
}

export function returnBonusSeconds(away) {
  let secs = 0;
  for (const t of RETURN_BONUS) if (away >= t.minAway) secs = t.seconds;
  return secs;
}

export function fmtDuration(s) {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// Data for the welcome-back panel. Numbers stay as Num. This object is never saved.
// Spending in offline steps (automation) lowers dust, so gained is measured on run.
export function buildWelcome(away, effective, before, after) {
  const gained = N.cmp(after.run, before.run) > 0 ? N.sub(after.run, before.run) : after.run;
  return {
    away,
    effective,
    gained,
    dustBefore: before.dust,
    dustAfter: after.dust,
    bonusSeconds: returnBonusSeconds(away),
  };
}

const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1);

// Plain text for the panel. Pure, so tests can check it.
export function welcomeText(w) {
  const lines = [`You were away ${fmtDuration(w.away)}.`];
  if (w.effective < w.away - 1) {
    lines.push(`It counted as ${fmtDuration(w.effective)} of work. Time after the first 2 hours counts for less.`);
  }
  if (N.cmp(w.gained, N.ZERO) > 0) {
    lines.push(`Dust gathered: +${N.fmt(w.gained)} kg.`);
    lines.push(`That is ${lower(SC.describeScale(w.gained))}`);
  } else {
    lines.push('No dust gathered. Buy a collector to work while you are away.');
  }
  const lb = N.log10(w.dustBefore);
  const la = N.log10(w.dustAfter);
  if (Number.isFinite(lb) && la > lb) {
    const d = la - lb;
    if (d >= 1) lines.push(`Your pile grew by ${d.toFixed(1)} orders of magnitude.`);
    else if (d >= 0.05) lines.push(`Your pile grew by ${Math.round((10 ** d - 1) * 100)} percent.`);
    const crossed = (SC.LANDMARKS ?? []).filter((l) => l.exp > lb && l.exp <= la);
    if (crossed.length) lines.push(`Your pile passed the mass of ${crossed[crossed.length - 1].name}.`);
  }
  const bonus = w.bonusSeconds > 0
    ? `Charged reservoir: all dust x${RETURN_MULT} for ${w.bonusSeconds} s.`
    : null;
  return { title: 'Welcome back', lines, bonus };
}

// The player takes the welcome panel. The return bonus starts now.
export function claimWelcome(s) {
  const fs = s.f.rhythm;
  const w = fs.welcome;
  if (!w) return false;
  fs.welcome = null;
  addEffect(fs, 'charge', w.bonusSeconds);
  return true;
}

// ---- document title while the tab is hidden ---------------------------------

// Guess the dust after a hidden time. Lower tiers keep growing, so this is a floor.
export function projectedDust(s, hiddenSeconds) {
  return N.add(s.dust, N.scale(G.dustPerSecond(s), offlineEffective(hiddenSeconds)));
}

export const titleText = (dust) => `~${N.fmt(dust)} kg - Smallest Thing`;

// ---- registration -----------------------------------------------------------

let rng = Math.random;
export const setRng = (fn) => {
  rng = fn;
};

G.registerFeature({
  id: 'rhythm',
  init: initState,
  toSave: toSaveState,
  fromSave: fromSaveState,
  tick: (s, dt) => stepRhythm(s.f.rhythm, dt, rng),
  onTap: (s) => addHeat(s.f.rhythm),
  globalMult: (s) => fxGlobalMult(s.f.rhythm),
  tapMult: (s) => fxTapMult(s.f.rhythm),
  offline(s, away) {
    const fs = s.f.rhythm;
    fs.catchingUp = true;
    fs.before = { run: s.run, dust: s.dust };
    return offlineEffective(away);
  },
  onReturn(s, away, effective) {
    const fs = s.f.rhythm;
    fs.catchingUp = false;
    const before = fs.before ?? { run: s.run, dust: s.dust };
    fs.before = null;
    if (away < TOAST_MIN_AWAY_S) return;
    const w = buildWelcome(away, effective, before, { run: s.run, dust: s.dust });
    if (away >= PANEL_MIN_AWAY_S) fs.welcome = w;
    else G.notify(s, `Back after ${fmtDuration(away)}. +${N.fmt(w.gained)} kg.`);
  },
  ui: {
    order: 10,
    css: RHYTHM_CSS,
    mount: (root, ctx) => mountRhythm(root, ctx, {
      rng: () => rng(),
      catchSpeck, claimWelcome, setHidden, welcomeText, projectedDust, titleText,
      heatMultiplier, FX_INFO, EVENT_FADE_S,
    }),
  },
});
