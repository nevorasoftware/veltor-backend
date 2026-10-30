import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LoanStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEvents } from '../common/domain-events';
import { MailService, MailResult } from '../mail/mail.service';
import { FinanceService } from '../finance/finance.service';
import { PdfService } from '../pdf/pdf.service';
import { SettingsService } from '../settings/settings.service';
import { InstallmentView, addDays, todayInTz, D, fmt } from '../finance/engine';
import {
  accountStatementMail,
  leadReceivedMail,
  leadStaffAlertMail,
  loanApprovedMail,
  loanApprovedStaffMail,
  paymentRegisteredMail,
  paymentOverdueMail,
  paymentReminderMail,
  testMail,
  usd,
} from '../mail/templates';

const TIMEZONE = process.env.APP_TIMEZONE || 'America/El_Salvador';

const vehicleLabel = (v?: { brand: string; model: string; year: number } | null) =>
  v ? `${v.brand} ${v.model} ${v.year}` : null;

/** Saldo pendiente de una cuota (capital + interés + mora no pagados) */
const amountDue = (i: InstallmentView) =>
  fmt(
    D(i.payment)
      .minus(i.paidPrincipal)
      .minus(i.paidInterest)
      .plus(i.lateInterestAccrued)
      .minus(i.paidLateInterest),
  );

const isOpen = (i: InstallmentView) => i.status === 'PENDING' || i.status === 'PARTIAL' || i.status === 'OVERDUE';

/** Saldo de capital + interés de la cuota, sin la mora */
const installmentBalance = (i: InstallmentView) => fmt(D(i.payment).minus(i.paidPrincipal).minus(i.paidInterest));
const lateFeeDue = (i: InstallmentView) => fmt(D(i.lateInterestAccrued).minus(i.paidLateInterest));

