import type { Cents } from './types.js';

/** Parse a dollar string/number into integer cents. Throws on garbage. */
export function toCents(dollars: number | string): Cents {
  const n = typeof dollars === 'string' ? Number(dollars.replace(/[$,\s]/g, '')) : dollars;
  if (!Number.isFinite(n)) throw new Error(`Not a valid money amount: ${dollars}`);
  return Math.round(n * 100);
}

/** Format integer cents as a USD string, e.g. 9950 -> "$99.50". */
export function fmt(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toFixed(2)}`;
}
