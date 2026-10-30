import Decimal from 'decimal.js';
import { D, ZERO, money, minDec, maxDec, sumDec, fmt, RoundingMode } from './decimal';
import { DateStr, addDays, cmp, diffDaysActual, maxDate } from './dates';
import {
  AmortizationMethod,
  DayCountBasis,
  PaymentFrequency,
  accrueInterest,
  dailyRate,
  dayCount,
  generateSchedule,
} from './schedule';

/* ------------------------------------------------------------------ */
/* Tipos públicos                                                      */
/* ------------------------------------------------------------------ */

export interface LoanContract {
  principal: string;
  monthlyRate: string;
  termCount: number;
  startDate: DateStr;
  firstDueDate: DateStr;
  method: AmortizationMethod;
  dayCount: DayCountBasis;
  frequency: PaymentFrequency;
  rounding: RoundingMode;
  graceDays: number;
  /** Tasa mensual de interés moratorio sobre capital vencido. `null` = mora deshabilitada. */
  lateInterestMonthlyRate: string | null;
  /**
   * Recargo fijo por mora. Si está definido reemplaza al interés moratorio:
   * - PER_DAY: `amount` por cada día calendario de atraso posterior a los días de gracia.
   * - PER_INSTALLMENT: `amount` una sola vez por cuota que sigue impaga al terminar la gracia.
   */
  lateFee?: LateFee | null;
}

export interface LateFee {
  type: 'PER_DAY' | 'PER_INSTALLMENT';
  amount: string;
}

export type PaymentKind = 'INSTALLMENT' | 'PRINCIPAL_PREPAYMENT' | 'PAYOFF';
export type PrepaymentPolicy = 'REDUCE_TERM' | 'REDUCE_INSTALLMENT';

export interface PaymentEvent {
  type: 'PAYMENT';
  id: string;
  seq: number;
  date: DateStr;
  amount: string;
  kind: PaymentKind;
  policy?: PrepaymentPolicy;
}

export interface RestructureEvent {
  type: 'RESTRUCTURE';
  id: string;
  seq: number;
  date: DateStr;
  monthlyRate: string;
  termCount: number;
  firstDueDate: DateStr;
  method?: AmortizationMethod;
}

export type LoanEvent = PaymentEvent | RestructureEvent;

export type InstallmentStatus =
  | 'PENDING'
  | 'PARTIAL'
  | 'PAID'
  | 'OVERDUE'
  | 'REPLACED'
  | 'RESTRUCTURED'
  | 'CANCELLED';

export type AllocationConcept =
  | 'LATE_INTEREST'
  | 'INTEREST'
  | 'PRINCIPAL'
  | 'ACCRUED_INTEREST'
  | 'PREPAYMENT_PRINCIPAL'
  | 'SURPLUS';

export interface Allocation {
  concept: AllocationConcept;
  installmentNumber: number | null;
  amount: string;
}

export interface InstallmentView {
  number: number;
  periodStart: DateStr;
  dueDate: DateStr;
  openingBalance: string;
  principal: string;
  interest: string;
  payment: string;
  closingBalance: string;
  paidPrincipal: string;
  paidInterest: string;
  lateInterestAccrued: string;
  paidLateInterest: string;
  /** Días de atraso a la fecha de corte (0 si no está vencida o ya se pagó). */
  daysOverdue: number;
  status: InstallmentStatus;
}

export type VersionReason = 'ORIGINAL' | 'PREPAYMENT' | 'RESTRUCTURE';

export interface ScheduleVersionView {
  index: number;
  reason: VersionReason;
  eventId: string | null;
  effectiveDate: DateStr;
  monthlyRate: string;
  method: AmortizationMethod;
  policy: PrepaymentPolicy | null;
  installments: InstallmentView[];
}

export interface EventResult {
  eventId: string;
  applied: string;
  unapplied: string;
  rescheduled: boolean;
  allocations: Allocation[];
  notes: string[];
}

export interface PayoffQuote {
  date: DateStr;
  overdueLateInterest: string;
  overdueInterest: string;
  accruedInterest: string;
  principalBalance: string;
  total: string;
}

