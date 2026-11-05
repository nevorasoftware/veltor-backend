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
  addMonths,
  generateSchedule,
} from './engine';
import Decimal from 'decimal.js';
import { InstallmentStatus, Loan, LoanStatus, PaymentKind, PaymentMethod, PaymentTransaction, Prisma } from '@prisma/client';
import { nextSequentialCode, withUniqueRetry } from '../common/codes';
import { DomainEvents } from '../common/domain-events';

type LoanWithPayments = Loan & { payments: PaymentTransaction[] };

/** Nuevas condiciones de un crédito ("rehacer crédito"). Lo que no se indica se conserva. */
export interface RestateLoanInput {
  reason: string;
  vehiclePrice?: number;
  /** Monto financiado; la prima pasa a ser precio − financiado */
  principal?: number;
  annualRate?: number;
  termMonths?: number;
  firstPaymentDate?: string;
  /** Por defecto: un mes antes de la primera cuota */
  disbursementDate?: string;
  /** null o 0 = sin seguro */
  insuranceMonthly?: number | null;
  /** KEEP = los pagos vigentes se reaplican con las nuevas condiciones; REVERSE_ALL = se revierten todos */
  payments?: 'KEEP' | 'REVERSE_ALL';
  /** Tras rehacer: registra pagadas las cuotas 1..N en su fecha de vencimiento (pagos históricos, sin avisos) */
  markPaidThrough?: number;
  dryRun?: boolean;
}

