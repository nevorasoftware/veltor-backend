import { Prisma } from '@prisma/client';
import { FinanceService } from './finance.service';

/** Prisma en memoria con lo mínimo que usan restateLoan / registerPayment / getLoanLedgerSnapshot */
function fakePrisma(loan: any, payments: any[]) {
  const reversals: any[] = [];
  const audits: any[] = [];
  let installments: any[] = [{ old: true }];
  const db: any = {
    loan: {
      findFirst: async () => ({ ...loan, customer: {}, vehicle: {}, payments: payments.filter((p) => !p.isReversed).sort((a, b) => +a.effectiveDate - +b.effectiveDate || a.sequenceNumber - b.sequenceNumber) }),
      update: async ({ data }: any) => Object.assign(loan, data),
    },
    paymentTransaction: {
      findUnique: async ({ where }: any) => payments.find((p) => p.idempotencyKey === where.idempotencyKey) ?? null,
      findFirst: async () => (payments.length ? { code: payments.map((p) => p.code).sort().at(-1) } : null),
      aggregate: async () => ({ _max: { sequenceNumber: payments.reduce((m, p) => Math.max(m, p.sequenceNumber), 0) } }),
      updateMany: async ({ where, data }: any) => { for (const p of payments) if (where.id.in.includes(p.id)) Object.assign(p, data); },
      create: async ({ data }: any) => {
        const p = { ...data, amountReceived: dec(data.amountReceived), amountApplied: dec(data.amountApplied), id: `p${payments.length + 1}`, isReversed: false, allocations: [] };
        payments.push(p);
        return p;
      },
    },
    paymentReversal: { createMany: async ({ data }: any) => reversals.push(...data) },
    amortizationInstallment: { deleteMany: async () => (installments = []), createMany: async ({ data }: any) => (installments = data) },
    loanContractVersion: { deleteMany: async () => null, create: async () => null },
    auditLog: { create: async ({ data }: any) => { const a = { ...data, id: `a${audits.length + 1}` }; audits.push(a); return a; } },
  };
  db.$transaction = async (cb: any) => cb(db);
  return { db, reversals, audits, get installments() { return installments; } };
}

const dec = (v: string | number) => new Prisma.Decimal(v);
// Ref 5 de la carga real: 6,500 al 36 % en 48 cuotas de 257.26 + 48.39 de seguro, cargado con 1.ª cuota 2024-09-26
const baseLoan = () => ({
  id: 'L5', code: 'CRE-2026-0004', status: 'ACTIVE', vehiclePrice: dec(8000), downPayment: dec(1500), originalPrincipal: dec(6500),
  currentPrincipalBalance: dec(3000), monthlyRate: dec('0.03'), termCount: 48, frequency: 'MONTHLY', dayCount: 'D30_360', method: 'FRENCH',
  graceDays: 3, lateRateMonthly: null, lateFeeType: 'NONE', lateFeeAmount: null, insuranceMonthly: dec('48.39'),
  disbursementDate: new Date('2024-08-26'), firstDueDate: new Date('2024-09-26'), paymentDay: 26,
});
const oldPayments = () =>
  [0, 1, 2].map((k) => ({
    id: `old${k}`, code: `PAG-2026-00000${k}`, sequenceNumber: k + 1, isReversed: false, idempotencyKey: `carga-v5-c${k + 1}`,
    effectiveDate: new Date(`2024-${String(9 + k).padStart(2, '0')}-26`), amountReceived: dec('305.65'), amountApplied: dec('305.65'), kind: 'INSTALLMENT', policy: null,
  }));

describe('FinanceService.restateLoan (rehacer crédito)', () => {
  const events = { emit: jest.fn() } as any;

  it('dryRun no escribe y muestra el antes y el después', async () => {
    const f = fakePrisma(baseLoan(), oldPayments());
    const svc = new FinanceService(f.db, events);
    const r: any = await svc.restateLoan('L5', { reason: 'prueba', firstPaymentDate: '2023-09-26', payments: 'REVERSE_ALL', markPaidThrough: 38, dryRun: true }, 'u1');
    expect(r.dryRun).toBe(true);
    expect(r.after.installment).toBe(257.26);
    expect(r.after.disbursementDate).toBe('2023-08-26');
    expect(r.after.lastDueDate).toBe('2027-08-26');
    expect(r.paymentsToReverse).toHaveLength(3);
    expect(r.paymentsToRegister).toHaveLength(38);
    expect(r.paymentsToRegister[37]).toEqual({ number: 38, dueDate: '2026-10-26', amount: '305.65' });
    expect(f.reversals).toHaveLength(0);
    expect(f.audits).toHaveLength(0);
    expect(f.installments).toEqual([{ old: true }]);
  });

  it('rehace desde sep-2023: revierte lo anterior y deja 38 cuotas pagadas en su fecha', async () => {
    const loan = baseLoan();
    const f = fakePrisma(loan, oldPayments());
    const svc = new FinanceService(f.db, events);
    const r: any = await svc.restateLoan('L5', { reason: 'Admin: 1.ª cuota real 26-sep-2023', firstPaymentDate: '2023-09-26', payments: 'REVERSE_ALL', markPaidThrough: 38 }, 'u1');
    expect(f.reversals).toHaveLength(3);
    expect(f.installments).toHaveLength(48);
    expect(r.registeredPayments).toHaveLength(38);
    expect(r.result.paidInstallments).toBe(38);
    expect(r.result.next.number).toBe(39);
    expect(r.result.next.dueDate).toBe('2026-11-26');
    expect(f.audits[0].action).toBe('RESTATE_LOAN');
    expect(loan.paymentDay).toBe(26);
    expect(events.emit).toHaveBeenCalledWith('payment.registered', expect.objectContaining({ silent: true }));
  });

  it('con KEEP reaplica los pagos y rechaza pagos anteriores al nuevo desembolso', async () => {
    const f = fakePrisma(baseLoan(), oldPayments());
    const svc = new FinanceService(f.db, events);
    const r: any = await svc.restateLoan('L5', { reason: 'tasa', annualRate: 30, dryRun: true }, 'u1');
    expect(r.paymentsKept).toBe(3);
    expect(r.after.annualRate).toBe(30);
    await expect(svc.restateLoan('L5', { reason: 'x', firstPaymentDate: '2025-01-26' }, 'u1')).rejects.toThrow(/anteriores al nuevo desembolso/);
    await expect(svc.restateLoan('L5', { reason: 'x', markPaidThrough: 2 }, 'u1')).rejects.toThrow(/revierta primero/);
    await expect(svc.restateLoan('L5', { reason: 'x', payments: 'REVERSE_ALL', markPaidThrough: 48 }, 'u1')).rejects.toThrow(/ya vencidas/);
  });
});
