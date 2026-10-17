# Decision log

Each entry: what we decided, why, and what we rejected. Newest topics last. Numbers are the values at the time of writing. The code is the final source for constants.

## 1. Platform and tooling

**Plain ES modules, no build step, no dependencies. Static hosting on GitHub Pages.**
Why: the game is a small static page. A build step adds setup cost for every future agent and gives nothing here. Tests run with `node --test`, which loads the same modules the browser loads.
Rejected: a bundler or framework (more moving parts), a game engine (the UI is mostly text and buttons).

**Standalone repo `jackkav/tiny-idle`, not a folder in the `spikes` repo.**
Why: Pages needs its own GitHub repo, and the `spikes` repo holds unrelated work with no remote.

**Deploy workflow runs all tests, then copies files by name into `_site`.**
Why: a broken main must not ship. The copy step is a list (`index.html style.css num.js game.js scale.js ui.js` and the `features/` folder), so a new root-level `.js` file must be added there. Features live in `features/` so new ones are copied without a change.
Rejected: publishing the repo root (would publish tests and docs).

**Tests cover our own logic only.** A test must fail because our code is wrong, not because a library changed. UI code is kept thin so the logic around it is testable without a DOM.

## 2. Numbers

**Custom mantissa and exponent numbers (`num.js`), not JS doubles.**
Why: the start is 1e-101 kg and the goal is about 1e53 kg. Doubles stop at 1e-308 and lose meaning in arithmetic long before that. The exponent is a plain JS number, so the range is effectively unlimited.
Only non-negative values are supported. `sub` clamps at zero.

**Two bugs shaped `num.js`; keep their fixes.**
- `pow` through `Math.pow` overflowed for large powers (cost growth^bought at 6000 purchases). Integer powers now use repeated squaring (exact). Other powers go through logarithms.
- The milestone multiplier `2^k` overflowed a double at k around 1024. It is now a `Num`.
Lesson: never use plain JS number math on dust, prices or multipliers.

**Display:** `fmt` gives scientific notation with a rounding fix (9.999 becomes 1.00 on the next exponent). Plain decimals are used from 0.01 up to 999999. Notation (scientific, engineering, words) is a global setting in `num.js` (`setNotation`).

## 3. Core loop design (the POC)

- One tap is 1e-101 kg (0.01e-99, as asked). Every price is written in taps (`taps(x)`), so the whole economy is expressed against the first thing the player does.
- Six collector tiers. Tier k makes tier k-1, tier 1 makes dust. This is the Antimatter Dimensions style. It gives depth with one rule.
- Every 10 purchases of a tier doubles it, capped at 10 doublings. **The cap is the wall.** Without it, the six tiers multiply each other and growth never levels off (an early simulation passed 1e300 kg within minutes, helped by the overflow bug in section 2). With it, a run stalls and condensing becomes the answer. See the research: a reset answers the slowdown.
- Seven methods: tap power (repeatable), two auto-tappers, four global multipliers.
- Condense unlocks at 10 owned methods or collectors (a design from the request: "after collecting enough new methods ... additional currencies should unlock").

## 4. Layer 2: condense and grains (economy agent, `game.js`)

**Problem found by simulation:** with a fixed threshold and linear grain bonus, run 1 took 7 minutes but runs 2 to 6 took 14 to 50 seconds, and grains per run grew by about 1. Layer 2 ran out of depth.
**Decision:** every time in the game scales as 1 / (multiplier), because prices are fixed and income scales with the multiplier. So the needed mass rises with the multiplier: `need = at x 10^(rise x log10(m)^curve)`, where m is the grain multiplier (1 + grains, times any feature strength, see 8). Payout at the threshold is `first x m^firstPow` plus `perOrder` per order above it. Constants: `CONDENSE = {at: 1e-68, rise: 14, curve: 0.7, perOrder: 2, first: 3, firstPow: 0.5}`.
**Result:** run time stays near 9 minutes over 80 simulated runs. First condense at about 8 minutes.
**Costs of the choice:** the threshold in kg is no longer a fixed, readable landmark. The UI shows the current need ("Needs X kg").
Tier base costs were fitted with a coordinate search so tiers arrive 40 to 90 seconds apart. Growth values were kept.