export interface LedgerSnapshot {
  status: 'ACTIVE' | 'PAID_OFF';
  principalBalance: string;
  monthlyRate: string;
  versions: ScheduleVersionView[];
  current: ScheduleVersionView;
  results: EventResult[];
  totals: { principalPaid: string; interestPaid: string; lateInterestPaid: string };
}

/* ------------------------------------------------------------------ */
/* Implementación                                                      */
/* ------------------------------------------------------------------ */

interface WInst {
  number: number;
  periodStart: DateStr;
  dueDate: DateStr;
  openingBalance: Decimal;
  principal: Decimal;
  interest: Decimal;
  payment: Decimal;
  closingBalance: Decimal;
  paidPrincipal: Decimal;
  paidInterest: Decimal;
  lateAccrued: Decimal;
  paidLate: Decimal;
  lateThrough: DateStr | null;
  terminal: 'REPLACED' | 'RESTRUCTURED' | 'CANCELLED' | null;
}

interface Terms {
  monthlyRate: Decimal;
  method: AmortizationMethod;
  anchorDate: DateStr;
  anchorNumber: number;
  levelPayment: Decimal | null;
  levelPrincipal: Decimal | null;
}

interface WVersion {
  reason: VersionReason;
  eventId: string | null;
  effectiveDate: DateStr;
  terms: Terms;
  policy: PrepaymentPolicy | null;
  installments: WInst[];
}

export class LedgerError extends Error {}

const clone = (i: WInst): WInst => ({ ...i });

export class LoanLedger {
  private readonly c: LoanContract;
  private readonly rounding: RoundingMode;
  private terms!: Terms;
  private active: WInst[] = [];
  private versions: WVersion[] = [];
  private principalBalance: Decimal;
  private status: 'ACTIVE' | 'PAID_OFF' = 'ACTIVE';
  private results: EventResult[] = [];
  private lastEventDate: DateStr;

  constructor(contract: LoanContract) {
    this.c = contract;
    this.rounding = contract.rounding;
    const principal = D(contract.principal);
    if (principal.lte(0)) throw new LedgerError('El capital financiado debe ser mayor que cero');
    if (D(contract.monthlyRate).lt(0)) throw new LedgerError('La tasa no puede ser negativa');
    if (cmp(contract.firstDueDate, contract.startDate) <= 0) {
      throw new LedgerError('La primera cuota debe vencer después de la fecha de inicio');
    }
    this.principalBalance = principal;
    this.lastEventDate = contract.startDate;
    const terms: Terms = {
      monthlyRate: D(contract.monthlyRate),
      method: contract.method,
      anchorDate: contract.firstDueDate,
      anchorNumber: 1,
      levelPayment: null,
      levelPrincipal: null,
    };
    const gen = generateSchedule({
      principal,
      monthlyRate: terms.monthlyRate,
      dayCount: contract.dayCount,
      frequency: contract.frequency,
      rounding: contract.rounding,
      method: contract.method,
      startDate: contract.startDate,
      startNumber: 1,
      anchorDate: contract.firstDueDate,
      anchorNumber: 1,
      count: contract.termCount,
    });
    terms.levelPayment = gen.levelPayment;
    terms.levelPrincipal = gen.levelPrincipal;
    this.terms = terms;
    this.active = gen.installments.map((s) => this.toW(s));
    this.versions.push({
      reason: 'ORIGINAL',
      eventId: null,
      effectiveDate: contract.startDate,
      terms,
      policy: null,
      installments: this.active,
    });
  }

  /** Reproduce una secuencia de eventos ordenados por fecha efectiva y secuencia. */
  static replay(contract: LoanContract, events: LoanEvent[], asOf: DateStr): LedgerSnapshot {
    const ledger = new LoanLedger(contract);
    const ordered = [...events].sort((a, b) => cmp(a.date, b.date) || a.seq - b.seq);
    for (const ev of ordered) ledger.apply(ev);
    // La mora sigue corriendo hasta la fecha de corte aunque no haya nuevos pagos
    if (ledger.status === 'ACTIVE' && cmp(asOf, ledger.lastEventDate) > 0) ledger.accrueLate(asOf);
    return ledger.snapshot(asOf);
  }

