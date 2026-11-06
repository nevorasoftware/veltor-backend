import { PdfService } from './pdf.service';
import { TenantContext } from '../tenant/tenant-context';

const D = (v: string) => ({ toString: () => v, toFixed: (n: number) => Number(v).toFixed(n) }) as any;

describe('PdfService.generatePaymentReceiptPdf', () => {
  const receipt = {
    loan: {
      code: 'CRE-2026-0032',
      customer: { fullName: 'Jonathan Misael Jirón Grande', dui: '01234567-8' },
      vehicle: { brand: 'Jeep', model: 'Renegade', year: 2018 },
    },
    payment: {
      code: 'PAG-2026-0150',
      effectiveDate: new Date('2026-11-02T00:00:00Z'),
      registeredAt: new Date('2026-11-04T10:00:00Z'),
      amountReceived: D('306.12'),
      amountApplied: D('306.12'),
      // Seguro pagado aparte: no forma parte del crédito, solo se informa en el comprobante
      insuranceAmount: D('36.00'),
      kind: 'INSTALLMENT',
      paymentMethod: 'BANK_TRANSFER',
      referenceNumber: 'TRX-778899',
      allocations: [
        { concept: 'INTEREST', installmentNumber: 1, amount: D('180.00') },
        { concept: 'PRINCIPAL', installmentNumber: 1, amount: D('126.12') },
        { concept: 'INSURANCE', installmentNumber: 1, amount: D('36.00') },
      ],
    },
    principalBalanceAfter: '5873.88',
    paidOff: false,
    next: { number: 2, dueDate: '2026-12-02', payment: '306.12', totalPayment: '306.12' },
  };
  const svc = new PdfService(
    { getPaymentReceipt: jest.fn().mockResolvedValue(receipt) } as any,
    { unscoped: { company: { findUnique: jest.fn().mockResolvedValue(null) } } } as any,
  );

  it('genera un PDF válido con el comprobante', async () => {
    const buf = await TenantContext.run('c1', () => svc.generatePaymentReceiptPdf('l1', 'p1'), {
      id: 'c1', slug: 'veltor', name: 'VELTOR', legalName: null, tagline: 'Financiamiento inteligente', primaryColor: '#0f172a',
      secondaryColor: '#1e293b', accentColor: '#38bdf8', locale: 'es-SV', currency: 'USD', timezone: 'America/El_Salvador', domains: [],
      contactEmail: 'pagos@veltor.app', contactPhone: '7822-3304', contactHours: null, paymentsEmail: null, paymentsWhatsapp: '78223304',
      bankAccounts: [], bankAccountHolder: null, logoMime: null,
    });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    if (process.env.RECEIPT_OUT) require('fs').writeFileSync(process.env.RECEIPT_OUT, buf);
  });
});
