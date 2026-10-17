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
node --test game.test.mjs
```

## Files

| File | Purpose |
| --- | --- |
| `num.js` | Non-negative numbers as mantissa and exponent. Works far below 1e-308. |
| `game.js` | All rules and numbers: collectors, methods, condensation, save format. No DOM. |
| `scale.js` | Real-world mass landmarks and the progress bar position. |
| `ui.js` | DOM, input, game loop, autosave, offline progress. |
| `features/ux.js` | Hints, settings panel, sound, tap effects, page color (DOM side). |
| `features/ux-logic.js` | Pure rules for the above: settings, save strings, hints, color. |
| `game.test.mjs` | Tests for our own logic. |

New runtime modules must be added to the copy step in `.github/workflows/pages.yml`.

## What is in the POC

- Tap the speck. One tap is 1e-101 kg.
- 6 collector tiers. Tier 1 makes dust. Each higher tier makes the tier below it. Every 10 purchases of a tier doubles its output (10 doublings at most).
- 7 methods (upgrades): tap power, two auto-tappers, four global multipliers.
- Condensation unlocks after you own 8 different methods or collectors. It resets dust, collectors and methods. You get one grain per order of magnitude that your run beat 1e-70 kg by. Each grain adds +100% to all dust.
- Autosave to `localStorage`, offline progress (12 hours maximum).
- `window.game` is exposed in the browser console for testing.

## Pacing (from a greedy-bot simulation)

- First run reaches the condensation threshold at about 7 minutes of play. A first condensation of about 10 grains is possible at about 15 minutes.
- Later runs are much faster: the threshold in 14 to 50 seconds after the first condensation. Grains per run grow only slowly (about +1 per run), so layer 2 runs out of depth quickly. This is the main gap to fill with the next layer.

## Ideas to define next

- Layer 3: a new currency above grains, with its own reset or its own rules.
- Make collectors differ in kind, not only in tier (for example, collectors that need a different currency).
- Choices that exclude each other (spend grains on one of two paths per run).
- Give the scale bar meaning: landmarks as milestones that unlock things when you pass them.
- Number formatting options and an export/import save string.