@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
  ) {}

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
      lateFee:
        loan.lateFeeType !== 'NONE' && loan.lateFeeAmount
          ? { type: loan.lateFeeType, amount: loan.lateFeeAmount.toFixed(2) }
          : null,
      insuranceMonthly: loan.insuranceMonthly ? loan.insuranceMonthly.toFixed(2) : null,
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

  /**
   * Snapshots de todos los créditos ACTIVOS de la empresa a una fecha, con una sola consulta
   * (reportes de cartera y mora). Usa el mismo motor que el estado de cuenta.
   */
  async activeLoanSnapshots(asOf: string) {
    const loans = await this.prisma.loan.findMany({
      where: { status: LoanStatus.ACTIVE },
      include: {
        customer: { select: { id: true, fullName: true } },
        vehicle: { select: { id: true, brand: true, model: true, year: true } },
        payments: { where: { isReversed: false }, orderBy: [{ effectiveDate: 'asc' }, { sequenceNumber: 'asc' }] },
      },
      orderBy: { code: 'asc' },
    });
    return loans.map((loan) => ({
      loan,
      snapshot: LoanLedger.replay(this.buildContract(loan), this.toEvents(loan.payments), asOf),
    }));
  }

  /** Obtiene el snapshot recalculado y reproducible de un crédito a una fecha. */
  async getLoanLedgerSnapshot(loanId: string, asOfDate?: string, where: Prisma.LoanWhereInput = {}) {
    this.validateDate(asOfDate, 'La fecha de corte');
    const loan = await this.findLoan(loanId, where);
    const contract = this.buildContract(loan);
    const snapshot = LoanLedger.replay(contract, this.toEvents(loan.payments), asOfDate || todayInTz());
    return { loan, contract, snapshot };
  }

  /**
   * Datos del comprobante de un pago: el pago con su distribución, el saldo de capital que quedó justo
   * después de ese pago y la siguiente cuota pendiente a esa fecha (replay del ledger hasta ese pago).
   * `where` restringe el crédito (p. ej. al cliente del portal).
   */
  async getPaymentReceipt(loanId: string, paymentId: string, where: Prisma.LoanWhereInput = {}) {
    const loan = await this.findLoan(loanId, where);
    const idx = loan.payments.findIndex((p) => p.id === paymentId || (p as any).code === paymentId);
    if (idx < 0) throw new NotFoundException('Pago no encontrado en este crédito (o fue anulado)');
    const payment = loan.payments[idx];
    const upTo = loan.payments.slice(0, idx + 1); // ya vienen ordenados por fecha y secuencia
    const after = LoanLedger.replay(this.buildContract(loan), this.toEvents(upTo), toDateStr(payment.effectiveDate));
    const next = after.current.installments.find((i) => i.status !== 'PAID') ?? null;
    return { loan, payment, principalBalanceAfter: after.principalBalance, paidOff: after.status === 'PAID_OFF', next };
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
    /** Pago histórico de carga inicial: sin correos */
    initialLoad?: boolean;
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

    this.events.emit('payment.registered', { paymentId: payment.id, silent: !!dto.initialLoad });

    return {
      isDuplicate: false,
      payment,
      result,
      newPrincipalBalance: ledger.balance,
    };
  }

  /** Pausa o reanuda los avisos de cobranza y correos al cliente de un crédito (carga inicial) */
  async setNotificationsPaused(loanId: string, paused: boolean) {
    const loan = await this.findLoan(loanId);
    await this.prisma.loan.update({ where: { id: loan.id }, data: { notificationsPaused: paused } });
    return {
      success: true,
      loanId: loan.id,
      code: loan.code,
      notificationsPaused: paused,
      message: paused ? 'Avisos y correos del crédito pausados.' : 'Avisos y correos del crédito reanudados.',
    };
  }

  /**
   * Rehacer crédito / actualizar condiciones: cambia monto, tasa, plazo, fechas o seguro de un crédito activo,
   * regenera su tabla de amortización y reconstruye saldos. Pensado para corregir créditos mal cargados.
   * Los pagos se conservan (y se reaplican con las nuevas condiciones) o se revierten todos con historial;
   * opcionalmente se registran pagadas las cuotas 1..N en su fecha (sin mora ni avisos).
   * Queda en la bitácora (AuditLog RESTATE_LOAN) con el antes y el después.
   */
  async restateLoan(loanId: string, input: RestateLoanInput, userId: string) {
    const loan = await this.findLoan(loanId);
    if (loan.status !== LoanStatus.ACTIVE) {
      throw new BadRequestException(`Solo se pueden rehacer créditos activos (${loan.code} está ${loan.status}).`);
    }
    const reason = input.reason?.trim();
    if (!reason) throw new BadRequestException('Indique el motivo del cambio.');
    this.validateDate(input.firstPaymentDate, 'La primera cuota');
    this.validateDate(input.disbursementDate, 'La fecha de desembolso');

    const vehiclePrice = new Decimal(input.vehiclePrice ?? loan.vehiclePrice.toString()).toDecimalPlaces(2);
    const principal = new Decimal(
      input.principal ??
        (input.vehiclePrice !== undefined ? vehiclePrice.minus(loan.downPayment.toString()) : loan.originalPrincipal.toString()),
    ).toDecimalPlaces(2);
    if (principal.lte(0)) throw new BadRequestException('El monto financiado debe ser mayor a cero.');
    const downPayment = vehiclePrice.minus(principal);
    if (downPayment.lt(0)) throw new BadRequestException('El monto financiado no puede ser mayor al precio del vehículo.');
    const monthlyRate = (
      input.annualRate !== undefined ? new Decimal(input.annualRate).div(1200) : new Decimal(loan.monthlyRate.toString())
    ).toDecimalPlaces(10);
    const termCount = input.termMonths ?? loan.termCount;
    if (!Number.isInteger(termCount) || termCount < 1 || termCount > 600) {
      throw new BadRequestException('El plazo debe ser un número entero de meses.');
    }
    const firstDueDate = input.firstPaymentDate ?? toDateStr(loan.firstDueDate);
    const disbursementDate =
      input.disbursementDate ?? (input.firstPaymentDate ? addMonths(input.firstPaymentDate, -1) : toDateStr(loan.disbursementDate));
    if (cmp(firstDueDate, disbursementDate) <= 0) {
      throw new BadRequestException('La primera cuota debe ser posterior a la fecha de desembolso.');
    }
    const insurance =
      input.insuranceMonthly === undefined
        ? loan.insuranceMonthly
          ? new Decimal(loan.insuranceMonthly.toString())
          : null
        : input.insuranceMonthly && input.insuranceMonthly > 0
          ? new Decimal(input.insuranceMonthly).toDecimalPlaces(2)
          : null;
    const reverseAll = input.payments === 'REVERSE_ALL';
    const kept = reverseAll ? [] : loan.payments;
    if (kept.length && cmp(toDateStr(kept[0].effectiveDate), disbursementDate) < 0) {
      throw new BadRequestException('Hay pagos anteriores al nuevo desembolso: para rehacer el crédito revierta todos los pagos.');
    }

    const updated = {
      ...loan,
      vehiclePrice: new Prisma.Decimal(vehiclePrice.toFixed(2)),
      downPayment: new Prisma.Decimal(downPayment.toFixed(2)),
      originalPrincipal: new Prisma.Decimal(principal.toFixed(2)),
      monthlyRate: new Prisma.Decimal(monthlyRate.toString()),
      termCount,
      disbursementDate: new Date(disbursementDate),
      firstDueDate: new Date(firstDueDate),
      paymentDay: Number(firstDueDate.slice(8, 10)),
      insuranceMonthly: insurance ? new Prisma.Decimal(insurance.toFixed(2)) : null,
    } as LoanWithPayments;
    const schedule = generateSchedule({
      principal,
      monthlyRate,
      dayCount: loan.dayCount,
      frequency: 'MONTHLY',
      rounding: 'HALF_UP',
      method: loan.method,
      startDate: disbursementDate,
      startNumber: 1,
      anchorDate: firstDueDate,
      anchorNumber: 1,
      count: termCount,
    });
    const today = todayInTz();
    const ledger = this.buildLedger(updated, kept);
    const paidAfterKeep = ledger.snapshot(today).current.installments.filter((i) => i.status === 'PAID').length;

    const markPaidThrough = input.markPaidThrough ?? 0;
    if (!Number.isInteger(markPaidThrough) || markPaidThrough < 0 || markPaidThrough > termCount) {
      throw new BadRequestException('Cuotas a marcar pagadas: número inválido.');
    }
    if (markPaidThrough && kept.length) {
      throw new BadRequestException('Para registrar cuotas pagadas en su fecha, revierta primero todos los pagos.');
    }
    const toPay = schedule.installments.slice(0, markPaidThrough).map((i) => ({
      number: i.number,
      dueDate: i.dueDate,
      amount: D(i.payment.toFixed(2)).plus(insurance ? insurance.toFixed(2) : '0').toFixed(2),
    }));
    const futureDue = toPay.find((p) => cmp(p.dueDate, today) > 0);
    if (futureDue) {
      throw new BadRequestException(`La cuota ${futureDue.number} vence el ${futureDue.dueDate}: solo se pueden marcar pagadas cuotas ya vencidas.`);
    }

    const terms = (l: Loan) => ({
      vehiclePrice: Number(l.vehiclePrice),
      downPayment: Number(l.downPayment),
      principal: Number(l.originalPrincipal),
      annualRate: new Decimal(l.monthlyRate.toString()).times(1200).toDecimalPlaces(4).toNumber(),
      termMonths: l.termCount,
      disbursementDate: toDateStr(l.disbursementDate),
      firstPaymentDate: toDateStr(l.firstDueDate),
      insuranceMonthly: l.insuranceMonthly ? Number(l.insuranceMonthly) : null,
    });
    const before = {
      ...terms(loan),
      installment: Number(this.buildLedger(loan, []).snapshot(today).current.installments[0]?.payment ?? 0),
      activePayments: loan.payments.length,
      principalBalance: Number(loan.currentPrincipalBalance),
    };
    const after = {
      ...terms(updated),
      installment: Number(schedule.installments[0]?.payment.toFixed(2) ?? 0),
      lastDueDate: schedule.installments.at(-1)?.dueDate ?? null,
    };
    const preview = {
      loan: { id: loan.id, code: loan.code },
      reason,
      before,
      after,
      paymentsToReverse: reverseAll
        ? loan.payments.map((p) => ({ id: p.id, code: p.code, date: toDateStr(p.effectiveDate), amount: Number(p.amountReceived) }))
        : [],
      paymentsKept: kept.length,
      paidInstallmentsWithKeptPayments: paidAfterKeep,
      paymentsToRegister: toPay,
    };
    if (input.dryRun) return { dryRun: true, ...preview };

    const audit = await this.prisma.$transaction(async (tx) => {
      if (reverseAll && loan.payments.length) {
        const ids = loan.payments.map((p) => p.id);
        await tx.paymentTransaction.updateMany({ where: { id: { in: ids } }, data: { isReversed: true } });
        await tx.paymentReversal.createMany({
          data: ids.map((paymentId) => ({
            paymentId,
            reversalDate: new Date(today),
            reason: `Rehacer crédito ${loan.code}: ${reason}`,
            authorizedById: userId,
          })),
        });
      }
      await tx.loan.update({
        where: { id: loan.id },
        data: {
          vehiclePrice: updated.vehiclePrice,
          downPayment: updated.downPayment,
          originalPrincipal: updated.originalPrincipal,
          monthlyRate: updated.monthlyRate,
          termCount,
          disbursementDate: updated.disbursementDate,
          firstDueDate: updated.firstDueDate,
          paymentDay: updated.paymentDay,
          insuranceMonthly: updated.insuranceMonthly,
          currentPrincipalBalance: ledger.balance,
          status: D(ledger.balance).isZero() ? LoanStatus.PAID_OFF : LoanStatus.ACTIVE,
        },
      });
      await tx.amortizationInstallment.deleteMany({ where: { loanId: loan.id } });
      await tx.loanContractVersion.deleteMany({ where: { loanId: loan.id } });
      await tx.loanContractVersion.create({
        data: {
          loanId: loan.id,
          versionIndex: 0,
          reason: 'ORIGINAL',
          effectiveDate: updated.disbursementDate,
          principalBalance: principal.toFixed(2),
          monthlyRate: monthlyRate.toString(),
          levelPayment: schedule.installments[0]?.payment.toFixed(2) ?? null,
        },
      });
      await tx.amortizationInstallment.createMany({
        data: schedule.installments.map((inst) => ({
          loanId: loan.id,
          versionIndex: 0,
          number: inst.number,
          dueDate: new Date(inst.dueDate),
          periodStart: new Date(inst.periodStart),
          openingBalance: inst.openingBalance.toFixed(2),
          scheduledPrincipal: inst.principal.toFixed(2),
          scheduledInterest: inst.interest.toFixed(2),
          scheduledPayment: inst.payment.toFixed(2),
          closingBalance: inst.closingBalance.toFixed(2),
          scheduledInsurance: insurance ? insurance.toFixed(2) : '0',
          status: InstallmentStatus.PENDING,
        })),
      });
      return tx.auditLog.create({
        data: {
          userId,
          action: 'RESTATE_LOAN',
          entityName: 'Loan',
          entityId: loan.id,
          payloadBefore: before as Prisma.InputJsonValue,
          payloadAfter: { ...after, reason, reversedPayments: preview.paymentsToReverse.length, markPaidThrough } as Prisma.InputJsonValue,
        },
      });
    });

    // Cuotas históricas en su fecha: mismo camino que un pago normal, sin correos ni WhatsApp
    const registered: string[] = [];
    for (const p of toPay) {
      const r = await this.registerPayment({
        loanId: loan.id,
        amount: p.amount,
        effectiveDate: p.dueDate,
        kind: 'INSTALLMENT',
        paymentMethod: 'OTHER',
        referenceNumber: 'Rehacer crédito',
        notes: `Cuota ${p.number} registrada en su fecha al rehacer el crédito: ${reason}`,
        idempotencyKey: `restate-${audit.id}-c${p.number}`,
        registeredById: userId,
        initialLoad: true,
      });
      registered.push(r.payment.code);
    }

    const final = await this.getLoanLedgerSnapshot(loan.id);
    const inst = final.snapshot.current.installments;
    return {
      success: true,
      ...preview,
      registeredPayments: registered,
      result: {
        principalBalance: final.snapshot.principalBalance,
        paidInstallments: inst.filter((i) => i.status === 'PAID').length,
        next: inst.find((i) => i.status !== 'PAID') ?? null,
      },
      message: `Crédito ${loan.code} actualizado con las nuevas condiciones.`,
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
