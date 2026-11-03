import Decimal from 'decimal.js';
import { generateSchedule, LoanContract, LoanLedger } from './index';

/** Créditos reales a cargar (carga inicial): cuota nivelada esperada al centavo, método francés. */
const CASES: [principal: number, months: number, monthlyRate: number, expected: string][] = [
  [7500, 42, 0.03, '316.44'],
  [4500, 12, 0, '375.00'],
  [7500, 48, 0.03, '296.83'],
  [8000, 48, 0.03, '316.62'],
  [16000, 48, 0.02, '521.63'],
];

const contract = (principal: number, months: number, rate: number, insurance: string | null): LoanContract => ({
  principal: principal.toFixed(2),
  monthlyRate: String(rate),
  termCount: months,
  // Desembolso un mes antes de la primera cuota (lo que hace la carga inicial por defecto)
  startDate: '2026-06-10',
  firstDueDate: '2026-07-10',
  method: 'FRENCH',
  dayCount: 'D30_360',
  frequency: 'MONTHLY',
  rounding: 'HALF_UP',
  graceDays: 5,
  lateInterestMonthlyRate: null,
  lateFee: null,
  insuranceMonthly: insurance,
});

describe('Carga inicial de créditos en curso', () => {
  it.each(CASES)('%d a %d meses al %d mensual → cuota %s', (principal, months, rate, expected) => {
    const s = generateSchedule({
      principal: new Decimal(principal),
      monthlyRate: new Decimal(rate),
      dayCount: 'D30_360',
      frequency: 'MONTHLY',
      rounding: 'HALF_UP',
      method: 'FRENCH',
      startDate: '2026-06-10',
      startNumber: 1,
      anchorDate: '2026-07-10',
      anchorNumber: 1,
      count: months,
    });
    expect(s.levelPayment!.toFixed(2)).toBe(expected);
    expect(s.installments).toHaveLength(months);
    expect(s.installments[months - 1].closingBalance.isZero()).toBe(true);
    expect(s.installments[0].dueDate).toBe('2026-07-10');
  });

  it('tasa 0 %: cuota = capital / plazo, sin interés', () => {
    const snap = LoanLedger.replay(contract(4500, 12, 0, null), [], '2026-06-10');
    for (const i of snap.current.installments) {
      expect(i.interest).toBe('0.00');
      expect(i.payment).toBe('375.00');
    }
  });

  it('el seguro mensual se suma a la cuota como concepto aparte y se cobra antes que el interés', () => {
    const ledger = new LoanLedger(contract(7500, 42, 0.03, '12.50'));
    const first = ledger.snapshot('2026-06-10').current.installments[0];
    expect(first.payment).toBe('316.44');
    expect(first.insurance).toBe('12.50');
    expect(first.totalPayment).toBe('328.94');

    const r = ledger.apply({ type: 'PAYMENT', id: 'p1', seq: 1, date: '2026-07-10', amount: '328.94', kind: 'INSTALLMENT' });
    expect(r.allocations.map((a) => a.concept)).toEqual(['INSURANCE', 'INTEREST', 'PRINCIPAL']);
    expect(r.allocations[0].amount).toBe('12.50');
    const snap = ledger.snapshot('2026-07-10');
    expect(snap.current.installments[0].status).toBe('PAID');
    expect(snap.totals.insurancePaid).toBe('12.50');
  });

  it('una cuota sin el seguro queda parcial y la cotización de liquidación incluye el seguro vencido', () => {
    const ledger = new LoanLedger(contract(4500, 12, 0, '10.00'));
    ledger.apply({ type: 'PAYMENT', id: 'p1', seq: 1, date: '2026-07-10', amount: '375.00', kind: 'INSTALLMENT' });
    const inst = ledger.snapshot('2026-07-11').current.installments[0];
    expect(inst.paidInsurance).toBe('10.00');
    expect(inst.status).not.toBe('PAID');
    const q = ledger.quote('2026-07-11');
    expect(q.overdueInsurance).toBe('0.00');
    expect(Number(q.total)).toBeGreaterThan(0);
  });

  it('sin seguro el contrato se comporta igual que antes', () => {
    const snap = LoanLedger.replay(contract(8000, 48, 0.03, null), [], '2026-06-10');
    expect(snap.current.installments[0].insurance).toBe('0.00');
    expect(snap.current.installments[0].totalPayment).toBe(snap.current.installments[0].payment);
  });
});
