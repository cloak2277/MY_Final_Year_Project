// Small shared helpers: async error wrapper, input coercion, rate limiting.

// Express 4 does not catch rejected promises — wrap async handlers so errors reach the error middleware.
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Trimmed string or '' (never throws on non-strings).
export const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Whole number or NaN.
export const int = (v) => ((typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && Number.isInteger(Number(v)) ? Number(v) : NaN);

export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 150;

// Failed-login limiter (in memory, per email + IP): 10 failures per 15 minutes.
const WINDOW_MS = 15 * 60 * 1000, MAX_FAILS = 10;
const fails = new Map();
const keyOf = (req, email) => `${req.ip}|${email}`;
export function loginBlocked(req, email) {
  const rec = fails.get(keyOf(req, email));
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) { fails.delete(keyOf(req, email)); return false; }
  return rec.n >= MAX_FAILS;
}
export function loginFailed(req, email) {
  const k = keyOf(req, email), rec = fails.get(k);
  if (!rec || Date.now() - rec.first > WINDOW_MS) fails.set(k, { n: 1, first: Date.now() });
  else rec.n++;
}
export function loginOk(req, email) { fails.delete(keyOf(req, email)); }