  apply(ev: LoanEvent): EventResult {
    if (cmp(ev.date, this.c.startDate) < 0) {
      throw new LedgerError('La fecha efectiva no puede ser anterior al inicio del crédito');
    }
    if (this.status === 'PAID_OFF') throw new LedgerError('El crédito ya está cancelado');
    let result: EventResult;
    if (ev.type === 'RESTRUCTURE') result = this.restructure(ev);
    else {
      const amount = D(ev.amount);
      if (amount.lte(0)) throw new LedgerError('El monto debe ser mayor que cero');
      if (amount.decimalPlaces() > 2) throw new LedgerError('El monto admite como máximo dos decimales');
      if (ev.kind === 'INSTALLMENT') result = this.payInstallments(ev, amount);
      else if (ev.kind === 'PRINCIPAL_PREPAYMENT') result = this.prepay(ev, amount);
      else result = this.payoff(ev, amount);
    }
    this.lastEventDate = maxDate(this.lastEventDate, ev.date);
    this.results.push(result);
    return result;
  }

  /* ----------------------------- helpers ---------------------------- */

  private toW(s: {
    number: number;
    periodStart: DateStr;
    dueDate: DateStr;
    openingBalance: Decimal;
    principal: Decimal;
    interest: Decimal;
    payment: Decimal;
    closingBalance: Decimal;
  }): WInst {
    return {
      ...s,
      paidPrincipal: ZERO,
      paidInterest: ZERO,
      lateAccrued: ZERO,
      paidLate: ZERO,
      lateThrough: null,
      terminal: null,
    };
  }

  private live(): WInst[] {
    return this.active.filter((i) => i.terminal === null);
  }

  private remaining(i: WInst): Decimal {
    return i.lateAccrued.minus(i.paidLate).plus(i.interest.minus(i.paidInterest)).plus(i.principal.minus(i.paidPrincipal));
  }

  private isPaid(i: WInst): boolean {
    return this.remaining(i).lte(0);
  }

  /** Devenga la mora hasta `d`: recargo fijo (si el contrato lo define) o interés moratorio sobre capital vencido. */
  private accrueLate(d: DateStr): void {
    if (this.c.lateFee) return this.accrueLateFee(d, this.c.lateFee);
    if (this.c.lateInterestMonthlyRate === null) return;
    const rate = D(this.c.lateInterestMonthlyRate);
    if (rate.lte(0)) return;
    for (const i of this.live()) {
      const unpaidPrincipal = i.principal.minus(i.paidPrincipal);
      if (unpaidPrincipal.lte(0) || cmp(i.dueDate, d) >= 0) continue;
      const graceEnd = addDays(i.dueDate, this.c.graceDays);
      if (cmp(d, graceEnd) <= 0) continue;
      const from = i.lateThrough ?? i.dueDate;
      if (cmp(from, d) >= 0) continue;
      const days = dayCount(this.c.dayCount, from, d);
      i.lateAccrued = i.lateAccrued.plus(money(unpaidPrincipal.times(dailyRate(rate, this.c.dayCount)).times(days), this.rounding));
      i.lateThrough = d;
    }
  }

  /**
   * Recargo fijo. Los días de gracia no se cobran: con vencimiento el 10 y 3 días de gracia,
   * un pago el 15 genera 2 días de mora (14 y 15).
   */
  private accrueLateFee(d: DateStr, fee: LateFee): void {
    const amount = D(fee.amount);
    if (amount.lte(0)) return;
    for (const i of this.live()) {
      const unpaid = i.principal.minus(i.paidPrincipal).plus(i.interest.minus(i.paidInterest));
      if (unpaid.lte(0)) continue;
      const graceEnd = addDays(i.dueDate, this.c.graceDays);
      if (cmp(d, graceEnd) <= 0) continue;
      if (fee.type === 'PER_INSTALLMENT') {
        if (i.lateThrough === null) i.lateAccrued = i.lateAccrued.plus(amount);
      } else {
        const from = i.lateThrough ? maxDate(i.lateThrough, graceEnd) : graceEnd;
        const days = diffDaysActual(from, d);
        if (days > 0) i.lateAccrued = i.lateAccrued.plus(amount.times(days));
      }
      i.lateThrough = d;
    }
  }

