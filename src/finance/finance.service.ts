import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LoanContract,
  LoanEvent,
  LoanLedger,
  PrepaymentPolicy,
  toDateStr,
  todayInTz,
  isValidDate,
  cmp,
  D,
} from './engine';
import { Loan, LoanStatus, PaymentKind, PaymentMethod, PaymentTransaction, Prisma } from '@prisma/client';
import { nextSequentialCode, withUniqueRetry } from '../common/codes';

type LoanWithPayments = Loan & { payments: PaymentTransaction[] };

@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  private buildContract(loan: Loan): LoanContract {
    return {
      principal: loan.originalPrincipal.toFixed(2),
      monthlyRate: loan.monthlyRate.toString(),
      termCount: loan.termCount,
      startDate: toDateStr(loan.disbursementDate),
      firstDueDate: toDateStr(loan.firstDueDate),
      method: loan.method,
      dayCount: loan.dayCount,
      frequency: loan.frequency,
      rounding: 'HALF_UP',
      graceDays: loan.graceDays,
      lateInterestMonthlyRate: loan.lateRateMonthly ? loan.lateRateMonthly.toString() : null,
    };
  }

  private toEvents(payments: PaymentTransaction[]): LoanEvent[] {
    return payments.map((p) => ({
      type: 'PAYMENT',
      id: p.id,
      seq: p.sequenceNumber,
      date: toDateStr(p.effectiveDate),
      amount: p.amountReceived.toFixed(2),
      kind: p.kind,
      policy: p.policy ?? undefined,
    }));
  }

  private buildLedger(loan: Loan, payments: PaymentTransaction[]): LoanLedger {
    const ledger = new LoanLedger(this.buildContract(loan));
    for (const ev of this.toEvents(payments)) ledger.apply(ev);
    return ledger;
  }

  private async findLoan(loanIdOrCode: string, where: Prisma.LoanWhereInput = {}) {
    const loan = await this.prisma.loan.findFirst({
      where: { OR: [{ id: loanIdOrCode }, { code: loanIdOrCode }], ...where },
      include: {
        customer: true,
        vehicle: { include: { images: { where: { isPrimary: true }, take: 1 } } },
        payments: {
          where: { isReversed: false },
          orderBy: [{ effectiveDate: 'asc' }, { sequenceNumber: 'asc' }],
          include: { allocations: true },
        },
      },
    });
    if (!loan) throw new NotFoundException('Crédito no encontrado');
    return loan;
  }

  private validateDate(date: string | undefined, label: string) {
    if (date && !isValidDate(date)) {
      throw new BadRequestException(`${label} debe tener el formato AAAA-MM-DD.`);
    }
  }

  /** Obtiene el snapshot recalculado y reproducible de un crédito a una fecha. */
  async getLoanLedgerSnapshot(loanId: string, asOfDate?: string, where: Prisma.LoanWhereInput = {}) {
    this.validateDate(asOfDate, 'La fecha de corte');
    const loan = await this.findLoan(loanId, where);
    const contract = this.buildContract(loan);
    const snapshot = LoanLedger.replay(contract, this.toEvents(loan.payments), asOfDate || todayInTz());
    return { loan, contract, snapshot };
  }

  /** Cotización exacta de liquidación total (Payoff Quote) */
  async getPayoffQuote(loanId: string, targetDate?: string, where: Prisma.LoanWhereInput = {}) {
    this.validateDate(targetDate, 'La fecha objetivo');
    const loan = await this.findLoan(loanId, where);
    return this.buildLedger(loan, loan.payments).quote(targetDate || todayInTz());
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

    this.validateDate(dto.effectiveDate, 'La fecha efectiva');
    if (cmp(dto.effectiveDate, todayInTz()) > 0) {
      throw new BadRequestException('La fecha efectiva del pago no puede ser futura.');
    }
    if (!D(dto.amount).gt(0)) throw new BadRequestException('El monto del pago debe ser mayor a cero.');
    if (dto.kind === 'PRINCIPAL_PREPAYMENT' && !dto.policy) {
      throw new BadRequestException('Indique si el abono a capital reduce el plazo o la cuota.');
    }

    const loan: LoanWithPayments = await this.findLoan(dto.loanId);
    if (loan.status !== LoanStatus.ACTIVE) {
      throw new BadRequestException(`El crédito ${loan.code} no está activo (estado: ${loan.status}).`);
    }
    if (cmp(dto.effectiveDate, toDateStr(loan.disbursementDate)) < 0) {
      throw new BadRequestException('La fecha del pago no puede ser anterior al desembolso.');
    }
    const lastPayment = loan.payments[loan.payments.length - 1];
    if (lastPayment && cmp(dto.effectiveDate, toDateStr(lastPayment.effectiveDate)) < 0) {
      throw new BadRequestException(
        `La fecha del pago no puede ser anterior al último pago registrado (${toDateStr(lastPayment.effectiveDate)}).`,
      );
    }

    // 2. Ejecutar en motor financiero sobre los pagos vigentes
    const ledger = this.buildLedger(loan, loan.payments);
    const maxSeq = await this.prisma.paymentTransaction.aggregate({
      where: { loanId: loan.id },
      _max: { sequenceNumber: true },
    });
    const nextSeq = (maxSeq._max.sequenceNumber ?? 0) + 1;

    const result = ledger.apply({
      type: 'PAYMENT',
      id: `pending-${nextSeq}`,
      seq: nextSeq,
      date: dto.effectiveDate,
      amount: D(dto.amount).toFixed(2),
      kind: dto.kind,
      policy: dto.policy,
    });

    // 3. Persistir atómicamente
    const payment = await withUniqueRetry(() =>
      this.prisma.$transaction(async (tx) => {
        const code = await nextSequentialCode(
          (prefix) =>
            tx.paymentTransaction.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: 'desc' }, select: { code: true } }),
          'PAG',
        );
        const newPayment = await tx.paymentTransaction.create({
          data: {
            code,
            loanId: loan.id,
            sequenceNumber: nextSeq,
            effectiveDate: new Date(dto.effectiveDate),
            amountReceived: D(dto.amount).toFixed(2),
            amountApplied: D(result.applied).toFixed(2),
            kind: dto.kind,
            policy: dto.policy,
            paymentMethod: dto.paymentMethod,
            referenceNumber: dto.referenceNumber,
            notes: dto.notes,
            idempotencyKey: dto.idempotencyKey,
            registeredById: dto.registeredById,
            allocations: {
              create: result.allocations.map((a) => ({
                concept: a.concept,
                installmentNumber: a.installmentNumber,
                amount: D(a.amount).toFixed(2),
              })),
            },
          },
          include: { allocations: true },
        });

        await tx.loan.update({
          where: { id: loan.id },
          data: {
            currentPrincipalBalance: ledger.balance,
            status: D(ledger.balance).isZero() ? LoanStatus.PAID_OFF : LoanStatus.ACTIVE,
          },
        });

        // Abono extraordinario con reprogramación: registrar nueva versión de contrato
        if (result.rescheduled) {
          const snap = ledger.snapshot(dto.effectiveDate);
          const versionCount = await tx.loanContractVersion.count({ where: { loanId: loan.id } });
          const nextInstallment = snap.current.installments.find((i) => i.status !== 'PAID');
          await tx.loanContractVersion.create({
            data: {
              loanId: loan.id,
              versionIndex: versionCount,
              reason: 'PREPAYMENT',
              effectiveDate: new Date(dto.effectiveDate),
              principalBalance: ledger.balance,
              monthlyRate: snap.current.monthlyRate,
              levelPayment: nextInstallment ? nextInstallment.payment : null,
              policyApplied: dto.policy,
            },
          });
        }

        return newPayment;
      }),
    );

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

    const loan = payment.loan;

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentTransaction.update({
        where: { id: paymentId },
        data: { isReversed: true },
      });

      await tx.paymentReversal.create({
        data: {
          paymentId,
          reversalDate: new Date(todayInTz()),
          reason,
          authorizedById,
        },
      });

      const validPayments = await tx.paymentTransaction.findMany({
        where: { loanId: loan.id, isReversed: false },
        orderBy: [{ effectiveDate: 'asc' }, { sequenceNumber: 'asc' }],
      });

      const ledger = this.buildLedger(loan, validPayments);

      await tx.loan.update({
        where: { id: loan.id },
        data: {
          currentPrincipalBalance: ledger.balance,
          status: D(ledger.balance).isZero() ? LoanStatus.PAID_OFF : LoanStatus.ACTIVE,
        },
      });
    });

    return {
      success: true,
      message: 'Pago revertido exitosamente y saldos reconstruidos.',
    };
  }
}
