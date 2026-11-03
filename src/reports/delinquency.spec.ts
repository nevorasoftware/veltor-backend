import { LoanContract, LoanLedger } from '../finance/engine';
import { DelinquentLoan, delinquencyTotals, summarizeOverdue } from './delinquency';

const contract = (over: Partial<LoanContract> = {}): LoanContract => ({
  principal: '4500.00',
  monthlyRate: '0',
  termCount: 12,
  startDate: '2026-07-22',
  firstDueDate: '2026-08-22',
  method: 'FRENCH',
  dayCount: 'D30_360',
  frequency: 'MONTHLY',
  rounding: 'HALF_UP',
  graceDays: 5,
  lateInterestMonthlyRate: null,
  lateFee: { type: 'PER_DAY', amount: '5.00' },
  insuranceMonthly: '10.00',
  ...over,
});

const row = (s: ReturnType<typeof summarizeOverdue>, code: string): DelinquentLoan => ({
  loanId: code,
  code,
  customerId: 'c',
  customerName: 'Cliente',
  vehicleTitle: 'Por definir',
  ...s!,
});

describe('Resumen de mora (GET /reports/delinquency)', () => {
  it('crédito sin pagos con cuotas vencidas: suma capital+interés, seguro y mora a la fecha', () => {
    const snap = LoanLedger.replay(contract(), [], '2026-11-03');
    const s = summarizeOverdue(snap.current.installments, 5)!;
    // vencidas: 22/08, 22/09 y 22/10
    expect(s.overdueInstallments).toBe(3);
    expect(s.oldestDueDate).toBe('2026-08-22');
    expect(s.daysOverdue).toBe(73);
    expect(s.inGrace).toBe(false);
    expect(s.overduePrincipalInterest).toBe('1125.00');
    expect(s.overdueInsurance).toBe('30.00');
    expect(Number(s.lateFees)).toBeGreaterThan(0);
    expect(s.totalDue).toBe((1125 + 30 + Number(s.lateFees)).toFixed(2));
  });

  it('cuota vencida dentro de la gracia: inGrace y sin mora', () => {
    const snap = LoanLedger.replay(contract({ startDate: '2026-10-01', firstDueDate: '2026-11-01' }), [], '2026-11-03');
    const s = summarizeOverdue(snap.current.installments, 5)!;
    expect(s.overdueInstallments).toBe(1);
    expect(s.daysOverdue).toBe(2);
    expect(s.inGrace).toBe(true);
    expect(s.lateFees).toBe('0.00');
  });

  it('crédito al día: no aparece', () => {
    const snap = LoanLedger.replay(contract({ startDate: '2026-10-20', firstDueDate: '2026-11-20' }), [], '2026-11-03');
    expect(summarizeOverdue(snap.current.installments, 5)).toBeNull();
  });

  it('totales: en mora vs en gracia', () => {
    const a = row(summarizeOverdue(LoanLedger.replay(contract(), [], '2026-11-03').current.installments, 5), 'A');
    const b = row(
      summarizeOverdue(LoanLedger.replay(contract({ startDate: '2026-10-01', firstDueDate: '2026-11-01' }), [], '2026-11-03').current.installments, 5),
      'B',
    );
    const t = delinquencyTotals([a, b]);
    expect(t.loansWithOverdue).toBe(2);
    expect(t.loansDelinquent).toBe(1);
    expect(t.loansInGrace).toBe(1);
    expect(t.overdueInstallments).toBe(4);
    expect(t.totalDue).toBe((Number(a.totalDue) + Number(b.totalDue)).toFixed(2));
  });
});
