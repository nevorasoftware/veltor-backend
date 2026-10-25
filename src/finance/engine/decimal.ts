import Decimal from 'decimal.js';

/**
 * Aritmética decimal de precisión controlada para el motor financiero VELTOR.
 * Nunca usar `number` para montos monetarios.
 */
export const FinDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN';

export const D = (v: Decimal.Value): Decimal => new FinDecimal(v);
export const ZERO = D(0);

export function money(v: Decimal, mode: RoundingMode = 'HALF_UP'): Decimal {
  return v.toDecimalPlaces(2, mode === 'HALF_EVEN' ? Decimal.ROUND_HALF_EVEN : Decimal.ROUND_HALF_UP);
}

export function minDec(a: Decimal, b: Decimal): Decimal {
  return a.lessThan(b) ? a : b;
}

export function maxDec(a: Decimal, b: Decimal): Decimal {
  return a.greaterThan(b) ? a : b;
}

export function sumDec(values: Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}

/** Serializa a string con 2 decimales (formato de persistencia/API). */
export function fmt(v: Decimal): string {
  return v.toFixed(2);
}
