import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import PDFDocument from 'pdfkit';
import Decimal from 'decimal.js';
import { generateSchedule } from '../finance/engine';

@Injectable()
export class PdfService {
  constructor(private readonly prisma: PrismaService) {}

  async generateAmortizationSchedulePdf(loanId: string): Promise<Buffer> {
    const loan = await this.prisma.loan.findFirst({
      where: {
        OR: [{ id: loanId }, { code: loanId }],
      },
      include: {
        customer: true,
        vehicle: true,
        installments: {
          orderBy: { number: 'asc' },
        },
      },
    });

    if (!loan) {
      throw new NotFoundException(`Crédito con ID o código ${loanId} no encontrado`);
    }

    let installmentsToRender: any[] = loan.installments;

    if (!installmentsToRender || installmentsToRender.length === 0) {
      try {
        const startDateStr = (loan.disbursementDate ? new Date(loan.disbursementDate) : new Date())
          .toISOString()
          .split('T')[0];
        const firstDueDateStr = (loan.firstDueDate ? new Date(loan.firstDueDate) : new Date())
          .toISOString()
          .split('T')[0];
        const generated = generateSchedule({
          principal: new Decimal(loan.originalPrincipal),
          monthlyRate: new Decimal(loan.monthlyRate),
          dayCount: (loan.dayCount as any) || 'D30_360',
          frequency: (loan.frequency as any) || 'MONTHLY',
          rounding: 'HALF_UP',
          method: (loan.method as any) || 'FRENCH',
          startDate: startDateStr,
          startNumber: 1,
          anchorDate: firstDueDateStr,
          anchorNumber: 1,
          count: loan.termCount || 36,
        });

        installmentsToRender = generated.installments.map((inst) => ({
          number: inst.number,
          dueDate: new Date(inst.dueDate),
          openingBalance: inst.openingBalance.toNumber(),
          scheduledPrincipal: inst.principal.toNumber(),
          scheduledInterest: inst.interest.toNumber(),
          scheduledPayment: inst.payment.toNumber(),
          closingBalance: inst.closingBalance.toNumber(),
          status: 'PENDING',
        }));

        this.prisma.amortizationInstallment
          .createMany({
            data: installmentsToRender.map((inst) => ({
              loanId: loan.id,
              versionIndex: 0,
              number: inst.number,
              dueDate: inst.dueDate,
              periodStart: new Date(startDateStr),
              openingBalance: inst.openingBalance,
              scheduledPrincipal: inst.scheduledPrincipal,
              scheduledInterest: inst.scheduledInterest,
              scheduledPayment: inst.scheduledPayment,
              closingBalance: inst.closingBalance,
              status: 'PENDING',
            })),
            skipDuplicates: true,
          })
          .catch(() => {});
      } catch (e) {
        installmentsToRender = [];
      }
    }

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 36, size: 'LETTER' });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Colores de marca VELTOR
      const colorNightBlue = '#0B132B';
      const colorGraphite = '#1E293B';
      const colorMuted = '#64748B';
      const colorBorder = '#CBD5E1';
      const colorRowAlt = '#F8FAFC';

      // Encabezado
      doc
        .fontSize(22)
        .fillColor(colorNightBlue)
        .font('Helvetica-Bold')
        .text('VELTOR', 36, 36)
        .fontSize(8.5)
        .fillColor(colorMuted)
        .font('Helvetica')
        .text('Financiamiento inteligente. Movilidad a tu alcance.', 36, 62);

      doc
        .fontSize(12)
        .fillColor(colorGraphite)
        .font('Helvetica-Bold')
        .text('TABLA DE AMORTIZACIÓN CONTRACTUAL', 300, 38, { align: 'right' })
        .fontSize(9)
        .font('Helvetica')
        .fillColor(colorMuted)
        .text(`Crédito N°: ${loan.code}`, 300, 54, { align: 'right' })
        .text(`Fecha Emisión: ${new Date().toLocaleDateString('es-SV')}`, 300, 68, { align: 'right' });

      // Línea divisoria
      doc.moveTo(36, 88).lineTo(576, 88).strokeColor(colorNightBlue).lineWidth(1.5).stroke();

      // Cuadro de Información del Crédito y Cliente
      const boxTop = 96;
      doc.rect(36, boxTop, 540, 75).fillAndStroke('#F1F5F9', colorBorder);

      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(colorNightBlue);
      doc.text('INFORMACIÓN DEL CLIENTE', 46, boxTop + 8);
      doc.text('DETALLES DEL FINANCIAMIENTO', 310, boxTop + 8);

      doc.font('Helvetica').fontSize(8).fillColor(colorGraphite);
      doc.text(`Cliente: ${loan.customer.fullName}`, 46, boxTop + 22);
      doc.text(`DUI: ${loan.customer.dui || 'N/A'}`, 46, boxTop + 34);
      doc.text(`Teléfono: ${loan.customer.phone}`, 46, boxTop + 46);
      doc.text(`Vehículo: ${loan.vehicle.brand} ${loan.vehicle.model} ${loan.vehicle.year}`, 46, boxTop + 58);

      doc.text(`Monto Financiado: $${Number(loan.originalPrincipal).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 310, boxTop + 22);
      doc.text(`Tasa Mensual: ${(Number(loan.monthlyRate) * 100).toFixed(2)}%`, 310, boxTop + 34);
      doc.text(`Plazo: ${loan.termCount} meses (${loan.frequency})`, 310, boxTop + 46);
      doc.text(`Base de Cálculo: ${loan.dayCount}`, 310, boxTop + 58);

      // Encabezado de la tabla de cuotas
      let currentY = boxTop + 88;
      doc.rect(36, currentY, 540, 20).fillAndStroke(colorNightBlue, colorNightBlue);

      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF');
      doc.text('#', 42, currentY + 6, { width: 25, align: 'center' });
      doc.text('Vencimiento', 72, currentY + 6, { width: 70, align: 'center' });
      doc.text('Saldo Inicial', 148, currentY + 6, { width: 80, align: 'right' });
      doc.text('Capital', 234, currentY + 6, { width: 75, align: 'right' });
      doc.text('Interés', 315, currentY + 6, { width: 75, align: 'right' });
      doc.text('Cuota Total', 396, currentY + 6, { width: 85, align: 'right' });
      doc.text('Saldo Final', 487, currentY + 6, { width: 80, align: 'right' });

      currentY += 20;

      // Iteración de cuotas
      doc.font('Helvetica').fontSize(7.5);

      for (let i = 0; i < installmentsToRender.length; i++) {
        const item = installmentsToRender[i];

        // Manejo de salto de página
        if (currentY > 720) {
          doc.addPage({ margin: 36, size: 'LETTER' });
          currentY = 36;

          // Re-dibujar encabezado de tabla en página nueva
          doc.rect(36, currentY, 540, 20).fillAndStroke(colorNightBlue, colorNightBlue);
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF');
          doc.text('#', 42, currentY + 6, { width: 25, align: 'center' });
          doc.text('Vencimiento', 72, currentY + 6, { width: 70, align: 'center' });
          doc.text('Saldo Inicial', 148, currentY + 6, { width: 80, align: 'right' });
          doc.text('Capital', 234, currentY + 6, { width: 75, align: 'right' });
          doc.text('Interés', 315, currentY + 6, { width: 75, align: 'right' });
          doc.text('Cuota Total', 396, currentY + 6, { width: 85, align: 'right' });
          doc.text('Saldo Final', 487, currentY + 6, { width: 80, align: 'right' });
          currentY += 20;
          doc.font('Helvetica').fontSize(7.5);
        }

        const isAlt = i % 2 === 1;
        if (isAlt) {
          doc.rect(36, currentY, 540, 16).fill(colorRowAlt);
        }

        doc.fillColor(colorGraphite);
        doc.text(item.number.toString(), 42, currentY + 4, { width: 25, align: 'center' });
        doc.text(new Date(item.dueDate).toISOString().split('T')[0], 72, currentY + 4, { width: 70, align: 'center' });
        doc.text(`$${Number(item.openingBalance).toFixed(2)}`, 148, currentY + 4, { width: 80, align: 'right' });
        doc.text(`$${Number(item.scheduledPrincipal).toFixed(2)}`, 234, currentY + 4, { width: 75, align: 'right' });
        doc.text(`$${Number(item.scheduledInterest).toFixed(2)}`, 315, currentY + 4, { width: 75, align: 'right' });
        doc.font('Helvetica-Bold').text(`$${Number(item.scheduledPayment).toFixed(2)}`, 396, currentY + 4, { width: 85, align: 'right' });
        doc.font('Helvetica').text(`$${Number(item.closingBalance).toFixed(2)}`, 487, currentY + 4, { width: 80, align: 'right' });

        currentY += 16;
      }

      // Pie de página oficial
      const bottomY = Math.max(currentY + 20, 740);
      doc.moveTo(36, 735).lineTo(576, 735).strokeColor(colorBorder).lineWidth(0.5).stroke();
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor(colorMuted)
        .text('VELTOR — Una solución tecnológica de Nevora Software', 36, 745, { align: 'left' })
        .text('Documento emitido para fines informativos y contractuales de la cartera de crédito.', 36, 757, { align: 'left' });

      doc.end();
    });
  }

  async generateAccountStatementPdf(loanId: string): Promise<Buffer> {
    const loan = await this.prisma.loan.findFirst({
      where: {
        OR: [{ id: loanId }, { code: loanId }],
      },
      include: {
        customer: true,
        vehicle: true,
        payments: {
          where: { isReversed: false },
          orderBy: { effectiveDate: 'desc' },
          include: { allocations: true },
        },
        installments: {
          orderBy: { number: 'asc' },
        },
      },
    });

    if (!loan) {
      throw new NotFoundException(`Crédito con ID o código ${loanId} no encontrado`);
    }

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 36, size: 'LETTER' });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const colorNightBlue = '#0B132B';
      const colorGraphite = '#1E293B';
      const colorMuted = '#64748B';
      const colorBorder = '#CBD5E1';
      const colorRowAlt = '#F8FAFC';

      // Encabezado
      doc
        .fontSize(22)
        .fillColor(colorNightBlue)
        .font('Helvetica-Bold')
        .text('VELTOR', 36, 36)
        .fontSize(8.5)
        .fillColor(colorMuted)
        .font('Helvetica')
        .text('Financiamiento inteligente. Movilidad a tu alcance.', 36, 62);

      doc
        .fontSize(13)
        .fillColor(colorNightBlue)
        .font('Helvetica-Bold')
        .text('ESTADO DE CUENTA MENSUAL', 300, 38, { align: 'right' })
        .fontSize(9)
        .font('Helvetica')
        .fillColor(colorMuted)
        .text(`Referencia: ${loan.code}`, 300, 54, { align: 'right' })
        .text(`Corte: ${new Date().toLocaleDateString('es-SV')}`, 300, 68, { align: 'right' });

      doc.moveTo(36, 88).lineTo(576, 88).strokeColor(colorNightBlue).lineWidth(1.5).stroke();

      // Cuadro de Resumen Financiero
      const boxTop = 96;
      doc.rect(36, boxTop, 540, 85).fillAndStroke('#F8FAFC', colorBorder);

      doc.font('Helvetica-Bold').fontSize(9).fillColor(colorNightBlue);
      doc.text('DATOS GENERALES', 46, boxTop + 8);
      doc.text('RESUMEN DE SALDOS', 310, boxTop + 8);

      doc.font('Helvetica').fontSize(8.5).fillColor(colorGraphite);
      doc.text(`Cliente: ${loan.customer.fullName}`, 46, boxTop + 24);
      doc.text(`DUI: ${loan.customer.dui || 'N/A'}`, 46, boxTop + 38);
      doc.text(`Vehículo: ${loan.vehicle.brand} ${loan.vehicle.model} (${loan.vehicle.year})`, 46, boxTop + 52);
      doc.text(`Estado del Crédito: ${loan.status}`, 46, boxTop + 66);

      const totalPaid = loan.payments.reduce((acc, p) => acc + Number(p.amountApplied), 0);
      const nextPending = loan.installments.find((i) => i.status === 'PENDING');

      doc.text(`Monto Inicial: $${Number(loan.originalPrincipal).toFixed(2)}`, 310, boxTop + 24);
      doc.font('Helvetica-Bold').fillColor('#0F766E').text(`Saldo de Capital Actual: $${Number(loan.currentPrincipalBalance).toFixed(2)}`, 310, boxTop + 38);
      doc.font('Helvetica').fillColor(colorGraphite).text(`Total Abonado a la Fecha: $${totalPaid.toFixed(2)}`, 310, boxTop + 52);
      doc.text(`Próxima Cuota: ${nextPending ? `$${Number(nextPending.scheduledPayment).toFixed(2)} (${new Date(nextPending.dueDate).toISOString().split('T')[0]})` : 'Al día'}`, 310, boxTop + 66);

      // Tabla de Historial de Pagos Recientes
      let currentY = boxTop + 105;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(colorNightBlue).text('HISTORIAL DE PAGOS ACREDITADOS', 36, currentY);
      currentY += 16;

      doc.rect(36, currentY, 540, 20).fillAndStroke(colorNightBlue, colorNightBlue);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF');
      doc.text('Código', 42, currentY + 6, { width: 75, align: 'left' });
      doc.text('Fecha', 120, currentY + 6, { width: 70, align: 'center' });
      doc.text('Concepto / Tipo', 195, currentY + 6, { width: 110, align: 'left' });
      doc.text('Método', 310, currentY + 6, { width: 80, align: 'center' });
      doc.text('Referencia', 395, currentY + 6, { width: 85, align: 'left' });
      doc.text('Monto Aplicado', 485, currentY + 6, { width: 85, align: 'right' });

      currentY += 20;
      doc.font('Helvetica').fontSize(8);

      if (loan.payments.length === 0) {
        doc.rect(36, currentY, 540, 24).fill(colorRowAlt);
        doc.fillColor(colorMuted).text('No se han registrado pagos en este crédito todavía.', 46, currentY + 8);
        currentY += 24;
      } else {
        for (let i = 0; i < Math.min(loan.payments.length, 25); i++) {
          const p = loan.payments[i];
          if (i % 2 === 1) {
            doc.rect(36, currentY, 540, 18).fill(colorRowAlt);
          }
          doc.fillColor(colorGraphite);
          doc.text(p.code, 42, currentY + 5, { width: 75, align: 'left' });
          doc.text(new Date(p.effectiveDate).toISOString().split('T')[0], 120, currentY + 5, { width: 70, align: 'center' });
          doc.text(p.kind, 195, currentY + 5, { width: 110, align: 'left' });
          doc.text(p.paymentMethod, 310, currentY + 5, { width: 80, align: 'center' });
          doc.text(p.referenceNumber || '-', 395, currentY + 5, { width: 85, align: 'left' });
          doc.font('Helvetica-Bold').text(`$${Number(p.amountApplied).toFixed(2)}`, 485, currentY + 5, { width: 85, align: 'right' });
          doc.font('Helvetica');
          currentY += 18;
        }
      }

      // Pie de página
      doc.moveTo(36, 735).lineTo(576, 735).strokeColor(colorBorder).lineWidth(0.5).stroke();
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor(colorMuted)
        .text('VELTOR — Una solución tecnológica de Nevora Software', 36, 745, { align: 'left' })
        .text('Este estado de cuenta refleja los movimientos contables registrados hasta la fecha de corte.', 36, 757, { align: 'left' });

      doc.end();
    });
  }
}
