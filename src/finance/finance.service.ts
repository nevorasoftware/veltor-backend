import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LoanContract,
  LoanEvent,
  LoanLedger,
  PaymentEvent,
  PrepaymentPolicy,
  toDateStr,
  todayInTz,
  D,
  fmt,
} from './engine';
import { PaymentKind, PaymentMethod } from '@prisma/client';

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Obtiene el snapshot recalculado y reproducible de un crédito a una fecha. */
  async getLoanLedgerSnapshot(loanId: string, asOfDate?: string) {
    const loan = await this.prisma.loan.findFirst({
      where: {
        OR: [{ id: loanId }, { code: loanId }],
      },
      include: {
        customer: true,
        vehicle: true,
        payments: {
          where: { isReversed: false },
          orderBy: [{ effectiveDate: 'asc' }, { sequenceNumber: 'asc' }],
        },
      },
    });

    if (!loan) throw new NotFoundException('Crédito no encontrado');

    const contract: LoanContract = {
      principal: loan.originalPrincipal.toFixed(2),
      monthlyRate: loan.monthlyRate.toString(),
      termCount: loan.termCount,
      startDate: toDateStr(loan.disbursementDate),
      firstDueDate: toDateStr(loan.firstDueDate),
      method: loan.method as any,
      dayCount: loan.dayCount as any,
      frequency: loan.frequency as any,
      rounding: 'HALF_UP',
      graceDays: loan.graceDays,
      lateInterestMonthlyRate: loan.lateRateMonthly ? loan.lateRateMonthly.toString() : null,
    };

    const events: LoanEvent[] = loan.payments.map((p) => ({
      type: 'PAYMENT',
      id: p.id,
      seq: p.sequenceNumber,
      date: toDateStr(p.effectiveDate),
      amount: p.amountReceived.toFixed(2),
      kind: p.kind as any,
      policy: (p.policy as any) || undefined,
    }));

    const dateToUse = asOfDate || todayInTz();
    const snapshot = LoanLedger.replay(contract, events, dateToUse);

    return {
      loan,
      contract,
      snapshot,
    };
  }

  /** Cotización exacta de liquidación total (Payoff Quote) */
  async getPayoffQuote(loanId: string, targetDate?: string) {
    const date = targetDate || todayInTz();
    const { contract, snapshot } = await this.getLoanLedgerSnapshot(loanId, date);
    const ledger = new LoanLedger(contract);
    for (const ev of snapshot.results) {
      // Re-apply to get instance quote
    }
    // Usamos el snapshot para cotizar
    const liveLedger = new LoanLedger(contract);
    // Aplicamos los eventos existentes no revertidos
    const loan = await this.prisma.loan.findFirst({
      where: {
        OR: [{ id: loanId }, { code: loanId }],
      },
      include: {
        payments: {
          where: { isReversed: false },
          orderBy: [{ effectiveDate: 'asc' }, { sequenceNumber: 'asc' }],
        },
      },
    });
    for (const p of loan?.payments || []) {
      liveLedger.apply({
        type: 'PAYMENT',
        id: p.id,
        seq: p.sequenceNumber,
        date: toDateStr(p.effectiveDate),
        amount: p.amountReceived.toFixed(2),
        kind: p.kind as any,
        policy: (p.policy as any) || undefined,
      });
    }

    return liveLedger.quote(date);
  }

  /** Registra un pago (ordinario, abono extraordinario a capital o cancelación total) con transacción */
  async registerPayment(dto: {
    loanId: string;
    amount: string;
    effectiveDate: string;
    kind: PaymentKind;
    policy?: PrepaymentPolicy;
    paymentMethod: PaymentMethod;
    referenceNumber?: string;
    notes?: string;
    idempotencyKey: string;
    registeredById: string;
  }) {
    // 1. Verificación de Idempotencia
    const existing = await this.prisma.paymentTransaction.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
      include: { allocations: true },
    });
    if (existing) {
      return {
        isDuplicate: true,
        payment: existing,
        message: 'Transacción ya procesada previamente (Idempotencia verificada).',
      };
    }

    // 2. Obtener estado actual del crédito
    const { loan, contract } = await this.getLoanLedgerSnapshot(dto.loanId, dto.effectiveDate);

    // 3. Ejecutar en motor financiero
    const previousPayments = await this.prisma.paymentTransaction.findMany({
      where: { loanId: loan.id, isReversed: false },
      orderBy: [{ effectiveDate: 'asc' }, { sequenceNumber: 'asc' }],
    });

    const nextSeq = previousPayments.length + 1;
    const ledger = new LoanLedger(contract);
    for (const p of previousPayments) {
      ledger.apply({
        type: 'PAYMENT',
        id: p.id,
        seq: p.sequenceNumber,
        date: toDateStr(p.effectiveDate),
        amount: p.amountReceived.toFixed(2),
        kind: p.kind as any,
        policy: (p.policy as any) || undefined,
      });
    }

    const tempEventId = `temp-pay-${Date.now()}`;
    const result = ledger.apply({
      type: 'PAYMENT',
      id: tempEventId,
      seq: nextSeq,
      date: dto.effectiveDate,
      amount: dto.amount,
      kind: dto.kind as any,
      policy: dto.policy,
    });

    // 4. Persistir atómicamente en PostgreSQL
    const payment = await this.prisma.$transaction(async (tx) => {
      const pCode = `PAG-${Date.now().toString().slice(-6)}`;
      const newPayment = await tx.paymentTransaction.create({
        data: {
          code: pCode,
          loanId: loan.id,
          sequenceNumber: nextSeq,
          effectiveDate: new Date(dto.effectiveDate),
          amountReceived: D(dto.amount).toNumber(),
          amountApplied: D(result.applied).toNumber(),
          kind: dto.kind,
          policy: dto.policy,
          paymentMethod: dto.paymentMethod,
          referenceNumber: dto.referenceNumber,
          notes: dto.notes,
          idempotencyKey: dto.idempotencyKey,
          registeredById: dto.registeredById,
          allocations: {
            create: result.allocations.map((a) => ({
              concept: a.concept as any,
              installmentNumber: a.installmentNumber,
              amount: D(a.amount).toNumber(),
            })),
          },
        },
        include: { allocations: true },
      });

      // Actualizar saldo de capital en Loan
      await tx.loan.update({
        where: { id: loan.id },
        data: {
          currentPrincipalBalance: D(ledger.balance).toNumber(),
          status: ledger.balance === '0.00' ? 'PAID_OFF' : 'ACTIVE',
        },
      });

      // Si hubo reprogramación (Abono extraordinario), crear nueva versión de contrato
      if (result.rescheduled) {
        const snap = ledger.snapshot(dto.effectiveDate);
        await tx.loanContractVersion.create({
          data: {
            loanId: loan.id,
            versionIndex: snap.versions.length - 1,
            reason: 'PREPAYMENT',
            effectiveDate: new Date(dto.effectiveDate),
            principalBalance: D(ledger.balance).toNumber(),
            monthlyRate: D(snap.current.monthlyRate).toNumber(),
            levelPayment: snap.current.installments[0] ? D(snap.current.installments[0].payment).toNumber() : null,
            policyApplied: dto.policy,
          },
        });
      }

      return newPayment;
    });

    return {
      isDuplicate: false,
      payment,
      result,
      newPrincipalBalance: ledger.balance,
    };
  }

  /** Reversión autorizada de pago con reconstrucción íntegra de saldos e historial inmutable */
  async reversePayment(paymentId: string, authorizedById: string, reason: string) {
    const payment = await this.prisma.paymentTransaction.findUnique({
      where: { id: paymentId },
      include: { loan: true },
    });
    if (!payment) throw new NotFoundException('Pago no encontrado');
    if (payment.isReversed) throw new BadRequestException('El pago ya fue revertido con anterioridad');

    const loanId = payment.loanId;

    await this.prisma.$transaction(async (tx) => {
      // 1. Marcar como revertido y crear registro auditable de reversión
      await tx.paymentTransaction.update({
        where: { id: paymentId },
        data: { isReversed: true },
      });

      await tx.paymentReversal.create({
        data: {
          paymentId,
          reversalDate: new Date(),
          reason,
          authorizedById,
        },
      });

      // 2. Reconstruir saldo a partir de los pagos válidos restantes
      const validPayments = await tx.paymentTransaction.findMany({
        where: { loanId, isReversed: false },
        orderBy: [{ effectiveDate: 'asc' }, { sequenceNumber: 'asc' }],
      });

      const loan = payment.loan;
      const contract: LoanContract = {
        principal: loan.originalPrincipal.toFixed(2),
        monthlyRate: loan.monthlyRate.toString(),
        termCount: loan.termCount,
        startDate: toDateStr(loan.disbursementDate),
        firstDueDate: toDateStr(loan.firstDueDate),
        method: loan.method as any,
        dayCount: loan.dayCount as any,
        frequency: loan.frequency as any,
        rounding: 'HALF_UP',
        graceDays: loan.graceDays,
        lateInterestMonthlyRate: loan.lateRateMonthly ? loan.lateRateMonthly.toString() : null,
      };

      const ledger = new LoanLedger(contract);
      for (const p of validPayments) {
        ledger.apply({
          type: 'PAYMENT',
          id: p.id,
          seq: p.sequenceNumber,
          date: toDateStr(p.effectiveDate),
          amount: p.amountReceived.toFixed(2),
          kind: p.kind as any,
          policy: (p.policy as any) || undefined,
        });
      }

      await tx.loan.update({
        where: { id: loanId },
        data: {
          currentPrincipalBalance: D(ledger.balance).toNumber(),
          status: ledger.balance === '0.00' ? 'PAID_OFF' : 'ACTIVE',
        },
      });
    });

    return {
      success: true,
      message: 'Pago revertido exitosamente y saldos reconstruidos.',
    };
  }
}
