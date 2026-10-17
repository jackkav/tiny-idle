// Pacing simulator. Runs the real game rules (game.js and all features) with a simple bot.
// Use it as a module: simulate({ bot: 'best', minutes: 60 }). Or from the shell: node tools/sim.mjs --help
import * as G from '../game.js';
import * as N from '../num.js';
import '../features/index.js';

export const BOTS = ['greedy', 'best', 'idle'];

// Tap rate (taps per second) by time. Active players tap fast at the start of each run, then slowly.
const PROFILES = {
  greedy: ({ runT }) => (runT < 90 ? 3 : 0.5),
  best: ({ runT }) => (runT < 90 ? 3 : 0.5),
  idle: ({ runT }) => (runT < 60 ? 3 : 0),
};

const DEFAULTS = {
  bot: 'best',
  minutes: 60,
  dt: 0.25, // sim step in seconds
  decideEvery: 0.5, // the bot looks at the shop this often (seconds)
  horizon: 60, // best bot: seconds to look ahead when it measures the gain of a buy
  retargetEvery: 10, // best bot: seconds between target re-checks while it saves
  tapsPerSecond: null, // number or function({t, runT}) to override the profile
  minGain: 1, // condense when the payout is at least this many grains ...
  patience: 60, // ... and the payout has not grown for this many seconds (0 = condense at once)
  maxRuns: Infinity, // stop after this many condenses
  sampleEvery: 0, // seconds between trace samples (0 = no trace)
  stopAtFirstCondense: false,
  setup: null, // function(state) to change the start state, for example to give grains
};

const clone = (s) => {
  try {
    return structuredClone(s);
  } catch {
    return G.fromSave(JSON.parse(JSON.stringify(G.toSave(s))), 0);
  }
};

function shopItems(s) {
  const items = G.GENS.map((_, k) => ({ kind: 'gen', index: k, cost: G.genCost(s, k) }));
  for (const u of G.UPGRADES) if (G.upAvailable(s, u.id)) items.push({ kind: 'up', index: u.id, cost: G.upCost(s, u.id) });
  return items;
}

const buy = (s, it) => (it.kind === 'gen' ? G.buyGen(s, it.index) : G.buyUp(s, it.index));
const key = (it) => `${it.kind}:${it.index}`;
const affordable = (s, it) => N.cmp(s.dust, it.cost) >= 0;

// Dust per second over the next `horizon` seconds, taps included. Used by the best-buy score.
function incomeOver(s, horizon, tps) {
  const steps = 20;
  const c = clone(s);
  const start = c.dust;
  for (let i = 0; i < steps; i++) G.tick(c, horizon / steps);
  const made = N.add(N.sub(c.dust, start), N.scale(G.tapValue(c), tps * horizon));
  return N.scale(made, 1 / horizon);
}

// Score from DESIGN.md: cost / income + cost / (income + gain). Lowest wins.
export function buyScore(cost, income, gain) {
  const floor = N.scale(G.TAP, 1e-3);
  const inc = N.cmp(income, floor) > 0 ? income : floor;
  return N.add(N.div(cost, inc), N.div(cost, N.add(inc, gain)));
}

function pickBest(s, horizon, tps) {
  const base = incomeOver(s, horizon, tps);
  let best = null;
  for (const it of shopItems(s)) {
    const c = clone(s);
    c.dust = N.add(s.dust, it.cost);
    if (!buy(c, it)) continue;
    c.dust = s.dust;
    const inc = incomeOver(c, horizon, tps);
    const gain = N.sub(inc, base);
    const score = buyScore(it.cost, base, gain);
    if (!best || N.cmp(score, best.score) < 0) best = { ...it, score };
  }
  return best;
}