function lateFeeRule(loan: { lateFeeType: string; lateFeeAmount: { toString(): string } | null; lateRateMonthly: { toString(): string } | null }) {
  if (loan.lateFeeType === 'PER_DAY' && loan.lateFeeAmount) return `${usd(loan.lateFeeAmount.toString())} por cada día de atraso`;
  if (loan.lateFeeType === 'PER_INSTALLMENT' && loan.lateFeeAmount) return `${usd(loan.lateFeeAmount.toString())} por cuota vencida`;
  if (loan.lateRateMonthly) return `interés moratorio de ${(Number(loan.lateRateMonthly.toString()) * 100).toFixed(2)}% mensual sobre el capital vencido`;
  return null;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly mail: MailService,
    private readonly finance: FinanceService,
    private readonly pdf: PdfService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    this.events.on('lead.created', ({ leadId }) => this.notifyLeadCreated(leadId));
    this.events.on('loan.activated', ({ loanId }) => this.notifyLoanActivated(loanId));
    this.events.on('payment.registered', ({ paymentId }) => this.notifyPaymentRegistered(paymentId));
  }

  isConfigured() {
    return this.mail.isConfigured();
  }

  async notifyLeadCreated(leadId: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, include: { vehicle: true } });
    if (!lead) return;
    const vehicle = vehicleLabel(lead.vehicle);

    await this.mail.send({
      to: lead.email,
      template: 'lead.received',
      dedupeKey: `lead:${lead.id}:received`,
      ...leadReceivedMail({ fullName: lead.fullName, code: lead.code, vehicle, termMonths: lead.termMonths }),
    });

    const staff = await this.settings.getStaffNotificationEmails();
    for (const to of staff) {
      await this.mail.send({
        to,
        template: 'lead.staff-alert',
        dedupeKey: `lead:${lead.id}:staff:${to.toLowerCase()}`,
        ...leadStaffAlertMail({
          fullName: lead.fullName,
          code: lead.code,
          email: lead.email,
          phone: lead.phone,
          vehicle,
          message: lead.message,
        }),
      });
    }
  }

  async notifyLoanActivated(loanId: string) {
    const { loan, snapshot } = await this.finance.getLoanLedgerSnapshot(loanId);
    const first = snapshot.current.installments[0];

    const schedulePdf = await this.pdf.generateAmortizationSchedulePdf(loan.id).catch((err) => {
      this.logger.warn(`No se pudo adjuntar la tabla de amortización de ${loan.code}: ${err?.message || err}`);
      return null;
    });

    const summary = {
      fullName: loan.customer.fullName,
      loanCode: loan.code,
      vehicle: vehicleLabel(loan.vehicle) || '-',
      principal: loan.originalPrincipal.toString(),
      installment: first?.payment ?? '0',
      termCount: loan.termCount,
      monthlyRate: loan.monthlyRate.toString(),
      firstDueDate: first?.dueDate ?? loan.firstDueDate.toISOString(),
    };

    await this.mail.send({
      to: loan.customer.email,
      template: 'loan.approved',
      dedupeKey: `loan:${loan.id}:approved`,
      loanId: loan.id,
      attachments: schedulePdf
        ? [{ filename: `Tabla-Amortizacion-${loan.code}.pdf`, content: schedulePdf, contentType: 'application/pdf' }]
        : undefined,
      ...loanApprovedMail(summary),
    });

    const staff = await this.settings.getStaffNotificationEmails();
    for (const to of staff) {
      await this.mail.send({
        to,
        template: 'loan.approved.staff',
        dedupeKey: `loan:${loan.id}:approved:staff:${to}`,
        loanId: loan.id,
        ...loanApprovedStaffMail({ ...summary, email: loan.customer.email }),
      });
    }
  }

  async notifyPaymentRegistered(paymentId: string) {
    const payment = await this.prisma.paymentTransaction.findUnique({ where: { id: paymentId } });
    if (!payment || payment.isReversed) return;

    const { loan, snapshot } = await this.finance.getLoanLedgerSnapshot(payment.loanId);
    const next = snapshot.current.installments.find(isOpen);

    await this.mail.send({
      to: loan.customer.email,
      template: 'payment.registered',
      dedupeKey: `payment:${payment.id}`,
      loanId: loan.id,
      ...paymentRegisteredMail({
        fullName: loan.customer.fullName,
        loanCode: loan.code,
        paymentCode: payment.code,
        amount: payment.amountReceived.toString(),
        effectiveDate: payment.effectiveDate.toISOString(),
        principalBalance: snapshot.principalBalance,
        paidOff: snapshot.status === 'PAID_OFF',
        next: next ? { number: next.number, dueDate: next.dueDate, amount: amountDue(next) } : null,
      }),
    });
  }

  /** Envío manual del estado de cuenta en PDF (al correo del cliente o a uno indicado). */
  async sendAccountStatement(loanId: string, to?: string): Promise<MailResult & { to: string }> {
    const { loan, snapshot } = await this.finance.getLoanLedgerSnapshot(loanId);
    const recipient = to || loan.customer.email;
    const pdf = await this.pdf.generateAccountStatementPdf(loan.id);
    const result = await this.mail.send({
      to: recipient,
      template: 'loan.statement',
      loanId: loan.id,
      attachments: [{ filename: `Estado-Cuenta-${loan.code}.pdf`, content: pdf, contentType: 'application/pdf' }],
      ...accountStatementMail({
        fullName: loan.customer.fullName,
        loanCode: loan.code,
        asOf: todayInTz(TIMEZONE),
        principalBalance: snapshot.principalBalance,
      }),
    });
    return { ...result, to: recipient };
  }

  /** Últimos correos registrados (enviados o fallidos), para diagnóstico desde administración. */
  recentLogs(loanId?: string, take = 50) {
    return this.prisma.notificationLog.findMany({
      where: loanId ? { loanId } : {},
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 200),
      select: {
        recipientEmail: true,
        subject: true,
        templateName: true,
        status: true,
        errorMessage: true,
        sentAt: true,
        createdAt: true,
        loanId: true,
      },
    });
  }

  async sendTest(to: string) {
    return this.mail.send({ to, template: 'test', ...testMail() });
  }

  /**
   * Daemon diario de cobranza (8:00, hora de El Salvador). Para cada crédito activo recalcula la mora al día
   * y envía:
   * - recordatorio de pago N días antes del vencimiento (N = parámetro "días de recordatorio");
   * - aviso de cuota vencida al terminar los días de gracia, con el saldo de la cuota y la mora acumulada,
   *   repetido cada M días mientras siga pendiente (M = parámetro "repetir aviso de mora").
   * Las claves de deduplicación evitan reenvíos aunque se ejecute varias veces el mismo día.
   */
  @Cron('0 8 * * *', { name: 'payment-reminders', timeZone: TIMEZONE })
  async sendPaymentReminders() {
    if (!this.mail.isConfigured()) return { checked: 0, reminders: 0, overdueNotices: 0, sent: 0 };

    const today = todayInTz(TIMEZONE);
    const cfg = await this.settings.getCollectionSettings();
    const reminderTarget = addDays(today, cfg.reminderDaysBefore);

    const loans = await this.prisma.loan.findMany({ where: { status: LoanStatus.ACTIVE }, select: { id: true } });
    let reminders = 0;
    let overdueNotices = 0;

    for (const { id } of loans) {
      try {
        const { loan, snapshot } = await this.finance.getLoanLedgerSnapshot(id, today);
        for (const inst of snapshot.current.installments) {
          if (!isOpen(inst) || !D(amountDue(inst)).gt(0)) continue;

          if (inst.dueDate === reminderTarget) {
            const result = await this.mail.send({
              to: loan.customer.email,
              template: 'payment.reminder',
              dedupeKey: `reminder:${loan.id}:${inst.number}:${inst.dueDate}:${cfg.reminderDaysBefore}`,
              loanId: loan.id,
              ...paymentReminderMail({
                fullName: loan.customer.fullName,
                loanCode: loan.code,
                installmentNumber: inst.number,
                termCount: loan.termCount,
                dueDate: inst.dueDate,
                amountDue: amountDue(inst),
                daysBefore: cfg.reminderDaysBefore,
              }),
            });
            if (result.status === 'SENT') reminders++;
          }

          // Aviso de mora: a partir del primer día posterior a la gracia del crédito
          if (inst.daysOverdue > loan.graceDays && (await this.overdueNoticeDue(loan.id, inst, today, cfg.overdueReminderEveryDays))) {
            const result = await this.mail.send({
              to: loan.customer.email,
              template: 'payment.overdue',
              dedupeKey: `overdue:${loan.id}:${inst.number}:${inst.dueDate}:${today}`,
              loanId: loan.id,
              ...paymentOverdueMail({
                fullName: loan.customer.fullName,
                loanCode: loan.code,
                installmentNumber: inst.number,
                termCount: loan.termCount,
                dueDate: inst.dueDate,
                daysOverdue: inst.daysOverdue,
                graceDays: loan.graceDays,
                installmentBalance: installmentBalance(inst),
                lateFee: lateFeeDue(inst),
                lateFeeRule: lateFeeRule(loan),
                totalDue: amountDue(inst),
              }),
            });
            if (result.status === 'SENT') overdueNotices++;
          }
        }
      } catch (err: any) {
        this.logger.error(`Cobranza del crédito ${id}: ${err?.message || err}`);
      }
    }

    this.logger.log(
      `Cobranza diaria: ${reminders} recordatorios y ${overdueNotices} avisos de mora enviados, ${loans.length} créditos revisados.`,
    );
    return { checked: loans.length, reminders, overdueNotices, sent: reminders + overdueNotices };
  }

  /** El primer aviso sale apenas termina la gracia; después, cada `everyDays` días (0 = solo una vez). */
  private async overdueNoticeDue(loanId: string, inst: InstallmentView, today: string, everyDays: number) {
    const last = await this.prisma.notificationLog.findFirst({
      where: { status: 'SENT', dedupeKey: { startsWith: `overdue:${loanId}:${inst.number}:${inst.dueDate}:` } },
      orderBy: { sentAt: 'desc' },
      select: { dedupeKey: true },
    });
    if (!last?.dedupeKey) return true;
    if (everyDays === 0) return false;
    const lastDay = last.dedupeKey.slice(-10);
    return addDays(lastDay, everyDays) <= today;
  }
}
