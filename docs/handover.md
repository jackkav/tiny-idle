# Handover

Read this first if you are taking over the project.

## What this is

Smallest Thing: an idle game. The player taps a speck worth 1e-101 kg and climbs toward the mass of the observable universe (about 1e53 kg). Live at https://jackkav.github.io/tiny-idle/ (repo `jackkav/tiny-idle`, deploys from `main`).

The concept (dust and air) is a placeholder. The numbers, the architecture and the layers are real. Re-theming is cheap: names live in `GENS`, `UPGRADES`, feature files and `scale.js`.

## Where things are

- Working copy: `~/git/tiny-idle` (main checkout). Seven feature branches `feat/*` and an `integration` branch have worktrees in `~/git/tiny-idle.worktrees/`. Check `git branch -a` and `git log --oneline main..integration` to see what is merged. When the integration work is on `main`, the worktrees and `feat/*` branches can be removed with `git worktree remove` and `git branch -d`.
- Layout, hooks and ownership: `AGENTS.md`, `DESIGN.md`. Decisions and reasons: `docs/decisions.md`.

## Run and test

```bash
cd ~/git/tiny-idle
python3 -m http.server 8000     # then open http://localhost:8000/?mute=1
node --test                     # all tests, about 3 seconds
node tools/sim.mjs --help       # pacing simulator
```

Use `?mute=1` when testing in a browser. In the browser console `window.game` exposes `G` (core), `state` and the features. Useful cheats: `game.state.dust = {m:1, e:-60}` (use `await import('./num.js')` and `N.n(1e-60)` for a safe value), `game.state.grains = ...`, `game.state.f.rhythm.wait = 0` (force a speck).

## State of the game

Working: tap, six collectors, seven methods, condense (layer 2, grains), compaction (layer 3, pebble lattice), autobuyers, challenges and run focus, landmarks and achievements, rare specks, tap heat, offline progress with a welcome panel, hints, settings, export and import, notation modes, optional sound.

Tests: all pass (`node --test`). They include pacing bands that run the whole game in a simulator.

Pacing (simulated active player): first purchase 4 s, condense unlock about 5:30, first condense about 8 to 10 minutes, later runs about 6 to 9 minutes, first compaction roughly 35 minutes in the earlier layer-3 test (before the economy rebalance, so recheck).

## Known gaps and open questions

1. **Nobody has played it on a real device.** UI was checked in a desktop browser pane and by two code reviews, not on a phone. Check touch targets, the drifting speck, the welcome panel, dialog focus, sound.
2. **Active and idle play converge.** After about 3 minutes taps are a small share of income (economy agent finding). Tap heat and specks help but do not change this. Decide whether active play needs more reward later in a run.
3. **Layer 3 balance is rough.** Dense and Wide give 2^score and can get huge. The 100-grain unlock was set before the economy rebalance. Run the simulator with a bot that uses the lattice, then retune `COMPACT_AT_GRAINS`, `COMPACT_GROWTH`, `PEBBLE_*` and the kind factors.
4. **The simulator bots do not use feature controls** (autobuyer switches, focus picks, challenges, the lattice). Pacing for those parts is unmeasured. Extending `tools/sim.mjs` is the best next tool.
5. **No end state.** Research (Universal Paperclips) says a real ending helps. Reaching the observable universe mass does nothing yet.
6. **Challenge purity and focus balance are guesses.** Check the six challenges and eight focuses for dominant picks.
7. **Physical constants in `scale.js` are rounded.** The sub-electron landmarks are bounds and one derived value. Check before using them in public text.
8. **`onRunReset(s, why)` hook** is called by challenges on other features. No feature implements it yet. Harmless today. Implement it in features with per-run state if you add some.
9. **Scale panel** sits under Methods. Consider a one-line "next landmark" near the count instead.
10. **Save format** is version 1 with an optional `f` object per feature. There is no migration code yet. If you change a feature state shape, keep `fromSave` tolerant (every feature validates its own data).

## Likely next steps

- Play a full session on a phone. Fix what feels bad. Write down what you find in `decisions.md`.
- Extend the simulator for features, then retune layers 2 and 3 together.
- Define layer 4 and an ending. Candidates in the research: a new currency with a new rule, as compaction did.
- Replace the placeholder theme.
- Add a CI check that the copy step in `.github/workflows/pages.yml` includes every runtime file (a missed file breaks the live site while tests still pass).

## Rules for contributors

See `AGENTS.md`. Short version: plain short sentences, no emojis, no em-dash, tests only for our own logic, never use plain JS number math on game values, keep edits to core files small, record decisions in `docs/decisions.md`.