**Rejected:** a square-root grain formula (grains exploded to 3e8 after an hour); letting grains grow forever with no threshold change (runs collapse).

## 5. Feature architecture

**A mechanic is a "feature": one file in `features/`, registered with `registerFeature`.** The core exposes hooks (multipliers, costs, speed, tick, tap, condense, offline). Full contract in `DESIGN.md`.
Why: seven agents built seven mechanics in parallel with almost no merge conflicts (all seven branches merged with no textual conflicts). Each feature owns its state in `state.f[id]`, its save data, its tests and its UI.
**Hook details worth knowing:**
- Hooks are called in registration order (`features/index.js`).
- `applyOffline` chains `offline` hooks. Each gets the result of the one before. (A review found the first version kept only the last result, so import order silently changed the offline rate.)
- A feature with `pauseInChallenge: true` has its multiplier hooks skipped while a challenge runs (see 7).
- `condenseStrength` lets a feature raise the condense threshold along with the power it adds (see 8).
- `s.flow` counts every dust ever gained in a session (not saved). It measures offline gains across condenses.
- `ui.visible(state)` hides a feature section until it matters. `ui.order` below 15 puts the section under the tap target, the rest go below Methods and Condensation.

## 6. Features: what each does and why

### Milestones (`features/milestones.js`)
- 18 landmarks (13 real masses from electron to the observable universe, 5 lighter ones) are rewards for reaching a mass. Progress uses lifetime best dust, so it survives condense. Why real masses: the theme is scale, and a real object makes a number feel real.
- Rewards differ in kind (global, tap, collector output, cost discount) so they are not all "x1.0x". Combined effect is modest: about x1.5 global from landmarks, x1.7 with all 21 achievements. `GLOBAL_CAP` and `COST_FLOOR` are safety limits that do not bind today. They exist for future reward changes.
- Locked goals follow the research: next landmark visible, two teasers, the rest hidden as "?".
- The mass of the first landmark, "a quantum as wide as the universe", is 2.5e-69 kg. It is the mass-equivalent of a quantum with a wavelength equal to the observable universe diameter (h / (lambda c) with lambda about 8.8e26 m). Other sub-electron values are rounded physics bounds. Check them before quoting them.

### Automation (`features/automation.js`)
- Autobuyers for each collector tier and for methods, plus a late auto-condense.
- **Grains are never spent.** The core multiplier reads `state.grains`, so spending them would weaken the player. Autobuyers unlock at grain thresholds. Speed upgrades cost "points" (whole grains minus a counter the feature keeps).
- **Limited slots** (`1 + floor(condenses / 3)`, at most 6), a reserve per autobuyer (keep 0 to 90 percent of dust) and a priority order. Why: a free upgrade is a chore saver, a limited choice is a decision (research: decisions make waiting active).
- Offline catch-up runs the autobuyers and sends one summary note.

### Challenges and focus (`features/challenges.js`)
- Six challenges, each bends one rule and gives a permanent reward. Entering starts a fresh run, keeps grains, and can be left at any time. In a challenge only its own rule applies. Condensing pays no grains.
- Run focus: after each condense, pick one of 3 modifiers drawn from 8. The offer is a pure function of stored data (`salt` and an offer counter `nonce`), so a reload cannot reroll it. The gamble outcome is stored, not rolled at render time.
- Challenge targets are fixed kg values. That is why permanent bonuses are paused inside a challenge (see 7).

### Compaction, layer 3 (`features/compaction.js`)
- Reset everything below (dust, collectors, methods, grains, condense count) for pebbles. Unlock at 100 grains, requirement x1.6 each time. `pebbles = floor(3 x (grains / 100)^0.5)`.
- **New rule instead of a bigger multiplier: the Pebble Lattice.** Pebbles go into a 3x3 grid of slots with four kinds (Dense: tap power, Wide: collector output, Deep: grain strength, Lens: condense gain). A slot's score is size x factor. Same-kind neighbours add 25 percent, the kind that "feeds" it adds 75 percent, the opposite kind subtracts 25 percent. The player re-solves the grid after every compaction.
- Why a lattice: research says each layer should add a new kind of thinking, not only bigger numbers. A placement puzzle is different in kind from "buy the cheapest thing".
- Balance is rough on purpose. Dense and Wide give 2^score, which can get very large.

