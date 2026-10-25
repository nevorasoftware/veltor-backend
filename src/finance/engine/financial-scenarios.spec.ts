import { D, fmt, sumDec } from './decimal';
import {
  LoanContract,
  LoanLedger,
  PaymentEvent,
  RestructureEvent,
  simulate,
  generateSchedule,
  dueDateFor,
} from './index';

describe('VELTOR Motor Financiero — 17 Escenarios Obligatorios', () => {
  const baseContract: LoanContract = {
    principal: '10000.00',
    monthlyRate: '0.015', // 1.5% mensual (18% anual nominal)
    termCount: 12,
    startDate: '2026-01-01',
    firstDueDate: '2026-02-01',
    method: 'FRENCH',
    dayCount: 'D30_360',
    frequency: 'MONTHLY',
    rounding: 'HALF_UP',
    graceDays: 5,
    lateInterestMonthlyRate: '0.03', // 3% mensual sobre mora
  };

  // 1. Tasa de interés cero
  it('Escenario 1: Tasa de interés cero (0% interés, cuota P / n exacta)', () => {
    const res = simulate({
      vehiclePrice: '12000.00',
      downPayment: '2000.00',
      financedFees: '0.00',
      upfrontFees: '0.00',
      monthlyRate: '0.0',
      termCount: 10,
      startDate: '2026-01-01',
      firstDueDate: '2026-02-01',
      method: 'FRENCH',
      dayCount: 'D30_360',
      frequency: 'MONTHLY',
      rounding: 'HALF_UP',
    });

    expect(res.principal).toBe('10000.00');
    expect(res.installment).toBe('1000.00');
    expect(res.totalInterest).toBe('0.00');
    expect(res.totalPayments).toBe('10000.00');
    expect(res.schedule).toHaveLength(10);
    res.schedule.forEach((i) => {
      expect(i.interest).toBe('0.00');
      expect(i.principal).toBe('1000.00');
      expect(i.payment).toBe('1000.00');
    });
    expect(res.schedule[9].closingBalance).toBe('0.00');
  });

  // 2. Prima igual al precio del vehículo
  it('Escenario 2: Prima igual al precio del vehículo (capital = 0, no genera deuda)', () => {
    const res = simulate({
      vehiclePrice: '15000.00',
      downPayment: '15000.00',
      financedFees: '0.00',
      upfrontFees: '0.00',
      monthlyRate: '0.015',
      termCount: 24,
      startDate: '2026-01-01',
      firstDueDate: '2026-02-01',
      method: 'FRENCH',
      dayCount: 'D30_360',
      frequency: 'MONTHLY',
      rounding: 'HALF_UP',
    });

    expect(res.principal).toBe('0.00');
    expect(res.installment).toBe('0.00');
    expect(res.totalInterest).toBe('0.00');
    expect(res.totalPayments).toBe('0.00');
    expect(res.totalCost).toBe('15000.00');
    expect(res.schedule).toHaveLength(0);
  });

  // 3. Diferentes plazos y tasas
  it('Escenario 3: Diferentes plazos y tasas (12m, 24m, 48m, 60m con amortización completa)', () => {
    const testCases = [
      { terms: 12, rate: '0.012' },
      { terms: 24, rate: '0.015' },
      { terms: 48, rate: '0.018' },
      { terms: 60, rate: '0.020' },
    ];

    for (const tc of testCases) {
      const res = simulate({
        vehiclePrice: '20000.00',
        downPayment: '5000.00',
        financedFees: '500.00',
        upfrontFees: '0.00',
        monthlyRate: tc.rate,
        termCount: tc.terms,
        startDate: '2026-01-01',
        firstDueDate: '2026-02-01',
        method: 'FRENCH',
        dayCount: 'D30_360',
        frequency: 'MONTHLY',
        rounding: 'HALF_UP',
      });

      expect(res.principal).toBe('15500.00');
      expect(res.schedule).toHaveLength(tc.terms);
      expect(res.schedule[tc.terms - 1].closingBalance).toBe('0.00');
      // La suma de amortizaciones de capital debe dar exactamente el capital inicial financiado
      const sumCapital = sumDec(res.schedule.map((s) => D(s.principal)));
      expect(fmt(sumCapital)).toBe('15500.00');
    }
  });

  // 4. Primera cuota en una fecha distinta del inicio del crédito (periodo irregular)
  it('Escenario 4: Primera cuota en fecha irregular (45 días transcurridos devengan días reales)', () => {
    const sched = generateSchedule({
      principal: D('10000.00'),
      monthlyRate: D('0.015'),
      dayCount: 'ACT_360',
      frequency: 'MONTHLY',
      rounding: 'HALF_UP',
      method: 'FRENCH',
      startDate: '2026-01-01',
      startNumber: 1,
      anchorDate: '2026-02-15', // 45 días
      anchorNumber: 1,
      count: 12,
    });

    expect(sched.installments).toHaveLength(12);
    // 45 días sobre base 360 con 1.5% mensual (18% anual)
    // 10000 * 0.18 * 45 / 360 = 225.00
    expect(fmt(sched.installments[0].interest)).toBe('225.00');
    expect(sched.installments[11].closingBalance.isZero()).toBe(true);
  });

  // 5. Pago realizado exactamente en el vencimiento
  it('Escenario 5: Pago realizado exactamente en el vencimiento (sin mora, cubre cuota)', () => {
    const ledger = new LoanLedger(baseContract);
    const inst1 = ledger.snapshot('2026-01-01').current.installments[0];
    const cuota = inst1.payment;

    const res = ledger.apply({
      type: 'PAYMENT',
      id: 'pay-1',
      seq: 1,
      date: '2026-02-01',
      amount: cuota,
      kind: 'INSTALLMENT',
    });

    expect(res.applied).toBe(cuota);
    expect(res.allocations.some((a) => a.concept === 'LATE_INTEREST')).toBe(false);
    expect(res.allocations.find((a) => a.concept === 'INTEREST')?.amount).toBe(inst1.interest);
    expect(res.allocations.find((a) => a.concept === 'PRINCIPAL')?.amount).toBe(inst1.principal);

    const snap = ledger.snapshot('2026-02-01');
    expect(snap.current.installments[0].status).toBe('PAID');
  });

  // 6. Pago realizado después del vencimiento (con intereses moratorios devengados)
  it('Escenario 6: Pago realizado con mora después de periodo de gracia', () => {
    const ledger = new LoanLedger(baseContract);
    // Vencimiento: 2026-02-01. Gracia: 5 días (hasta 2026-02-06).
    // Pago el 2026-02-21 (20 días de mora tras vencimiento).
    const snapBefore = ledger.snapshot('2026-02-01');
    const capitalCuota1 = D(snapBefore.current.installments[0].principal);
    // Mora = capital * (0.03 / 30) * 20 días = capital * 0.02
    const moraEsperada = capitalCuota1.times(0.02).toFixed(2);

    const res = ledger.apply({
      type: 'PAYMENT',
      id: 'pay-late',
      seq: 1,
      date: '2026-02-21',
      amount: '1200.00',
      kind: 'INSTALLMENT',
    });

    const lateAlloc = res.allocations.find((a) => a.concept === 'LATE_INTEREST');
    expect(lateAlloc).toBeDefined();
    expect(lateAlloc?.amount).toBe(moraEsperada);
  });

  // 7. Pago parcial
  it('Escenario 7: Pago parcial (cubre mora e interés primero, saldo parcial en capital)', () => {
    const ledger = new LoanLedger(baseContract);
    const inst1 = ledger.snapshot('2026-01-01').current.installments[0];
    const interest = D(inst1.interest);
    // Monto que cubre el interés y solo 200 de capital
    const partialAmount = interest.plus(200).toFixed(2);

    const res = ledger.apply({
      type: 'PAYMENT',
      id: 'pay-part',
      seq: 1,
      date: '2026-02-01',
      amount: partialAmount,
      kind: 'INSTALLMENT',
    });

    expect(res.allocations.find((a) => a.concept === 'INTEREST')?.amount).toBe(inst1.interest);
    expect(res.allocations.find((a) => a.concept === 'PRINCIPAL')?.amount).toBe('200.00');

    const snap = ledger.snapshot('2026-02-01');
    expect(snap.current.installments[0].status).toBe('PARTIAL');
  });

  // 8. Pago duplicado
  it('Escenario 8: Pago duplicado (el segundo abona a la cuota siguiente o genera excedente controlado)', () => {
    const ledger = new LoanLedger(baseContract);
    const snap = ledger.snapshot('2026-01-01');
    const cuota = snap.current.installments[0].payment;

    ledger.apply({
      type: 'PAYMENT',
      id: 'pay-1',
      seq: 1,
      date: '2026-02-01',
      amount: cuota,
      kind: 'INSTALLMENT',
    });

    // Segundo pago el mismo día por el mismo monto
    const res2 = ledger.apply({
      type: 'PAYMENT',
      id: 'pay-2',
      seq: 2,
      date: '2026-02-01',
      amount: cuota,
      kind: 'INSTALLMENT',
    });

    // Se aplicó a la cuota 2
    expect(res2.allocations.some((a) => a.installmentNumber === 2)).toBe(true);
    const snapAfter = ledger.snapshot('2026-02-01');
    expect(snapAfter.current.installments[0].status).toBe('PAID');
    expect(snapAfter.current.installments[1].status).toBe('PAID');
  });

  // 9. Abono extraordinario a capital
  it('Escenario 9: Abono extraordinario a capital (actualiza capital y reprograma)', () => {
    const ledger = new LoanLedger(baseContract);
    // Paga cuota 1
    ledger.apply({
      type: 'PAYMENT',
      id: 'p1',
      seq: 1,
      date: '2026-02-01',
      amount: ledger.snapshot('2026-02-01').current.installments[0].payment,
      kind: 'INSTALLMENT',
    });

    const saldoAntesAbono = D(ledger.balance);
    // Abono de $2,000 a capital
    const res = ledger.apply({
      type: 'PAYMENT',
      id: 'prep-1',
      seq: 2,
      date: '2026-02-01',
      amount: '2000.00',
      kind: 'PRINCIPAL_PREPAYMENT',
      policy: 'REDUCE_TERM',
    });

    expect(res.rescheduled).toBe(true);
    expect(res.allocations.find((a) => a.concept === 'PREPAYMENT_PRINCIPAL')?.amount).toBe('2000.00');
    expect(ledger.balance).toBe(saldoAntesAbono.minus(2000).toFixed(2));
  });

  // 10. Abono extraordinario que reduce el plazo
  it('Escenario 10: Abono extraordinario con política REDUCE_TERM (reduce número de cuotas)', () => {
    const ledger = new LoanLedger(baseContract);
    // Paga cuota 1
    ledger.apply({
      type: 'PAYMENT',
      id: 'p1',
      seq: 1,
      date: '2026-02-01',
      amount: ledger.snapshot('2026-02-01').current.installments[0].payment,
      kind: 'INSTALLMENT',
    });

    // Abono sustancial de $4,000
    ledger.apply({
      type: 'PAYMENT',
      id: 'prep-term',
      seq: 2,
      date: '2026-02-01',
      amount: '4000.00',
      kind: 'PRINCIPAL_PREPAYMENT',
      policy: 'REDUCE_TERM',
    });

    const snap = ledger.snapshot('2026-02-01');
    // Las cuotas restantes deben ser menos de las 11 originales
    expect(snap.current.installments.length).toBeLessThan(12);
    // La última cuota cierra en 0.00
    const last = snap.current.installments[snap.current.installments.length - 1];
    expect(last.closingBalance).toBe('0.00');
  });

  // 11. Abono extraordinario que reduce la cuota
  it('Escenario 11: Abono extraordinario con política REDUCE_INSTALLMENT (mantiene plazo, cuota menor)', () => {
    const ledger = new LoanLedger(baseContract);
    const snap1 = ledger.snapshot('2026-02-01');
    const cuotaOriginal = D(snap1.current.installments[1].payment);

    // Paga cuota 1
    ledger.apply({
      type: 'PAYMENT',
      id: 'p1',
      seq: 1,
      date: '2026-02-01',
      amount: snap1.current.installments[0].payment,
      kind: 'INSTALLMENT',
    });

    // Abono de $3,000 reduciendo cuota
    ledger.apply({
      type: 'PAYMENT',
      id: 'prep-inst',
      seq: 2,
      date: '2026-02-01',
      amount: '3000.00',
      kind: 'PRINCIPAL_PREPAYMENT',
      policy: 'REDUCE_INSTALLMENT',
    });

    const snap2 = ledger.snapshot('2026-02-01');
    // Mantiene las 12 cuotas totales en la proyección vigente
    expect(snap2.current.installments.length).toBe(12);
    // La cuota de los periodos subsiguientes debe ser estrictamente menor
    const nuevaCuota = D(snap2.current.installments[1].payment);
    expect(nuevaCuota.lessThan(cuotaOriginal)).toBe(true);
  });

  // 12. Cancelación anticipada
  it('Escenario 12: Cancelación anticipada (cotización exacta liquida todo y cierra el crédito)', () => {
    const ledger = new LoanLedger(baseContract);
    // Paga cuota 1
    ledger.apply({
      type: 'PAYMENT',
      id: 'p1',
      seq: 1,
      date: '2026-02-01',
      amount: ledger.snapshot('2026-02-01').current.installments[0].payment,
      kind: 'INSTALLMENT',
    });

    // Cotización al 2026-02-15 (a mitad de periodo)
    const quote = ledger.quote('2026-02-15');
    expect(D(quote.total).gt(0)).toBe(true);

    const res = ledger.apply({
      type: 'PAYMENT',
      id: 'payoff-1',
      seq: 2,
      date: '2026-02-15',
      amount: quote.total,
      kind: 'PAYOFF',
    });

    expect(res.applied).toBe(quote.total);
    const snap = ledger.snapshot('2026-02-15');
    expect(snap.status).toBe('PAID_OFF');
    expect(snap.principalBalance).toBe('0.00');
  });

  // 13. Reversión de un pago
  it('Escenario 13: Reversión de un pago (reconstruye el estado desde los eventos no revertidos)', () => {
    const events: PaymentEvent[] = [
      {
        type: 'PAYMENT',
        id: 'p1',
        seq: 1,
        date: '2026-02-01',
        amount: '916.80',
        kind: 'INSTALLMENT',
      },
      {
        type: 'PAYMENT',
        id: 'p2-erroneo',
        seq: 2,
        date: '2026-02-10',
        amount: '2000.00',
        kind: 'PRINCIPAL_PREPAYMENT',
        policy: 'REDUCE_TERM',
      },
    ];

    // Con el pago erróneo
    const snapConError = LoanLedger.replay(baseContract, events, '2026-02-15');
    const saldoConError = snapConError.principalBalance;

    // Al revertir p2-erroneo, simplemente no se incluye en la reproducción
    const eventsSinError = events.filter((e) => e.id !== 'p2-erroneo');
    const snapRevertido = LoanLedger.replay(baseContract, eventsSinError, '2026-02-15');

    expect(D(snapRevertido.principalBalance).gt(D(saldoConError))).toBe(true);
    expect(snapRevertido.versions).toHaveLength(1); // Solo la versión original, la reprogramada desapareció
    expect(snapRevertido.current.installments[0].status).toBe('PAID');
    expect(snapRevertido.current.installments[1].status).toBe('PENDING');
  });

  // 14. Reestructuración autorizada
  it('Escenario 14: Reestructuración autorizada (capitaliza intereses vencidos y extiende plazo)', () => {
    const ledger = new LoanLedger(baseContract);
    // Supongamos que el cliente no pagó cuotas 1 y 2 hasta el 2026-03-15
    const restr: RestructureEvent = {
      type: 'RESTRUCTURE',
      id: 'restr-1',
      seq: 1,
      date: '2026-03-15',
      monthlyRate: '0.012', // Tasa reducida de apoyo
      termCount: 24, // Ampliación a 24 meses
      firstDueDate: '2026-04-15',
    };

    const res = ledger.apply(restr);
    expect(res.rescheduled).toBe(true);

    const snap = ledger.snapshot('2026-03-15');
    expect(snap.versions).toHaveLength(2);
    expect(snap.versions[1].reason).toBe('RESTRUCTURE');
    expect(snap.current.monthlyRate).toBe('0.012');
    expect(snap.current.installments.length).toBe(24);
  });

  // 15. Última cuota con ajustes de redondeo
  it('Escenario 15: Última cuota liquida exactamente el saldo restante a cero sin decimales huérfanos', () => {
    // Casos con números periódicos que generan fracciones
    const res = simulate({
      vehiclePrice: '17333.33',
      downPayment: '2333.33',
      financedFees: '127.89',
      upfrontFees: '0.00',
      monthlyRate: '0.013333',
      termCount: 37,
      startDate: '2026-01-15',
      firstDueDate: '2026-02-15',
      method: 'FRENCH',
      dayCount: 'D30_360',
      frequency: 'MONTHLY',
      rounding: 'HALF_UP',
    });

    const last = res.schedule[res.schedule.length - 1];
    expect(last.closingBalance).toBe('0.00');

    // La suma de todas las amortizaciones de capital debe ser idéntica al principal
    const sumCapital = sumDec(res.schedule.map((i) => D(i.principal)));
    expect(fmt(sumCapital)).toBe(res.principal);
  });

  // 16. Movimientos realizados entre fechas de vencimiento
  it('Escenario 16: Movimientos entre fechas de vencimiento (devengo exacto de días transcurridos)', () => {
    const ledger = new LoanLedger(baseContract);
    // Paga cuota 1 el 2026-02-01
    ledger.apply({
      type: 'PAYMENT',
      id: 'p1',
      seq: 1,
      date: '2026-02-01',
      amount: ledger.snapshot('2026-02-01').current.installments[0].payment,
      kind: 'INSTALLMENT',
    });

    // Abono extraordinario a mitad del periodo 2 (15 de febrero)
    const res = ledger.apply({
      type: 'PAYMENT',
      id: 'p-mid',
      seq: 2,
      date: '2026-02-15',
      amount: '1500.00',
      kind: 'PRINCIPAL_PREPAYMENT',
      policy: 'REDUCE_TERM',
    });

    // 14 días transcurridos entre 2026-02-01 y 2026-02-15 deben reconocerse como interés devengado
    const accruedAlloc = res.allocations.find((a) => a.concept === 'ACCRUED_INTEREST');
    expect(accruedAlloc).toBeDefined();
    expect(D(accruedAlloc!.amount).gt(0)).toBe(true);
    // El resto debe ir a capital
    const prepAlloc = res.allocations.find((a) => a.concept === 'PREPAYMENT_PRINCIPAL');
    expect(prepAlloc).toBeDefined();
    expect(D(accruedAlloc!.amount).plus(D(prepAlloc!.amount)).toFixed(2)).toBe('1500.00');
  });

  // 17. Dos operaciones concurrentes sobre el mismo crédito
  it('Escenario 17: Secuencia e idempotencia de operaciones concurrentes', () => {
    // Al reproducir eventos concurrentes con la misma fecha pero secuencia definida,
    // el saldo se calcula en estricto orden de secuencia sin duplicación ni race conditions
    const events: PaymentEvent[] = [
      {
        type: 'PAYMENT',
        id: 'trx-A',
        seq: 1,
        date: '2026-02-01',
        amount: '500.00',
        kind: 'INSTALLMENT',
      },
      {
        type: 'PAYMENT',
        id: 'trx-B',
        seq: 2,
        date: '2026-02-01',
        amount: '500.00',
        kind: 'INSTALLMENT',
      },
    ];

    const snap = LoanLedger.replay(baseContract, events, '2026-02-01');
    const cuotaTotal = D(snap.current.installments[0].payment);
    // Dos transacciones de 500 cubren exactamente 1000 de la cuota 1 o saldo siguiente
    const totalPagado = D(snap.totals.principalPaid).plus(D(snap.totals.interestPaid));
    expect(totalPagado.toFixed(2)).toBe('1000.00');
    expect(snap.results).toHaveLength(2);
    expect(snap.results[0].eventId).toBe('trx-A');
    expect(snap.results[1].eventId).toBe('trx-B');
  });
});