  /** Aplica `amount` a una cuota en orden: mora → interés → capital. Devuelve el sobrante. */
  private payInto(i: WInst, amount: Decimal, allocs: Allocation[]): Decimal {
    let left = amount;
    const late = minDec(left, i.lateAccrued.minus(i.paidLate));
    if (late.gt(0)) {
      i.paidLate = i.paidLate.plus(late);
      left = left.minus(late);
      allocs.push({ concept: 'LATE_INTEREST', installmentNumber: i.number, amount: fmt(late) });
    }
    const interest = minDec(left, i.interest.minus(i.paidInterest));
    if (interest.gt(0)) {
      i.paidInterest = i.paidInterest.plus(interest);
      left = left.minus(interest);
      allocs.push({ concept: 'INTEREST', installmentNumber: i.number, amount: fmt(interest) });
    }
    const principal = minDec(left, i.principal.minus(i.paidPrincipal));
    if (principal.gt(0)) {
      i.paidPrincipal = i.paidPrincipal.plus(principal);
      this.principalBalance = this.principalBalance.minus(principal);
      left = left.minus(principal);
      allocs.push({ concept: 'PRINCIPAL', installmentNumber: i.number, amount: fmt(principal) });
    }
    return left;
  }

  /** Liquida cuotas vencidas (vencimiento <= d) en orden de antigüedad. */
  private settleOverdue(d: DateStr, amount: Decimal, allocs: Allocation[]): Decimal {
    let left = amount;
    for (const i of this.live()) {
      if (left.lte(0)) break;
      if (cmp(i.dueDate, d) > 0) break;
      if (this.isPaid(i)) continue;
      left = this.payInto(i, left, allocs);
    }
    return left;
  }

  private hasOverdue(d: DateStr): boolean {
    return this.live().some((i) => cmp(i.dueDate, d) <= 0 && !this.isPaid(i));
  }

  /** Cuota del periodo en curso a la fecha `d` (primera no pagada con vencimiento posterior). */
  private currentInstallment(d: DateStr): WInst | undefined {
    return this.live().find((i) => cmp(i.dueDate, d) > 0 && !this.isPaid(i));
  }

  /** Interés corriente devengado y no pagado entre el inicio del periodo en curso y `d`. */
  private accruedCurrent(d: DateStr): { amount: Decimal; inst?: WInst; excessPaid: Decimal } {
    const k = this.currentInstallment(d);
    if (!k || cmp(k.periodStart, d) >= 0) return { amount: ZERO, inst: k, excessPaid: ZERO };
    const accrued = money(accrueInterest(this.principalBalance, this.terms.monthlyRate, this.c.dayCount, k.periodStart, d), this.rounding);
    const net = accrued.minus(k.paidInterest);
    return { amount: maxDec(ZERO, net), inst: k, excessPaid: maxDec(ZERO, net.negated()) };
  }

  private markPaidOffIfDone(): void {
    if (this.principalBalance.lte(0) && this.live().every((i) => this.isPaid(i))) {
      this.status = 'PAID_OFF';
    }
  }

  private result(ev: LoanEvent, applied: Decimal, unapplied: Decimal, allocs: Allocation[], rescheduled = false, notes: string[] = []): EventResult {
    return { eventId: ev.id, applied: fmt(applied), unapplied: fmt(unapplied), rescheduled, allocations: allocs, notes };
  }

  /** Cierra la versión vigente y abre una nueva con las cuotas pagadas conservadas + nuevas cuotas. */
  private supersede(
    fromNumber: number,
    terminal: 'REPLACED' | 'RESTRUCTURED',
    newInsts: WInst[],
    reason: VersionReason,
    ev: LoanEvent,
    terms: Terms,
    policy: PrepaymentPolicy | null,
  ): void {
    const frozen = this.active.map((i) => {
      const c = clone(i);
      if (c.terminal === null && c.number >= fromNumber) c.terminal = terminal;
      return c;
    });
    this.versions[this.versions.length - 1].installments = frozen;
    const kept = this.active.filter((i) => i.number < fromNumber).map(clone);
    this.active = [...kept, ...newInsts];
    this.terms = terms;
    this.versions.push({ reason, eventId: ev.id, effectiveDate: ev.date, terms, policy, installments: this.active });
  }

