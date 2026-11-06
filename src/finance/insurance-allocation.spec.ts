import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { FinanceService } from './finance.service';

/** El seguro se pide al registrar el pago: es detalle informativo por cuota, nunca parte del crédito. */
describe('FinanceService: seguro aparte del crédito', () => {
  const svc = new FinanceService(null as any, null as any) as any;
  const dec = (v: string) => new Prisma.Decimal(v);
  const loan = (monthly: string | null, allocations: { concept: string; installmentNumber: number | null; amount: string }[] = []) => ({
    insuranceMonthly: monthly ? dec(monthly) : null,
    payments: [{ allocations: allocations.map((a) => ({ ...a, amount: dec(a.amount) })) }],
  });

  it('el contrato del motor nunca lleva seguro (no entra en la cuota ni en el capital)', () => {
    const contract = svc.buildContract({
      originalPrincipal: dec('6500'), monthlyRate: dec('0.03'), termCount: 48, disbursementDate: new Date('2024-08-26'),
      firstDueDate: new Date('2024-09-26'), method: 'FRENCH', dayCount: 'D30_360', frequency: 'MONTHLY', graceDays: 3,
      lateRateMonthly: null, lateFeeType: 'NONE', lateFeeAmount: null, insuranceMonthly: dec('48.39'),
    });
    expect(contract.insuranceMonthly).toBeNull();
  });

  it('liga el seguro a la cuota que cubrió el pago', () => {
    const r = svc.allocateInsurance(loan('48.39'), [{ installmentNumber: 3 }, { installmentNumber: 3 }], new Decimal('48.39'), [1, 2, 3, 4]);
    expect(r).toEqual([{ concept: 'INSURANCE', installmentNumber: 3, amount: '48.39' }]);
  });

  it('reparte entre varias cuotas hasta el seguro mensual y el resto a la última', () => {
    const r = svc.allocateInsurance(loan('48.39'), [{ installmentNumber: 1 }, { installmentNumber: 2 }], new Decimal('100.00'), [1, 2, 3]);
    expect(r).toEqual([
      { concept: 'INSURANCE', installmentNumber: 1, amount: '48.39' },
      { concept: 'INSURANCE', installmentNumber: 2, amount: '51.61' },
    ]);
  });

  it('pago solo de seguro: va a la primera cuota con seguro pendiente', () => {
    const r = svc.allocateInsurance(
      loan('48.39', [{ concept: 'INSURANCE', installmentNumber: 1, amount: '48.39' }]),
      [],
      new Decimal('48.39'),
      [1, 2, 3],
    );
    expect(r).toEqual([{ concept: 'INSURANCE', installmentNumber: 2, amount: '48.39' }]);
  });

  it('sin seguro pagado no genera detalle', () => {
    expect(svc.allocateInsurance(loan('48.39'), [{ installmentNumber: 1 }], new Decimal(0), [1])).toEqual([]);
  });
});
