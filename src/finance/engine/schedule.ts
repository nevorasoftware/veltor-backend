import Decimal from 'decimal.js';
import { D, ZERO, money, minDec, maxDec, RoundingMode } from './decimal';
import { DateStr, addDays, addMonths, diffDays30E360, diffDaysActual, parse } from './dates';

export type DayCountBasis = 'D30_360' | 'ACT_360' | 'ACT_365';
export type AmortizationMethod = 'FRENCH' | 'CONSTANT_PRINCIPAL';
export type PaymentFrequency = 'MONTHLY' | 'BIWEEKLY' | 'WEEKLY';

export const PERIODS_PER_YEAR: Record<PaymentFrequency, number> = {
  MONTHLY: 12,
  BIWEEKLY: 26,
  WEEKLY: 52,
};

export interface RateConfig {
  monthlyRate: Decimal; // tasa mensual en decimal (0.015 = 1.5 %)
  dayCount: DayCountBasis;
  frequency: PaymentFrequency;
  rounding: RoundingMode;
}

/** Tasa periódica equivalente nominal según la frecuencia de pago. */
export function periodicRate(cfg: Pick<RateConfig, 'monthlyRate' | 'frequency'>): Decimal {
  return cfg.monthlyRate.times(12).dividedBy(PERIODS_PER_YEAR[cfg.frequency]);
}

/** Tasa diaria según la base de cálculo. */
export function dailyRate(monthlyRate: Decimal, basis: DayCountBasis): Decimal {
  switch (basis) {
    case 'D30_360':
      return monthlyRate.dividedBy(30);
    case 'ACT_360':
      return monthlyRate.times(12).dividedBy(360);
    case 'ACT_365':
      return monthlyRate.times(12).dividedBy(365);
  }
}

export function dayCount(basis: DayCountBasis, from: DateStr, to: DateStr): number {
  return basis === 'D30_360' ? diffDays30E360(from, to) : diffDaysActual(from, to);
}

/** Interés devengado (sin redondear) sobre un saldo entre dos fechas. */
export function accrueInterest(balance: Decimal, monthlyRate: Decimal, basis: DayCountBasis, from: DateStr, to: DateStr): Decimal {
  const days = dayCount(basis, from, to);
  if (days <= 0 || balance.lte(0)) return ZERO;
  return balance.times(dailyRate(monthlyRate, basis)).times(days);
}

/** Fecha de vencimiento de la cuota `number` dado un ancla (fecha de la cuota `anchorNumber`). */
export function dueDateFor(anchorDate: DateStr, anchorNumber: number, number: number, frequency: PaymentFrequency): DateStr {
  const offset = number - anchorNumber;
  switch (frequency) {
    case 'MONTHLY':
      return addMonths(anchorDate, offset, parse(anchorDate).day);
    case 'BIWEEKLY':
      return addDays(anchorDate, offset * 14);
    case 'WEEKLY':
      return addDays(anchorDate, offset * 7);
  }
}

/**
 * Cuota nivelada (amortización francesa):
 *   Cuota = P × i / (1 − (1 + i)^(−n));  si i = 0 → P / n
 */
export function levelPayment(principal: Decimal, rate: Decimal, n: number, rounding: RoundingMode = 'HALF_UP'): Decimal {
  if (n <= 0) throw new Error('El número de cuotas debe ser mayor que cero');
  if (principal.lte(0)) return ZERO;
  if (rate.isZero()) return money(principal.dividedBy(n), rounding);
  const factor = D(1).minus(D(1).plus(rate).pow(-n));
  return money(principal.times(rate).dividedBy(factor), rounding);
}

export interface ScheduledInstallment {
  number: number;
  periodStart: DateStr;
  dueDate: DateStr;
  openingBalance: Decimal;
  principal: Decimal;
  interest: Decimal;
  payment: Decimal;
  closingBalance: Decimal;
}

export interface GenerateParams extends RateConfig {
  principal: Decimal;
  method: AmortizationMethod;
  /** Fecha desde la cual corre el interés de la primera cuota generada. */
  startDate: DateStr;
  /** Número de la primera cuota generada. */
  startNumber: number;
  /** Ancla del calendario de vencimientos. */
  anchorDate: DateStr;
  anchorNumber: number;
  /** Modo A: número fijo de cuotas (recalcula cuota). */
  count?: number;
  /** Modo B (reducir plazo): cuota nivelada fija (francés) o capital fijo (capital constante). */
  fixedPayment?: Decimal;
  fixedPrincipal?: Decimal;
  maxCount?: number;
}

export interface GeneratedSchedule {
  installments: ScheduledInstallment[];
  levelPayment: Decimal | null;
  levelPrincipal: Decimal | null;
}

/**
 * Genera una tabla de amortización.
 * - Periodos regulares con base 30/360 usan exactamente la tasa periódica.
 * - Periodos irregulares (primera cuota en fecha distinta, reprogramaciones) y
 *   bases Actual/360 o Actual/365 usan días transcurridos × tasa diaria.
 * - La última cuota liquida el saldo remanente (ajuste de redondeo).
 */
export function generateSchedule(p: GenerateParams): GeneratedSchedule {
  const r = periodicRate(p);
  const fixedMode = p.fixedPayment !== undefined || p.fixedPrincipal !== undefined;
  if (!fixedMode && (!p.count || p.count <= 0)) throw new Error('Debe indicar el número de cuotas');
  const maxCount = fixedMode ? p.maxCount ?? 1200 : p.count!;

  let level: Decimal | null = null;
  let levelPrincipal: Decimal | null = null;
  if (p.method === 'FRENCH') {
    level = p.fixedPayment ?? levelPayment(p.principal, r, p.count!, p.rounding);
  } else {
    levelPrincipal = p.fixedPrincipal ?? money(p.principal.dividedBy(p.count!), p.rounding);
  }

  const out: ScheduledInstallment[] = [];
  let balance = p.principal;
  if (balance.lte(0)) return { installments: [], levelPayment: level, levelPrincipal };

  for (let j = 0; j < maxCount; j++) {
    const number = p.startNumber + j;
    const due = dueDateFor(p.anchorDate, p.anchorNumber, number, p.frequency);
    const prevDue = dueDateFor(p.anchorDate, p.anchorNumber, number - 1, p.frequency);
    const from = j === 0 ? p.startDate : prevDue;
    const regular = from === prevDue;
    const rawInterest =
      regular && p.dayCount === 'D30_360' ? balance.times(r) : accrueInterest(balance, p.monthlyRate, p.dayCount, from, due);
    const interest = money(rawInterest, p.rounding);

    let principal: Decimal;
    const lastByCount = j === maxCount - 1;
    if (p.method === 'FRENCH') {
      if (fixedMode && level!.lte(interest) && j > 0) {
        throw new Error('La cuota fija no cubre los intereses del periodo (amortización negativa)');
      }
      principal = lastByCount ? balance : minDec(balance, maxDec(ZERO, level!.minus(interest)));
    } else {
      principal = lastByCount ? balance : minDec(balance, levelPrincipal!);
    }

    const closing = balance.minus(principal);
    out.push({
      number,
      periodStart: from,
      dueDate: due,
      openingBalance: balance,
      principal,
      interest,
      payment: principal.plus(interest),
      closingBalance: closing,
    });
    balance = closing;
    if (balance.lte(0)) break;
  }
  if (balance.gt(0)) throw new Error('No fue posible amortizar el saldo en el plazo máximo');
  return { installments: out, levelPayment: level, levelPrincipal };
}
