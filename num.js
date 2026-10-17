// Non-negative big numbers stored as mantissa and exponent.
// value = m * 10^e, with 1 <= m < 10, or m = 0 for zero.
// The exponent is a plain JS number, so the range is far beyond double (1e-308).

export const ZERO = { m: 0, e: 0 };
export const ONE = { m: 1, e: 0 };

export function make(m, e) {
  if (!(m > 0)) return ZERO;
  if (m >= 10 || m < 1) {
    const s = Math.floor(Math.log10(m));
    m /= 10 ** s;
    e += s;
    if (m >= 10) {
      m /= 10;
      e += 1;
    } else if (m < 1) {
      m *= 10;
      e -= 1;
    }
  }
  return { m, e };
}

// Build from a JS number. Uses the decimal string so 1e-101 stays exact.
export function n(x) {
  if (!(x > 0)) return ZERO;
  const [mant, exp] = x.toExponential().split('e');
  return { m: Number(mant), e: Number(exp) };
}

export const isZero = (a) => a.m === 0;

export function cmp(a, b) {
  if (a.m === 0 || b.m === 0) return Math.sign(a.m - b.m);
  if (a.e !== b.e) return a.e > b.e ? 1 : -1;
  return Math.sign(a.m - b.m);
}
export const gte = (a, b) => cmp(a, b) >= 0;
export const lt = (a, b) => cmp(a, b) < 0;

export function add(a, b) {
  if (a.m === 0) return b;
  if (b.m === 0) return a;
  const [hi, lo] = cmp(a, b) >= 0 ? [a, b] : [b, a];
  const d = hi.e - lo.e;
  if (d > 17) return hi;
  return make(hi.m + lo.m / 10 ** d, hi.e);
}

// a - b, clamped at zero.
export function sub(a, b) {
  if (b.m === 0) return a;
  if (cmp(a, b) <= 0) return ZERO;
  const d = a.e - b.e;
  if (d > 17) return a;
  return make(a.m - b.m / 10 ** d, a.e);
}

export const mul = (a, b) => make(a.m * b.m, a.e + b.e);

export function div(a, b) {
  if (b.m === 0) throw new RangeError('division by zero');
  return make(a.m / b.m, a.e - b.e);
}

// Multiply by a plain JS number.
export const scale = (a, x) => make(a.m * x, a.e);

// a ^ p for a JS number p.
export function pow(a, p) {
  if (a.m === 0) return p === 0 ? ONE : ZERO;
  // Whole powers use repeated squaring, which stays exact. Others go through logarithms.
  if (Number.isInteger(p) && p >= 0) {
    let result = ONE;
    let base = a;
    for (let k = p; k > 0; k = Math.floor(k / 2)) {
      if (k % 2 === 1) result = mul(result, base);
      base = mul(base, base);
    }
    return result;
  }
  const total = (Math.log10(a.m) + a.e) * p;
  const ei = Math.floor(total);
  return make(10 ** (total - ei), ei);
}

export const log10 = (a) => (a.m === 0 ? -Infinity : Math.log10(a.m) + a.e);

// Floor to a whole number. Values with 15 or more digits are already whole in practice.
export function floor(a) {
  if (a.m === 0 || a.e >= 15) return a;
  if (a.e < 0) return ZERO;
  return n(Math.floor(a.m * 10 ** a.e));
}

export function toNumber(a) {
  if (a.m === 0) return 0;
  if (a.e < -320) return 0;
  return a.m * 10 ** a.e;
}

// Display. Plain decimals for 0.01 up to 999999, scientific notation outside that.
export function fmt(a, digits = 2) {
  if (a.m === 0) return '0';
  if (a.e >= -2 && a.e < 6) {
    const v = a.m * 10 ** a.e;
    return v.toFixed(Math.max(0, digits - a.e));
  }
  let m = a.m.toFixed(digits);
  let e = a.e;
  if (Number(m) >= 10) {
    m = (1).toFixed(digits);
    e += 1;
  }
  return `${m}e${e}`;
}

// Whole-number display: digits with separators while small, scientific beyond a billion.
export function fmtInt(a) {
  if (a.e < 9) return Math.round(toNumber(a)).toLocaleString('en-US');
  return fmt(a, 2);
}

export const toJSON = (a) => [a.m, a.e];

export function fromJSON(v) {
  if (!Array.isArray(v) || !Number.isFinite(v[0]) || !Number.isFinite(v[1])) return ZERO;
  return make(v[0], v[1]);
}
