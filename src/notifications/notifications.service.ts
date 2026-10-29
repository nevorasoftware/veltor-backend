import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { LoanStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEvents } from '../common/domain-events';
import { MailService, MailResult } from '../mail/mail.service';
import { FinanceService } from '../finance/finance.service';
import { PdfService } from '../pdf/pdf.service';
import { InstallmentView, addDays, todayInTz, D, fmt } from '../finance/engine';
import {
  accountStatementMail,
  leadReceivedMail,
  leadStaffAlertMail,
  loanApprovedMail,
  paymentRegisteredMail,
  paymentReminderMail,
  testMail,
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

/** Días de anticipación de los recordatorios, p. ej. PAYMENT_REMINDER_DAYS=3,0 (0 = el mismo día) */
function reminderDays(): number[] {
  const parsed = (process.env.PAYMENT_REMINDER_DAYS || '3,0')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 30);
  return [...new Set(parsed)];
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

    const staff = (process.env.NOTIFY_STAFF_EMAILS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
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

    await this.mail.send({
      to: loan.customer.email,
      template: 'loan.approved',
      dedupeKey: `loan:${loan.id}:approved`,
      loanId: loan.id,
      attachments: schedulePdf
        ? [{ filename: `Tabla-Amortizacion-${loan.code}.pdf`, content: schedulePdf, contentType: 'application/pdf' }]
        : undefined,
      ...loanApprovedMail({
        fullName: loan.customer.fullName,
        loanCode: loan.code,
        vehicle: vehicleLabel(loan.vehicle) || '-',
        principal: loan.originalPrincipal.toString(),
        installment: first?.payment ?? '0',
        termCount: loan.termCount,
        monthlyRate: loan.monthlyRate.toString(),
        firstDueDate: first?.dueDate ?? loan.firstDueDate.toISOString(),
      }),
    });
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

  async sendTest(to: string) {
    return this.mail.send({ to, template: 'test', ...testMail() });
  }

  /** Recordatorios diarios de cuotas próximas a vencer. La clave de deduplicación evita repetirlos. */
  @Cron('0 8 * * *', { name: 'payment-reminders', timeZone: TIMEZONE })
  async sendPaymentReminders() {
    if (!this.mail.isConfigured()) return { checked: 0, sent: 0 };

    const today = todayInTz(TIMEZONE);
    const days = reminderDays();
    const targets = new Map(days.map((d) => [addDays(today, d), d]));

    const loans = await this.prisma.loan.findMany({ where: { status: LoanStatus.ACTIVE }, select: { id: true } });
    let sent = 0;

    for (const { id } of loans) {
      try {
        const { loan, snapshot } = await this.finance.getLoanLedgerSnapshot(id, today);
        for (const inst of snapshot.current.installments) {
          const daysBefore = targets.get(inst.dueDate);
          if (daysBefore === undefined || !isOpen(inst) || !D(amountDue(inst)).gt(0)) continue;

          const result = await this.mail.send({
            to: loan.customer.email,
            template: 'payment.reminder',
            dedupeKey: `reminder:${loan.id}:${inst.number}:${inst.dueDate}:${daysBefore}`,
            loanId: loan.id,
            ...paymentReminderMail({
              fullName: loan.customer.fullName,
              loanCode: loan.code,
              installmentNumber: inst.number,
              termCount: loan.termCount,
              dueDate: inst.dueDate,
              amountDue: amountDue(inst),
              daysBefore,
            }),
          });
          if (result.status === 'SENT') sent++;
        }
      } catch (err: any) {
        this.logger.error(`Recordatorios del crédito ${id}: ${err?.message || err}`);
      }
    }

    this.logger.log(`Recordatorios de pago: ${sent} enviados, ${loans.length} créditos revisados.`);
    return { checked: loans.length, sent };
  }
}
