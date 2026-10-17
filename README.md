# Smallest Thing

An idle game proof of concept. You start by tapping a speck worth 0.01e-99 kg (1e-101 kg) and climb the exponent ladder toward the mass of the observable universe (about 1e53 kg). The theme is a placeholder. The point is the number scale.

Live: https://jackkav.github.io/tiny-idle/

## Run it

No build step. Serve the folder with any static server and open `index.html`.

```bash
python3 -m http.server 8000
```

Run the tests:

```bash
node --test
```

## Files

| File | Purpose |
| --- | --- |
| `num.js` | Non-negative numbers as mantissa and exponent. Works far below 1e-308. |
| `game.js` | All rules and numbers: collectors, methods, condensation, save format. No DOM. |
| `scale.js` | Real-world mass landmarks and the progress bar position. |
| `ui.js` | DOM, input, game loop, autosave, offline progress. |
| `game.test.mjs` | Tests for our own logic. |
| `tools/sim.mjs` | Pacing simulator with three bots. Also a command line tool. |
| `tools/pacing.test.mjs` | Pacing checks with tolerance bands, run through the simulator. |

New runtime modules must be added to the copy step in `.github/workflows/pages.yml`.

## What is in the POC

- Tap the speck. One tap is 1e-101 kg.
- 6 collector tiers. Tier 1 makes dust. Each higher tier makes the tier below it. Every 10 purchases of a tier doubles its output (10 doublings at most).
- 7 methods (upgrades): tap power, two auto-tappers, four global multipliers.
- Condensation unlocks after you own 10 different methods or collectors. It resets dust, collectors and methods. The first grains need 1e-68 kg in one run (3 grains). Each factor of ten above that pays 2 more grains. Each grain adds +100% to all dust. The needed mass rises with your grains, so later runs stay long (see Pacing).
- Autosave to `localStorage`, offline progress (12 hours maximum).
- `window.game` is exposed in the browser console for testing.

## Pacing

Measured with `tools/sim.mjs` (active player: 3 taps per second for 90 seconds in each run, then 0.5).

- First purchase at 4 seconds. Longest wait between purchases in the first 10 minutes: 9 to 12 seconds.
- Collector tiers arrive at about 0:04, 0:45 to 1:05, 2:45 to 3:00, 3:55 to 4:15, 5:10 to 5:35, 5:50 to 6:15.
- Condensation unlocks at 5:10 to 5:35. The first grains are available at 8:05 to 8:35 (3 grains). A player who waits until the next grain takes more than a minute condenses at about 16:00 for 17 grains.
- Runs 2 to 6 take 5:50 to 6:45 when the player condenses at once (payouts 6, 9, 13, 16, 20 grains). They take about 8:30 when the player waits (payouts 14, 18, 22, 26, 30). Over 80 runs the time stays near 9 minutes.
- Idle player (3 taps per second for the first 60 seconds of each run, then only buying): same timing as the active player. After the first minutes, taps are a small part of the income. If the player checks the shop only every 2 minutes, the first condense is at 20:15. Every 5 minutes: 36:55. A player who never buys cannot start: the first collector costs 10 taps.

Why runs do not collapse: every time in the game scales as 1 / (grain multiplier), because prices are fixed and income scales with the multiplier. So the mass needed for a condense rises with the multiplier: at x 10^(14 x log10(m)^0.7) kg, where m is 1 + grains. The payout at the threshold is 3 x m^0.5 grains, so it grows with every run.

Constants, easiest to retune first (all in `game.js`):

| Constant | Effect |
| --- | --- |
| `CONDENSE.at` | Time of the first condense (about 1 minute per order of magnitude near the end of run 1). |
| `CONDENSE.rise`, `CONDENSE.curve` | Length of runs 2 and later. Raise `rise` to make them longer. |
| `CONDENSE.perOrder` | Reward for waiting. Higher values make patient players wait longer. |
| `CONDENSE.first`, `CONDENSE.firstPow` | Payout at the threshold and how fast it grows over runs. |
| `METHODS_TO_UNLOCK` | Time of the condense unlock. |
| `GENS[k].base` | Time each tier arrives. Tier prices rise faster each step. |
| `UPGRADES[k].base` | Time each method arrives. |

Run the simulator:

```bash
node tools/sim.mjs                          # all bots, 60 minutes, condense when a new grain takes over 60 s
node tools/sim.mjs --bot best --runs 6 --patience 0 --minutes 120   # condense at once, 6 runs
node tools/sim.mjs --bot idle --decide 300  # check the shop only every 5 minutes
node tools/sim.mjs --help
```

Bots: `greedy` buys the cheapest thing it can afford. `best` buys the item with the lowest score cost / income + cost / (income + gain), looking 60 seconds ahead. `idle` taps for 60 seconds at the start of each run, then does not tap. From code: `simulate({ bot, minutes, patience, tapsPerSecond, decideEvery, maxRuns, setup })` in `tools/sim.mjs`. It loads `features/index.js`, so new features are included. The bots do not use feature controls (for example automation switches). `tools/pacing.test.mjs` fails if a number leaves its band. Retune the constants above or move the band on purpose.

## Ideas to define next

- Layer 3: a new currency above grains, with its own reset or its own rules.
- Make collectors differ in kind, not only in tier (for example, collectors that need a different currency).
- Choices that exclude each other (spend grains on one of two paths per run).
- Give the scale bar meaning: landmarks as milestones that unlock things when you pass them.
- Number formatting options and an export/import save string.
