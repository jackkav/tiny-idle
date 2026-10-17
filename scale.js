// Real masses (kg, rounded) used to give the dust amount a sense of size.
import { log10, fmt, make, n } from './num.js';

const RAW = [
  { name: 'an electron', kg: 9.1e-31 },
  { name: 'a proton', kg: 1.7e-27 },
  { name: 'a water molecule', kg: 3e-26 },
  { name: 'a virus', kg: 1e-18 },
  { name: 'a human cell', kg: 1e-12 },
  { name: 'a grain of sand', kg: 1e-6 },
  { name: 'a paperclip', kg: 1e-3 },
  { name: 'a person', kg: 70 },
  { name: 'the Moon', kg: 7.3e22 },
  { name: 'the Earth', kg: 6e24 },
  { name: 'the Sun', kg: 2e30 },
  { name: 'the Milky Way', kg: 1.5e42 },
  { name: 'the observable universe', kg: 1.5e53 },
];
export const LANDMARKS = RAW.map((r) => ({ ...r, exp: Math.log10(r.kg) }));

// Position of the bar: log10 kg from the starting speck to the universe.
export const SCALE_MIN = -101;
export const SCALE_MAX = 54;

// Landmarks lighter than an electron. Real physics bounds and derived values, rounded.
// describeScale does not use them. The Scale panel and the bar ticks do.
// The first one is the mass of a quantum whose wavelength is about the size of the universe.
const SUB = [
  { name: 'a quantum as wide as the universe', kg: 2e-68 },
  { name: 'the graviton mass limit', kg: 2e-58 },
  { name: 'the photon mass limit', kg: 1.8e-54 },
  { name: 'a neutrino (upper limit)', kg: 1.8e-37 },
  { name: 'a green photon, as mass', kg: 4.1e-36 },
];

// Every landmark in order of mass. `at` is the mass as a Num. `exp` is log10 of the mass.
export const LADDER = [...SUB.map((r) => ({ ...r, exp: Math.log10(r.kg) })), ...LANDMARKS]
  .map((r) => ({ ...r, at: n(r.kg) }))
  .sort((a, b) => a.exp - b.exp);

const fracOfExp = (l) => Math.min(1, Math.max(0, (l - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)));

// Bar position (0 to 1) of every landmark on the ladder, for tick marks.
export const landmarkTicks = () => LADDER.map((lm, index) => ({ index, name: lm.name, frac: fracOfExp(lm.exp) }));

// Orders of magnitude from an amount of dust up to a landmark. Never negative.
// Zero dust counts as the start speck (SCALE_MIN).
export function ordersTo(dust, lm) {
  const l = Math.max(SCALE_MIN, log10(dust));
  return Math.max(0, lm.exp - l);
}

export const barFraction = (dust) => {
  const l = log10(dust);
  if (!Number.isFinite(l)) return 0;
  return fracOfExp(l);
};

// One line comparing the dust to the nearest landmark below or above it.
export function describeScale(dust) {
  const l = log10(dust);
  if (!Number.isFinite(l)) return 'Nothing yet. Tap the speck.';
  const first = LANDMARKS[0];
  if (l < first.exp - 0.5) {
    const orders = Math.round(first.exp - l);
    return `${orders} orders of magnitude lighter than ${first.name}.`;
  }
  let best = first;
  for (const lm of LANDMARKS) if (lm.exp <= l) best = lm;
  const d = l - best.exp;
  const ei = Math.floor(d);
  const ratio = make(10 ** (d - ei), ei);
  if (ratio.e === 0 && ratio.m < 1.5) return `About as heavy as ${best.name}.`;
  return `${fmt(ratio, 1)} times the mass of ${best.name}.`;
}
