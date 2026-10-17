# Design brief: Smallest Thing

Goal: an idle game where the player starts with a speck worth 1e-101 kg and climbs the exponent ladder to the mass of the observable universe (about 1e53 kg). The scale is the theme. Every mechanic should make the size of the numbers feel real.

## Research summary

Sources: [Tuts+ "Numbers getting bigger"](https://code.tutsplus.com/numbers-getting-bigger-the-design-and-math-of-incremental-games--cms-24023a), [Game Developer "The rise of games you mostly don't play"](https://www.gamedeveloper.com/design/the-rise-of-games-you-mostly-don-t-play), [Game Developer "Incremental Game Review: Trimps"](https://www.gamedeveloper.com/design/incremental-game-review-trimps), [Game Developer "Lessons of my first incremental game"](https://www.gamedeveloper.com/design/lessons-of-my-first-incremental-game), [IF50 on Universal Paperclips](https://if50.substack.com/p/2017-universal-paperclips?open=false), [Antimatter Dimensions wiki](https://antimatter-dimensions.fandom.com/wiki/Guide). Many search results were low-quality listicles. We used only the sources above. Items marked "ours" are our own additions, not from sources.

1. **Cost curves make the wall.** Price = base x growth^owned. Cookie Clicker uses about 1.15 and Clicker Heroes about 1.07. Steeper growth (up to 2.5 in one game) makes walls arrive sooner. Each building tier costs about 5x the one before, so the player has time to enjoy each unlock.
2. **A reset answers the slowdown.** Prestige restores a feeling of fast progress after growth flattens. Reset all purchases for a permanent multiplier or a new currency (Clicker Heroes ascension). The bonus cannot grow forever, so stacked layers each give a bigger bonus. Antimatter Dimensions stages this as Infinity, then Eternity, each with its own challenges.
3. **Decisions make waiting feel active.** Several upgrade paths with nonlinear costs force the player to re-check what is best. A useful score for the next best buy: cost / income + cost / (income + gain). The lowest score wins. Use it in simulations to find time spikes.
4. **Each layer should add a new rule, not only bigger numbers.** Universal Paperclips adds a new currency or system at each phase (funds, operations, trust, power, matter). When numbers get absurd, change the kind of thing the player thinks about.
5. **Show locked things.** "Known unknowns" (visible but locked) give goals. "Unknown unknowns" (hidden) give surprise. Use both.
6. **Milestones and automation.** Near goals with rewards give accomplishment. Automation is the other pillar of the genre. It lets the player step away.
7. **Return moments.** A quick check-in should move the player up the growth curve and feel like a small celebration. The longer the player was away, the stronger the pull to return. Always show what happened while away.
8. **Reward both active and idle play.** Do not demand constant involvement. Active input should speed things up, not be required.
9. **Onboarding and retention.** The Trimps reviewer spent the first hour confused, then checked the game less and less. Start simple. Reveal one new thing at a time. Explain each new thing the first time it appears.
10. **Challenges extend the game.** Trimps has 50+ challenges that bend the rules. Antimatter Dimensions has modified runs with a higher target and a permanent reward. (ours: a challenge is a cheap way to add depth without new numbers.)
11. **Balance with tools.** Automate balancing early. Prototype the logic outside the UI. Keep the game definition as data (values and formulas), separate from the engine. Without a simulator every new piece of content means guessing.
12. **Make the theme part of the core action.** (ours: a rare event, like the golden cookie, can be a drifting speck the player must catch. Pacing of rare events is a strong return and attention hook.)

## Where the POC stands

- First run reaches the condense threshold at about 7 minutes. After the first condense, runs take 14 to 50 seconds. Grains per run grow slowly. Layer 2 runs out of depth fast. The main gaps are: layer 3, automation, challenges, active play, return moments, milestones, onboarding and polish.

## Architecture: features

Core rules are in `game.js` (no DOM). A feature is a self-contained mechanic in `features/<id>.js`. It registers itself with `registerFeature({...})` and is imported by `features/index.js`. All fields are optional except `id`.

```js
registerFeature({
  id: 'example',
  init() { return { count: 0 } },             // starting state, stored at state.f.example
  toSave(fs) { return fs },                    // JSON-safe copy. Use N.toJSON / N.fromJSON for Num values.
  fromSave(saved) { return { count: saved.count | 0 } },   // validate. Never trust saved data.
  tick(s, dt) {},                              // every frame and every offline step. dt is real seconds.
  onTap(s, value) {},                          // after each tap. value is the Num gained.
  onCondense(s, gained) {},                    // after a condense. Reset your own per-run state here.
  globalMult(s) { return N.ONE },              // Num. Multiplies all dust (taps and collectors).
  genMult(s, k) {}, tapMult(s) {},             // Num. Per tier or tap only.
  autoTaps(s) { return 0 },                    // JS number. Adds taps per second.
  speed(s) { return 1 },                       // JS number. Multiplies game speed.
  costMult(s, kind, index) { return N.ONE },   // Num. kind is 'gen' (index = tier) or 'up' (index = upgrade id).
  condenseGain(s, gain) { return gain },       // Num. Return a new gain.
  offline(s, seconds) { return seconds },      // Effective seconds to simulate while the player was away.
  onReturn(s, seconds, effective) {},          // After offline progress.
  ui: {
    title: 'Example', order: 50, css: '...',   // title is optional. order sorts sections. css is injected once.
    mount(root, ctx) { return (s) => {} },     // build DOM in root. The returned function runs about 15 times per second.
  },
});
```

Rules for all features:

- Own state lives in `state.f[id]`. Do not add fields to the core state.
- Put rules in pure functions that tests can call. Keep `ui.mount` thin.
- Show messages to the player with `G.notify(s, text)`.
- To pay out dust use `G.gain(s, amount)`.
- `ctx` gives `getState()` (always use it, state is replaced on reset), `G`, `N`, `fmt`, `fmtInt`, `toast`, `save`, and `dom` (`tap`, `floaters`, `body`).
- Do not add a new `.js` file outside `features/` unless you must. If you do, add it to the copy step in `.github/workflows/pages.yml`.
- Write tests only for our own logic, in `features/<id>.test.mjs`. Run all tests with `node --test`.
- Numbers can be far below 1e-308. Never use `Math.pow`, `Number` multiplication or `toNumber` for dust. Use `num.js`.
- Keep edits to core files (`game.js`, `ui.js`, `num.js`, `scale.js`, `style.css`) small and additive. If you need a new hook, add it next to the existing hooks and describe it in your final report.
- No emojis. No em-dash. Use plain, short sentences in all player text and comments.

## Aspects and owners

| Aspect | Feature id | Owns |
| --- | --- | --- |
| Economy and pacing | (core) | `GENS`, `UPGRADES` constants in `game.js`, `tools/sim.mjs` |
| Milestones and scale landmarks | `milestones` | `features/milestones.js`, `scale.js` |
| Automation | `automation` | `features/automation.js` |
| Challenges and run choices | `challenges` | `features/challenges.js` |
| Layer 3 | `compaction` | `features/compaction.js` |
| Active play and return moments | `rhythm` | `features/rhythm.js` |
| Onboarding, settings and polish | `ux` | `features/ux.js`, `style.css` |