  /* ----------------------------- eventos ---------------------------- */

  /** Pago de cuota ordinaria: cubre parciales, varias cuotas y anticipos de cuotas futuras. */
  private payInstallments(ev: PaymentEvent, amount: Decimal): EventResult {
    this.accrueLate(ev.date);
    const allocs: Allocation[] = [];
    let left = amount;
    for (const i of this.live()) {
      if (left.lte(0)) break;
      if (this.isPaid(i)) continue;
      left = this.payInto(i, left, allocs);
    }
    this.markPaidOffIfDone();
    const notes = left.gt(0) ? ['El monto excede el total de cuotas pendientes; utilice cancelación total.'] : [];
    return this.result(ev, amount.minus(left), left, allocs, false, notes);
  }

  /** Abono extraordinario a capital con recálculo de la proyección. */
  private prepay(ev: PaymentEvent, amount: Decimal): EventResult {
    const policy = ev.policy ?? 'REDUCE_TERM';
    this.accrueLate(ev.date);
    const allocs: Allocation[] = [];
    const notes: string[] = [];

    // 1. Conceptos vencidos primero.
    let left = this.settleOverdue(ev.date, amount, allocs);
    if (left.lte(0)) {
      notes.push('El monto se aplicó íntegramente a cuotas vencidas; no hubo abono a capital.');
      return this.result(ev, amount, ZERO, allocs, false, notes);
    }

    // 2. Interés corriente devengado a la fecha efectiva.
    const acc = this.accruedCurrent(ev.date);
    const k = acc.inst;
    if (!k) {
      notes.push('No existen cuotas futuras pendientes.');
      return this.result(ev, amount.minus(left), left, allocs, false, notes);
    }
    const accPay = minDec(left, acc.amount);
    if (accPay.gt(0)) {
      k.paidInterest = k.paidInterest.plus(accPay);
      left = left.minus(accPay);
      allocs.push({ concept: 'ACCRUED_INTEREST', installmentNumber: k.number, amount: fmt(accPay) });
    }
    if (left.lte(0)) {
      notes.push('El monto cubrió únicamente intereses devengados; no hubo abono a capital.');
      return this.result(ev, amount, ZERO, allocs, false, notes);
    }

    // 3. Capital.
    const toPrincipal = minDec(left, this.principalBalance);
    const unapplied = left.minus(toPrincipal);
    this.principalBalance = this.principalBalance.minus(toPrincipal);
    allocs.push({ concept: 'PREPAYMENT_PRINCIPAL', installmentNumber: null, amount: fmt(toPrincipal) });
    if (unapplied.gt(0)) notes.push('El abono excede el saldo de capital; utilice cancelación total.');

    // 4. Nueva proyección.
    const remainingCount = this.live().filter((i) => i.number >= k.number).length;
    const start = maxDate(ev.date, k.periodStart);
    let newInsts: WInst[] = [];
    let terms: Terms = { ...this.terms };
    if (this.principalBalance.gt(0)) {
      const base = {
        principal: this.principalBalance,
        monthlyRate: this.terms.monthlyRate,
        dayCount: this.c.dayCount,
        frequency: this.c.frequency,
        rounding: this.rounding,
        method: this.terms.method,
        startDate: start,
        startNumber: k.number,
        anchorDate: this.terms.anchorDate,
        anchorNumber: this.terms.anchorNumber,
      };
      const gen =
        policy === 'REDUCE_INSTALLMENT'
          ? generateSchedule({ ...base, count: remainingCount })
          : this.terms.method === 'FRENCH'
            ? generateSchedule({ ...base, fixedPayment: this.terms.levelPayment!, maxCount: remainingCount })
            : generateSchedule({ ...base, fixedPrincipal: this.terms.levelPrincipal!, maxCount: remainingCount });
      newInsts = gen.installments.map((s) => this.toW(s));
      // Interés pagado por anticipado sobre la cuota en curso se reconoce en la nueva cuota.
      if (acc.excessPaid.gt(0) && newInsts.length) {
        newInsts[0].paidInterest = minDec(acc.excessPaid, newInsts[0].interest);
      }
      if (policy === 'REDUCE_INSTALLMENT') {
        terms = { ...terms, levelPayment: gen.levelPayment, levelPrincipal: gen.levelPrincipal };
      }
    }
    this.supersede(k.number, 'REPLACED', newInsts, 'PREPAYMENT', ev, terms, policy);
    if (this.principalBalance.lte(0)) {
      this.markPaidOffIfDone();
    }
    return this.result(ev, amount.minus(unapplied), unapplied, allocs, true, notes);
  }

