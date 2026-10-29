import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { FinanceService } from '../finance/finance.service';

// Línea del pie de página; las filas de las tablas no deben pasar de aquí
const FOOTER_TOP = 735;

/**
 * Dibuja el pie en todas las páginas. El pie queda dentro del margen inferior, así que se
 * anula temporalmente para que pdfkit no cree una página nueva (vacía) al escribirlo.
 */
function drawFooters(doc: PDFKit.PDFDocument, note: string, colorBorder: string, colorMuted: string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(36, FOOTER_TOP).lineTo(576, FOOTER_TOP).strokeColor(colorBorder).lineWidth(0.5).stroke();
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor(colorMuted)
      .text('VELTOR — Una solución tecnológica de Nevora Software', 36, 745, { align: 'left', lineBreak: false })
      .text(note, 36, 757, { align: 'left', lineBreak: false })
      .text(`Página ${i - range.start + 1} de ${range.count}`, 36, 745, { width: 540, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
}

@Injectable()
export class PdfService {
  constructor(private readonly financeService: FinanceService) {}

  /** `scope` restringe el crédito (p. ej. al cliente autenticado en el portal). */
  async generateAmortizationSchedulePdf(loanId: string, scope: Prisma.LoanWhereInput = {}): Promise<Buffer> {
    // La tabla se toma del motor financiero: refleja abonos extraordinarios y estado real de cada cuota
    const { loan, snapshot } = await this.financeService.getLoanLedgerSnapshot(loanId, undefined, scope);
    const installmentsToRender = snapshot.current.installments.map((inst) => ({
      number: inst.number,
      dueDate: new Date(inst.dueDate),
      openingBalance: inst.openingBalance,
      scheduledPrincipal: inst.principal,
      scheduledInterest: inst.interest,
      scheduledPayment: inst.payment,
      closingBalance: inst.closingBalance,
      status: inst.status,
    }));

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 36, size: 'LETTER', bufferPages: true });
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
        if (currentY + 16 > FOOTER_TOP - 4) {
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

      drawFooters(doc, 'Documento emitido para fines informativos y contractuales de la cartera de crédito.', colorBorder, colorMuted);
      doc.end();
    });
  }

  async generateAccountStatementPdf(loanId: string, scope: Prisma.LoanWhereInput = {}): Promise<Buffer> {
    const { loan: rawLoan, snapshot } = await this.financeService.getLoanLedgerSnapshot(loanId, undefined, scope);
    // Historial de pagos del más reciente al más antiguo
    const loan = { ...rawLoan, payments: [...rawLoan.payments].reverse() };
    const nextPending = snapshot.current.installments.find((i) => i.status !== 'PAID');

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 36, size: 'LETTER', bufferPages: true });
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

      doc.text(`Monto Inicial: $${Number(loan.originalPrincipal).toFixed(2)}`, 310, boxTop + 24);
      doc.font('Helvetica-Bold').fillColor('#0F766E').text(`Saldo de Capital Actual: $${Number(snapshot.principalBalance).toFixed(2)}`, 310, boxTop + 38);
      doc.font('Helvetica').fillColor(colorGraphite).text(`Total Abonado a la Fecha: $${totalPaid.toFixed(2)}`, 310, boxTop + 52);
      doc.text(`Próxima Cuota: ${nextPending ? `$${Number(nextPending.payment).toFixed(2)} (${nextPending.dueDate})` : 'Crédito cancelado'}`, 310, boxTop + 66);

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

      drawFooters(doc, 'Este estado de cuenta refleja los movimientos contables registrados hasta la fecha de corte.', colorBorder, colorMuted);
      doc.end();
    });
  }
}