export function simulate(options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (!BOTS.includes(o.bot)) throw new Error(`unknown bot ${o.bot}`);
  const profile = typeof o.tapsPerSecond === 'function' ? o.tapsPerSecond
    : typeof o.tapsPerSecond === 'number' ? () => o.tapsPerSecond : PROFILES[o.bot];
  const s = G.newState(0);
  if (o.setup) o.setup(s);
  const end = o.minutes * 60;
  const runs = [];
  const trace = [];
  let t = 0;
  let cur = null;
  let tapAcc = 0;
  let nextDecide = 0;
  let nextSample = 0;
  let target = null;
  let targetAt = -Infinity;

  const startRun = () => {
    cur = { start: t, end: null, duration: null, firstBuy: null, tierTimes: G.GENS.map(() => null), unlockTime: null,
      thresholdTime: null, firstBuys: {}, buys: [], gain: 0, grainsAfter: null, peakRun: null };
    if (s.unlocked.condense) cur.unlockTime = 0;
    runs.push(cur);
    target = null;
  };
  startRun();

  const record = (it) => {
    const runT = t - cur.start;
    cur.buys.push(runT);
    if (cur.firstBuy === null) cur.firstBuy = runT;
    if (it.kind === 'gen' && cur.tierTimes[it.index] === null) cur.tierTimes[it.index] = runT;
    if (!(key(it) in cur.firstBuys)) cur.firstBuys[key(it)] = runT;
  };

  const shopGreedy = () => {
    for (let n = 0; n < 200; n++) {
      const cheap = shopItems(s).filter((it) => affordable(s, it)).sort((a, b) => N.cmp(a.cost, b.cost))[0];
      if (!cheap || !buy(s, cheap)) return;
      record(cheap);
    }
  };

  const shopBest = (tps) => {
    for (let n = 0; n < 200; n++) {
      if (!target || t - targetAt >= o.retargetEvery) {
        target = pickBest(s, o.horizon, tps);
        targetAt = t;
      }
      if (!target) return;
      // price may change with features: read it again
      const it = shopItems(s).find((x) => key(x) === key(target));
      if (!it) { target = null; continue; }
      if (!affordable(s, it) || !buy(s, it)) return;
      record(it);
      target = null;
    }
  };

  let lastGain = 0;
  let lastGainAt = 0;
  const wantCondense = () => {
    const g = N.toNumber(G.condenseGain(s));
    if (g !== lastGain) {
      lastGain = g;
      lastGainAt = t;
    }
    if (!G.canCondense(s)) return false;
    return g >= o.minGain && t - lastGainAt >= o.patience;
  };

  while (t < end) {
    const tps = profile({ t, runT: t - cur.start });
    tapAcc += tps * o.dt;
    while (tapAcc >= 1) {
      G.tap(s);
      tapAcc -= 1;
    }
    G.tick(s, o.dt);
    t += o.dt;
    const runT = t - cur.start;
    if (cur.unlockTime === null && s.unlocked.condense) cur.unlockTime = runT;
    if (cur.thresholdTime === null && G.canCondense(s)) cur.thresholdTime = runT;
    if (o.sampleEvery > 0 && t >= nextSample) {
      trace.push({ t, run: runs.length, runT, logRun: N.log10(s.run), grains: N.toNumber(s.grains) });
      nextSample += o.sampleEvery;
    }
    if (t >= nextDecide) {
      nextDecide += o.decideEvery;
      if (wantCondense()) {
        lastGain = 0;
        cur.gain = Math.round(N.toNumber(G.condenseGain(s)));
        cur.peakRun = N.log10(s.run);
        G.condense(s);
        cur.end = t;
        cur.duration = t - cur.start;
        cur.grainsAfter = Math.round(N.toNumber(s.grains));
        if (o.stopAtFirstCondense || runs.length >= o.maxRuns) break;
        startRun();
      }
      if (o.bot === 'greedy') shopGreedy();
      else shopBest(tps);
    }
  }
  if (cur.end === null) cur.peakRun = N.log10(s.run);

  for (const r of runs) {
    r.longestGap = longestGap(r.buys, Infinity);
    r.longestGap10 = longestGap(r.buys, 600);
  }
  return { options: o, runs, trace, totalTime: t, state: s };
}

// Longest wait between two purchases (or from run start to first purchase) inside the first `limit` seconds.
export function longestGap(buys, limit) {
  let prev = 0;
  let worst = 0;
  for (const b of buys) {
    if (b > limit) break;
    worst = Math.max(worst, b - prev);
    prev = b;
  }
  return worst;
}

const mmss = (sec) => {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '-';
  const whole = Math.round(sec);
  const m = Math.floor(whole / 60);
  return `${m}:${String(whole - m * 60).padStart(2, '0')}`;
};

export function report(result) {
  const { runs, options } = result;
  const lines = [];
  lines.push(`bot=${options.bot} minutes=${options.minutes} runs=${runs.length}`);
  const r1 = runs[0];
  lines.push(`first purchase ${mmss(r1.firstBuy)}  tier times ${r1.tierTimes.map(mmss).join(' ')}`);
  lines.push(`unlock ${mmss(r1.unlockTime)}  threshold ${mmss(r1.thresholdTime)}  longest gap in first 10 min ${r1.longestGap10.toFixed(1)}s`);
  lines.push('run  start   duration  unlock  threshold  gain  grains  longest gap  buys');
  runs.forEach((r, i) => {
    lines.push([
      String(i + 1).padStart(3), mmss(r.start).padStart(6), mmss(r.duration).padStart(9), mmss(r.unlockTime).padStart(7),
      mmss(r.thresholdTime).padStart(10), String(r.gain).padStart(5), String(r.grainsAfter === null ? '-' : Math.round(r.grainsAfter)).padStart(7),
      `${r.longestGap.toFixed(0)}s`.padStart(12), String(r.buys.length).padStart(5),
    ].join(' '));
  });
  return lines.join('\n');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[k] = v;
  }
  return out;
}

const HELP = `usage: node tools/sim.mjs [options]
  --bot greedy|best|idle|all   bot to run (default all)
  --minutes N                  game time to simulate (default 60)
  --taps N                     fixed taps per second (default: active 3 then 0.5, idle 3 then 0)
  --minGain N                  condense only when the payout is at least N grains (default 1)
  --patience S                 ... and the payout has not grown for S seconds (default 60, 0 = at once)
  --runs N                     stop after N condenses
  --decide S                   the bot checks the shop every S seconds (default 0.5)
  --trace N                    print log10(run) every N seconds
  --json                       print raw results as JSON`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) {
    console.log(HELP);
  } else {
    const bots = !a.bot || a.bot === 'all' ? BOTS : [a.bot];
    for (const bot of bots) {
      const opts = { bot };
      if (a.minutes) opts.minutes = Number(a.minutes);
      if (a.taps) opts.tapsPerSecond = Number(a.taps);
      if (a.minGain) opts.minGain = Number(a.minGain);
      if (a.patience) opts.patience = Number(a.patience);
      if (a.runs) opts.maxRuns = Number(a.runs);
      if (a.decide) opts.decideEvery = Number(a.decide);
      if (a.trace) opts.sampleEvery = Number(a.trace);
      const res = simulate(opts);
      if (a.json) console.log(JSON.stringify({ ...res, state: undefined }));
      else {
        console.log(report(res));
        for (const p of res.trace) console.log(`  t=${mmss(p.t)} run ${p.run} runT=${mmss(p.runT)} log10(run)=${p.logRun.toFixed(1)} grains=${p.grains}`);
        console.log('');
      }
    }
  }
}