  /** Monto de liquidación total a una fecha. No modifica el estado. */
  quote(d: DateStr): PayoffQuote {
    const snapshotActive = this.active.map(clone);
    const balance = this.principalBalance;
    this.accrueLate(d);
    let late = ZERO;
    let interest = ZERO;
    for (const i of this.live()) {
      if (cmp(i.dueDate, d) > 0) break;
      late = late.plus(i.lateAccrued.minus(i.paidLate));
      interest = interest.plus(i.interest.minus(i.paidInterest));
    }
    const acc = this.accruedCurrent(d).amount;
    const total = late.plus(interest).plus(acc).plus(this.principalBalance);
    // restaurar
    this.active = snapshotActive;
    this.versions[this.versions.length - 1].installments = this.active;
    this.principalBalance = balance;
    return {
      date: d,
      overdueLateInterest: fmt(late),
      overdueInterest: fmt(interest),
      accruedInterest: fmt(acc),
      principalBalance: fmt(balance),
      total: fmt(total),
    };
  }

  /** Cancelación total anticipada. */
  private payoff(ev: PaymentEvent, amount: Decimal): EventResult {
    const q = this.quote(ev.date);
    if (amount.lt(D(q.total))) {
      throw new LedgerError(`El monto no cubre el saldo de liquidación (${q.total}) a la fecha ${ev.date}`);
    }
    this.accrueLate(ev.date);
    const allocs: Allocation[] = [];
    let left = this.settleOverdue(ev.date, amount, allocs);
    const acc = this.accruedCurrent(ev.date);
    if (acc.inst && acc.amount.gt(0)) {
      acc.inst.paidInterest = acc.inst.paidInterest.plus(acc.amount);
      left = left.minus(acc.amount);
      allocs.push({ concept: 'ACCRUED_INTEREST', installmentNumber: acc.inst.number, amount: fmt(acc.amount) });
    }
    const principal = this.principalBalance;
    if (principal.gt(0)) {
      allocs.push({ concept: 'PREPAYMENT_PRINCIPAL', installmentNumber: null, amount: fmt(principal) });
      left = left.minus(principal);
      this.principalBalance = ZERO;
    }
    for (const i of this.live()) {
      if (!this.isPaid(i)) i.terminal = 'CANCELLED';
    }
    if (left.gt(0)) allocs.push({ concept: 'SURPLUS', installmentNumber: null, amount: fmt(left) });
    this.status = 'PAID_OFF';
    const notes = left.gt(0) ? ['Excedente pendiente de devolución al cliente.'] : [];
    return this.result(ev, amount, ZERO, allocs, false, notes);
  }

