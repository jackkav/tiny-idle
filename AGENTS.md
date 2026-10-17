# AGENTS.md

Guide for agents and people working on this repo. Read this, then `docs/`.

## Docs exist. Start there.

- `docs/handover.md`: current state, how to run and test, open problems, next steps. Read first if you take over.
- `docs/decisions.md`: every design and technical decision with the reason. Read before changing a mechanic or a constant.
- `docs/research.md`: research behind the design, with sources.
- `DESIGN.md`: the feature contract (hooks) and who owns what.

When you make or change a decision, update `docs/decisions.md` in the same commit. Keep the reason.

## What this is

Smallest Thing: an idle game on GitHub Pages (https://jackkav.github.io/tiny-idle/). Plain ES modules, no build step, no dependencies. Numbers start at 1e-101 kg, so all game values use the mantissa and exponent type in `num.js`.

## Commands

```bash
node --test                          # all tests, about 3 seconds
python3 -m http.server 8000          # then open http://localhost:8000/?mute=1
node tools/sim.mjs --help            # pacing simulator
```

Always load the page with `?mute=1` when testing in a browser.

## Layout

- `num.js`: big-number type. `game.js`: all rules and numbers, no DOM, plus the feature hooks. `scale.js`: real-mass landmarks. `ui.js`: DOM, input, loop, save.
- `features/<id>.js`: one mechanic each, registered in `features/index.js`. Own state in `state.f[id]`. Contract in `DESIGN.md`.
- `tools/sim.mjs`, `tools/pacing.test.mjs`: simulator and pacing checks.
- `.github/workflows/pages.yml`: tests, then deploy. It copies files by name. Add any new root-level runtime `.js` file to its copy step. Files in `features/` are copied already.

## Rules

- Never use plain JS number math (`Math.pow`, `*`, `+`) on dust, prices or multipliers. Use `num.js`. Two real bugs came from this.
- Write tests only for our own logic. A test must fail because our code is wrong, not because a library changed.
- Keep edits to core files (`game.js`, `ui.js`, `num.js`, `style.css`) small and additive. Add new behavior as a feature.
- Every feature validates its own saved data in `fromSave`. Never trust saved data.
- Scale payouts with current production, not fixed kg values. The game spans about 150 orders of magnitude.
- Keep text for players and comments in plain, short sentences. No emojis. No em-dash.
- Run `node --test` before you push. Pushing to `main` deploys.
