import { D } from './decimal';
import { LoanContract, LoanLedger, PaymentEvent, firstDueDateForDay } from './index';

// Escenario del negocio: cuota el 10 de cada mes, 3 días de gracia.
describe('Mora con recargo fijo (por día o por cuota)', () => {
  const base: LoanContract = {
    principal: '10000.00',
    monthlyRate: '0.015',
    termCount: 12,
    startDate: '2026-01-10',
    firstDueDate: '2026-02-10',
    method: 'FRENCH',
    dayCount: 'D30_360',
    frequency: 'MONTHLY',
    rounding: 'HALF_UP',
    graceDays: 3,
    lateInterestMonthlyRate: '0.03', // ignorado cuando hay recargo fijo
  };
  const perDay: LoanContract = { ...base, lateFee: { type: 'PER_DAY', amount: '5' } };
  const perInstallment: LoanContract = { ...base, lateFee: { type: 'PER_INSTALLMENT', amount: '20' } };

  const cuota = () => D(new LoanLedger(base).snapshot('2026-01-10').current.installments[0].payment);
  const pay = (date: string, amount: string, seq = 1): PaymentEvent => ({ type: 'PAYMENT', id: `p${seq}`, seq, date, amount, kind: 'INSTALLMENT' });
  const first = (c: LoanContract, events: PaymentEvent[], asOf: string) =>
    LoanLedger.replay(c, events, asOf).current.installments[0];

  it('dentro de la gracia (hasta el día 13) no hay mora', () => {
    expect(first(perDay, [], '2026-02-13').lateInterestAccrued).toBe('0.00');
    expect(first(perInstallment, [], '2026-02-13').lateInterestAccrued).toBe('0.00');
  });

  it('por día: suma $5 por cada día después de la gracia hasta la fecha de corte', () => {
    expect(first(perDay, [], '2026-02-14').lateInterestAccrued).toBe('5.00');
    const inst = first(perDay, [], '2026-02-20');
    expect(inst.lateInterestAccrued).toBe('35.00'); // del 14 al 20 = 7 días
    expect(inst.daysOverdue).toBe(10);
    expect(inst.status).toBe('OVERDUE');
  });

  it('por día: pago el 15 cobra 2 días ($10) y deja de correr al pagar', () => {
    const amount = cuota().plus(10).toFixed(2);
    const res = LoanLedger.replay(perDay, [pay('2026-02-15', amount)], '2026-03-01');
    const inst = res.current.installments[0];
    expect(inst.lateInterestAccrued).toBe('10.00');
    expect(inst.paidLateInterest).toBe('10.00');
    expect(inst.status).toBe('PAID');
    expect(res.results[0].allocations[0]).toEqual({ concept: 'LATE_INTEREST', installmentNumber: 1, amount: '10.00' });
  });

  it('por día: un pago que no cubre la cuota no detiene la mora', () => {
    const inst = first(perDay, [pay('2026-02-15', '50.00')], '2026-02-18');
    expect(inst.lateInterestAccrued).toBe('25.00'); // 14 al 18 = 5 días
    expect(inst.status).toBe('OVERDUE');
  });

  it('por cuota: suma $20 una sola vez al terminar la gracia', () => {
    expect(first(perInstallment, [], '2026-02-14').lateInterestAccrued).toBe('20.00');
    expect(first(perInstallment, [], '2026-03-05').lateInterestAccrued).toBe('20.00');
    const inst = first(perInstallment, [pay('2026-02-16', '100.00')], '2026-02-28');
    expect(inst.lateInterestAccrued).toBe('20.00');
  });

  it('por cuota: pagar dentro de la gracia no genera recargo', () => {
    const inst = first(perInstallment, [pay('2026-02-12', cuota().toFixed(2))], '2026-03-01');
    expect(inst.lateInterestAccrued).toBe('0.00');
    expect(inst.status).toBe('PAID');
  });

  it('el recargo aplica por cada cuota vencida', () => {
    const res = LoanLedger.replay(perInstallment, [], '2026-03-14');
    const [a, b] = res.current.installments;
    expect(a.lateInterestAccrued).toBe('20.00');
    expect(b.lateInterestAccrued).toBe('20.00');
  });
});

describe('Primera cuota según día de pago', () => {
  it.each([
    ['2026-10-29', 10, '2026-12-10'],
    ['2026-10-15', 10, '2026-11-10'],
    ['2026-10-01', 10, '2026-11-10'],
    ['2026-10-29', 2, '2026-12-02'],
    ['2026-12-20', 28, '2027-01-28'],
  ])('desembolso %s, día %i → %s', (disb, day, expected) => {
    expect(firstDueDateForDay(disb, day)).toBe(expected);
  });
});