  /** Reestructuración autorizada: capitaliza intereses pendientes y genera nueva tabla. */
  private restructure(ev: RestructureEvent): EventResult {
    this.accrueLate(ev.date);
    const pending = this.live().filter((i) => !this.isPaid(i));
    if (!pending.length) throw new LedgerError('No existen cuotas pendientes para reestructurar');
    const fromNumber = pending[0].number;
    const overdueCharges = sumDec(
      pending
        .filter((i) => cmp(i.dueDate, ev.date) <= 0)
        .map((i) => i.interest.minus(i.paidInterest).plus(i.lateAccrued.minus(i.paidLate))),
    );
    const acc = this.accruedCurrent(ev.date).amount;
    const capitalized = overdueCharges.plus(acc);
    this.principalBalance = this.principalBalance.plus(capitalized);
    if (cmp(ev.firstDueDate, ev.date) <= 0) throw new LedgerError('La nueva primera cuota debe ser posterior a la fecha de reestructuración');
    const method = ev.method ?? this.terms.method;
    const rate = D(ev.monthlyRate);
    const gen = generateSchedule({
      principal: this.principalBalance,
      monthlyRate: rate,
      dayCount: this.c.dayCount,
      frequency: this.c.frequency,
      rounding: this.rounding,
      method,
      startDate: ev.date,
      startNumber: fromNumber,
      anchorDate: ev.firstDueDate,
      anchorNumber: fromNumber,
      count: ev.termCount,
    });
    const terms: Terms = {
      monthlyRate: rate,
      method,
      anchorDate: ev.firstDueDate,
      anchorNumber: fromNumber,
      levelPayment: gen.levelPayment,
      levelPrincipal: gen.levelPrincipal,
    };
    this.supersede(fromNumber, 'RESTRUCTURED', gen.installments.map((s) => this.toW(s)), 'RESTRUCTURE', ev, terms, null);
    const notes = capitalized.gt(0) ? [`Intereses capitalizados: ${fmt(capitalized)}`] : [];
    return this.result(ev, ZERO, ZERO, [], true, notes);
  }

  /* ----------------------------- salida ----------------------------- */

  private statusOf(i: WInst, asOf: DateStr): InstallmentStatus {
    if (i.terminal) return i.terminal;
    if (this.isPaid(i)) return 'PAID';
    if (cmp(i.dueDate, asOf) < 0) return 'OVERDUE';
    if (i.paidPrincipal.plus(i.paidInterest).plus(i.paidLate).gt(0)) return 'PARTIAL';
    return 'PENDING';
  }

  private daysOverdue(i: WInst, asOf: DateStr): number {
    if (i.terminal || this.isPaid(i) || cmp(i.dueDate, asOf) >= 0) return 0;
    return diffDaysActual(i.dueDate, asOf);
  }

  private view(i: WInst, asOf: DateStr): InstallmentView {
    return {
      number: i.number,
      periodStart: i.periodStart,
      dueDate: i.dueDate,
      openingBalance: fmt(i.openingBalance),
      principal: fmt(i.principal),
      interest: fmt(i.interest),
      payment: fmt(i.payment),
      closingBalance: fmt(i.closingBalance),
      paidPrincipal: fmt(i.paidPrincipal),
      paidInterest: fmt(i.paidInterest),
      lateInterestAccrued: fmt(i.lateAccrued),
      paidLateInterest: fmt(i.paidLate),
      daysOverdue: this.daysOverdue(i, asOf),
      status: this.statusOf(i, asOf),
    };
  }

  snapshot(asOf: DateStr): LedgerSnapshot {
    const versions: ScheduleVersionView[] = this.versions.map((v, index) => ({
      index,
      reason: v.reason,
      eventId: v.eventId,
      effectiveDate: v.effectiveDate,
      monthlyRate: v.terms.monthlyRate.toString(),
      method: v.terms.method,
      policy: v.policy,
      installments: v.installments.map((i) => this.view(i, asOf)),
    }));
    const all = this.results.flatMap((r) => r.allocations);
    const sumOf = (concepts: AllocationConcept[]) =>
      fmt(sumDec(all.filter((a) => concepts.includes(a.concept)).map((a) => D(a.amount))));
    return {
      status: this.status,
      principalBalance: fmt(this.principalBalance),
      monthlyRate: this.terms.monthlyRate.toString(),
      versions,
      current: versions[versions.length - 1],
      results: this.results,
      totals: {
        principalPaid: sumOf(['PRINCIPAL', 'PREPAYMENT_PRINCIPAL']),
        interestPaid: sumOf(['INTEREST', 'ACCRUED_INTEREST']),
        lateInterestPaid: sumOf(['LATE_INTEREST']),
      },
    };
  }

  get balance(): string {
    return fmt(this.principalBalance);
  }
}