### Rhythm: active play and return (`features/rhythm.js`, `rhythm-ui.js`)
- Rare drifting speck every 60 to 180 s (first at 25 to 50 s). Payouts scale with current production (a burst is 45 s of production, never below 25 taps) because the game spans 150 orders of magnitude. Fixed kg rewards would be meaningless.
- Tap heat: steady tapping (about 3 taps per second holds it) gives up to x2.5 on taps. Never required.
- Offline efficiency: 100 percent for 2 h, 60 percent to 6 h, 30 percent to 12 h. A full 12 hours counts as 6.2 hours. Why: a return should feel good but should not reward leaving the game open to a limit.
- Welcome panel after 5 minutes or more away, with a return bonus (x2 for 30 to 120 s, started when the player presses Collect, so it is used while looking at the game).

### UX (`features/ux.js`, `ux-logic.js`)
- A hint line walks a new player through the first steps. Each step shows once. A player who has condensed sees none.
- Settings dialog: notation, sound, reduced motion, hints, export and import save (base64 text), reset.
- Sound is off by default and `?mute=1` forces it off. Why: autoplay rules, and a game left in a tab should be quiet.
- The page color moves with the scale (`barFraction`) so progress is visible without reading numbers.
- Reduced motion follows the OS until the player changes it.

## 7. Challenge purity

**Permanent bonuses are paused inside a challenge** (milestones and the lattice use `pauseInChallenge`). Why: challenge goals are fixed kg values. A late player with a full lattice would finish them instantly. The challenge feature also cancels the grain multiplier itself. Rhythm effects (frenzy, heat) are not paused: they are short and come from skill. Revisit if challenges feel too easy.
**Compaction is blocked inside a challenge.** Why: it cancelled the challenge with no reward.

## 8. Condense threshold and permanent power

**Features that add permanent production power must also add condense strength.** The lattice (Deep and Wide) adds `condenseStrength`, so the threshold rises with it. A review found runs of 18 seconds with a full lattice, because power rose but the threshold did not.
**Milestones and challenge rewards do not add strength.** Why: they are small (x1.7 at most) and the threshold curve is steep at small values. A 3 percent bonus would have moved the threshold by 5x on the first run. We chose to keep the first run clean over perfect consistency.

## 9. Review process and fixes

After merging, two independent read-only reviews ran against the merged branch: one for cross-feature logic, one for UI and CSS. They found these issues, all fixed on the integration branch, with regression tests in `features/review-fixes.test.mjs`:
- Swarm focus could soft-lock a run (no taps, no collectors). Fixed with a free cling.
- Lattice power did not raise the condense threshold (see 8).
- A compaction counted as a fast condense and gave fast-run achievements.
- Lattice and milestone bonuses leaked into challenges (see 7).
- Compaction was allowed inside a challenge.
- The welcome panel under-reported gains after an offline condense (now uses `s.flow`).
- Offline hook results were last-wins (now chained).
- Challenge offers repeated after a compaction (now an offer counter).
- UI: the core buy controls were about 3 screens below the fold under locked panels. The layout now puts collectors and methods first and hides late sections.
- UI: challenge cards broke at 375 px and below, notation changes left stale text in two panels, the welcome panel lost Escape after a click on its text, rhythm ignored the in-game reduce-motion setting, every button pulsed (the "you can afford it" cue lost meaning), low contrast on locked cards, toast spam (a condense posted 15 toasts: now at most 3 and "and N more").
Not changed on purpose: the compaction teaser shows after condense unlocks (a visible goal), export and import can reroll rhythm specks (minor), compaction resets automation slots (the condense count resets).

Test fixes during merge: four challenge tests assumed no other features (they now remove other features' multiplier hooks in that process), and seven tests used the old fixed condense threshold.

## 10. Process notes

Work was split by aspect into 7 git worktrees (`feat/<aspect>`) from one base commit that already contained the feature hooks and stub files. Agents did not use a browser (a shared browser pane would clash). One agent opened its own local page anyway. UI was verified by the orchestrator after the merge and by the review. Real-device testing (touch, sound, the welcome panel visuals) has not been done.
