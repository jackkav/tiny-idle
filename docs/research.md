# Research notes

Question: how do incremental and idle games stay compelling, and what does that mean for this game?

## Sources used

- [Tuts+, "Numbers getting bigger"](https://code.tutsplus.com/numbers-getting-bigger-the-design-and-math-of-incremental-games--cms-24023a): cost formulas, tier spacing, prestige, active versus idle, the buy-order score.
- [Game Developer, "The rise of games you mostly don't play"](https://www.gamedeveloper.com/design/the-rise-of-games-you-mostly-don-t-play): return moments, session design, why idle games are sticky.
- [Game Developer, "Incremental Game Review: Trimps"](https://www.gamedeveloper.com/design/incremental-game-review-trimps): pacing, choices, weak onboarding, fading engagement.
- [Game Developer, "Lessons of my first incremental game"](https://www.gamedeveloper.com/design/lessons-of-my-first-incremental-game): automate balancing, small building blocks, content versus play length.
- [IF50 on Universal Paperclips](https://if50.substack.com/p/2017-universal-paperclips?open=false): phases, a new rule at each milestone, a real ending.
- [Antimatter Dimensions wiki](https://antimatter-dimensions.fandom.com/wiki/Guide): staged layers (Infinity, Eternity), challenges, autobuyers.

## Caveats

Most web search results were low-quality listicles or mirrored pages. We did not use them. No source gave retention data we could verify. One secondhand figure (idle game stickiness of 18 percent against 10.5 percent for hyper-casual games) came from an industry write-up that cites a GameAnalytics study. We could not find the study, so we did not design around it.

Items marked "ours" below are our own ideas, not from a source.

## Findings and how we used them

| Finding | Where it shows up in the game |
| --- | --- |
| Price = base x growth^owned. Steeper growth makes walls arrive sooner. Tiers are spaced about 5x apart in cost. | `GENS` in `game.js`. Growth is 1.4 to 3.25, so walls arrive fast. Milestone doublings (x2 per 10 bought, 10 times at most) are the counterweight. |
| A reset answers the slowdown. Layers stack, each with a bigger bonus. | Condense (layer 2, grains) and Compaction (layer 3, pebbles). |
| Decisions make waiting active. Use several paths and a buy-order score. | Methods and tiers compete for dust. `tools/sim.mjs` has a best-buy bot that uses the score. Autobuyer slots and reserves. Run focus. |
| Each layer needs a new rule, not only bigger numbers. | Compaction is a spatial lattice puzzle. Challenges bend one rule each. |
| Show locked goals ("known unknowns"), hide others ("unknown unknowns"). | Scale panel: next landmark, two teasers, then "?". Locked autobuyers. |
| Automation is a pillar of the genre. | `features/automation.js`. |
| Return moments should feel like a small celebration. Always show what happened while away. | Welcome panel and return bonus in `features/rhythm.js`. |
| Reward both active and idle play. Do not require constant input. | Tap heat, rare drifting specks, offline efficiency curve. |
| Onboarding matters. Reveal one thing at a time. | Hint line, hidden late sections (`features/ux.js`, `ui.visible`). |
| Challenges extend the game cheaply. | `features/challenges.js`. |
| Build a simulator early. | `tools/sim.mjs`, `tools/pacing.test.mjs`. |
| (ours) Rare catchable events are a strong attention hook. | Drifting speck in `features/rhythm.js`. |
| (ours) The theme should be part of the core action. | The count is a mass in kg. Real masses are the milestones. The page color follows the scale. |
