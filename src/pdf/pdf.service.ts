import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { FinanceService } from '../finance/finance.service';
import { orDash, vehicleName } from '../common/labels';
import { PrismaService } from '../prisma/prisma.service';
import {
  PLATFORM_CREDIT,
  brandLegalName,
  brandName,
  brandPrimary,
  brandTagline,
  contactParts,
  formatDate,
  formatMoney,
  loadRasterLogo,
} from '../tenant/company-branding';

type Logo = { data: Buffer; mime: string } | null;

/**
 * Encabezado con la marca de la empresa del contexto: su logo (PNG/JPEG) o, si no tiene, su nombre;
 * el eslogan debajo; a la derecha el título del documento y sus referencias.
 */
function drawHeader(doc: PDFKit.PDFDocument, logo: Logo, title: string, refs: string[], colorMuted: string, colorTitle: string) {
  const primary = brandPrimary();
  let drewLogo = false;
  if (logo) {
    try {
      doc.image(logo.data, 36, 30, { fit: [170, 42], valign: 'center' });
      drewLogo = true;
    } catch {
      drewLogo = false;
    }
  }
  if (!drewLogo) doc.fontSize(22).fillColor(primary).font('Helvetica-Bold').text(brandName(), 36, 36, { width: 260, lineBreak: false });
  const tagline = brandTagline();
  if (tagline) doc.fontSize(8.5).fillColor(colorMuted).font('Helvetica').text(tagline, 36, 74, { width: 260, lineBreak: false });

  doc.fontSize(12).fillColor(colorTitle).font('Helvetica-Bold').text(title, 300, 38, { align: 'right' });
  doc.fontSize(9).font('Helvetica').fillColor(colorMuted);
  refs.forEach((r, i) => doc.text(r, 300, 54 + i * 14, { align: 'right' }));
  doc.moveTo(36, 88).lineTo(576, 88).strokeColor(primary).lineWidth(1.5).stroke();
}

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
    const contacts = [brandLegalName(), ...contactParts()].join('  ·  ');
    doc
      .fontSize(7.5)
      .font('Helvetica')
      .fillColor(colorMuted)
      .text(contacts, 36, 741, { width: 440, align: 'left', lineBreak: false })
      .text(note, 36, 752, { width: 540, align: 'left', lineBreak: false })
      .text(PLATFORM_CREDIT, 36, 763, { width: 540, align: 'left', lineBreak: false })
      .text(`Página ${i - range.start + 1} de ${range.count}`, 36, 741, { width: 540, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
}

@Injectable()
export class PdfService {
  constructor(
    private readonly financeService: FinanceService,
    private readonly prisma: PrismaService,
  ) {}

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
      insurance: inst.insurance,
      totalPayment: inst.totalPayment,
      closingBalance: inst.closingBalance,
      status: inst.status,
    }));
    const logo = await loadRasterLogo(this.prisma.unscoped);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 36, size: 'LETTER', bufferPages: true });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      // Colores de marca de la empresa
      const colorNightBlue = brandPrimary();
      const colorGraphite = '#1E293B';
      const colorMuted = '#64748B';
      const colorBorder = '#CBD5E1';
      const colorRowAlt = '#F8FAFC';

      // Encabezado con la marca de la empresa
      drawHeader(doc, logo, 'TABLA DE AMORTIZACIÓN CONTRACTUAL', [`Crédito N°: ${loan.code}`, `Fecha Emisión: ${formatDate()}`], colorMuted, colorGraphite);

      // Cuadro de Información del Crédito y Cliente
      const boxTop = 96;
      doc.rect(36, boxTop, 540, 75).fillAndStroke('#F1F5F9', colorBorder);

      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(colorNightBlue);
      doc.text('INFORMACIÓN DEL CLIENTE', 46, boxTop + 8);
      doc.text('DETALLES DEL FINANCIAMIENTO', 310, boxTop + 8);

      doc.font('Helvetica').fontSize(8).fillColor(colorGraphite);
      doc.text(`Cliente: ${loan.customer.fullName}`, 46, boxTop + 22);
      doc.text(`DUI: ${loan.customer.dui || 'N/A'}`, 46, boxTop + 34);
      doc.text(`Teléfono: ${orDash(loan.customer.phone)}`, 46, boxTop + 46);
      doc.text(`Vehículo: ${vehicleName(loan.vehicle)}`, 46, boxTop + 58);

      doc.text(`Monto Financiado: ${formatMoney(loan.originalPrincipal)}`, 310, boxTop + 22);
      doc.text(`Tasa Mensual: ${(Number(loan.monthlyRate) * 100).toFixed(2)}%`, 310, boxTop + 34);
      doc.text(
        `Plazo: ${loan.termCount} meses (${loan.frequency})${Number(loan.insuranceMonthly ?? 0) > 0 ? ` · Seguro: ${formatMoney(loan.insuranceMonthly)}/mes` : ''}`,
        310,
        boxTop + 46,
      );
      doc.text(`Base de Cálculo: ${loan.dayCount}`, 310, boxTop + 58);

      // Columnas de la tabla: con seguro se agrega la columna "Seguro" y "Cuota Total" = cuota + seguro
      const hasInsurance = Number(loan.insuranceMonthly ?? 0) > 0;
      type Col = { title: string; x: number; w: number; align: 'left' | 'center' | 'right'; bold?: boolean };
      const columns: Col[] = hasInsurance
        ? [
            { title: '#', x: 40, w: 22, align: 'center' },
            { title: 'Vencimiento', x: 64, w: 62, align: 'center' },
            { title: 'Saldo Inicial', x: 128, w: 72, align: 'right' },
            { title: 'Capital', x: 202, w: 66, align: 'right' },
            { title: 'Interés', x: 270, w: 62, align: 'right' },
            { title: 'Seguro', x: 334, w: 58, align: 'right' },
            { title: 'Cuota Total', x: 394, w: 82, align: 'right', bold: true },
            { title: 'Saldo Final', x: 478, w: 92, align: 'right' },
          ]
        : [
            { title: '#', x: 42, w: 25, align: 'center' },
            { title: 'Vencimiento', x: 72, w: 70, align: 'center' },
            { title: 'Saldo Inicial', x: 148, w: 80, align: 'right' },
            { title: 'Capital', x: 234, w: 75, align: 'right' },
            { title: 'Interés', x: 315, w: 75, align: 'right' },
            { title: 'Cuota Total', x: 396, w: 85, align: 'right', bold: true },
            { title: 'Saldo Final', x: 487, w: 80, align: 'right' },
          ];
      const drawColumns = (y: number) => columns.forEach((col) => doc.text(col.title, col.x, y, { width: col.w, align: col.align }));

      // Encabezado de la tabla de cuotas
      let currentY = boxTop + 88;
      doc.rect(36, currentY, 540, 20).fillAndStroke(colorNightBlue, colorNightBlue);

      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF');
      drawColumns(currentY + 6);

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
          drawColumns(currentY + 6);
          currentY += 20;
          doc.font('Helvetica').fontSize(7.5);
        }

        const isAlt = i % 2 === 1;
        if (isAlt) {
          doc.rect(36, currentY, 540, 16).fill(colorRowAlt);
        }

        doc.fillColor(colorGraphite);
        const values = [
          item.number.toString(),
          new Date(item.dueDate).toISOString().split('T')[0],
          formatMoney(item.openingBalance),
          formatMoney(item.scheduledPrincipal),
          formatMoney(item.scheduledInterest),
          ...(hasInsurance ? [formatMoney(item.insurance)] : []),
          formatMoney(item.totalPayment),
          formatMoney(item.closingBalance),
        ];
        columns.forEach((col, idx) => {
          doc.font(col.bold ? 'Helvetica-Bold' : 'Helvetica').text(values[idx], col.x, currentY + 4, { width: col.w, align: col.align });
        });
        doc.font('Helvetica');

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
    const logo = await loadRasterLogo(this.prisma.unscoped);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 36, size: 'LETTER', bufferPages: true });
      const buffers: Buffer[] = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const colorNightBlue = brandPrimary();
      const colorGraphite = '#1E293B';
      const colorMuted = '#64748B';
      const colorBorder = '#CBD5E1';
      const colorRowAlt = '#F8FAFC';

      // Encabezado con la marca de la empresa
      drawHeader(doc, logo, 'ESTADO DE CUENTA MENSUAL', [`Referencia: ${loan.code}`, `Corte: ${formatDate()}`], colorMuted, colorNightBlue);

      // Cuadro de Resumen Financiero
      const boxTop = 96;
      doc.rect(36, boxTop, 540, 85).fillAndStroke('#F8FAFC', colorBorder);

      doc.font('Helvetica-Bold').fontSize(9).fillColor(colorNightBlue);
      doc.text('DATOS GENERALES', 46, boxTop + 8);
      doc.text('RESUMEN DE SALDOS', 310, boxTop + 8);

      doc.font('Helvetica').fontSize(8.5).fillColor(colorGraphite);
      doc.text(`Cliente: ${loan.customer.fullName}`, 46, boxTop + 24);
      doc.text(`DUI: ${loan.customer.dui || 'N/A'}`, 46, boxTop + 38);
      doc.text(`Vehículo: ${vehicleName(loan.vehicle)}`, 46, boxTop + 52);
      doc.text(`Estado del Crédito: ${loan.status}`, 46, boxTop + 66);

      const totalPaid = loan.payments.reduce((acc, p) => acc + Number(p.amountApplied), 0);

      doc.text(`Monto Inicial: ${formatMoney(loan.originalPrincipal)}`, 310, boxTop + 24);
      doc.font('Helvetica-Bold').fillColor('#0F766E').text(`Saldo de Capital Actual: ${formatMoney(snapshot.principalBalance)}`, 310, boxTop + 38);
      doc.font('Helvetica').fillColor(colorGraphite).text(`Total Abonado a la Fecha: ${formatMoney(totalPaid)}`, 310, boxTop + 52);
      const insuranceNote = nextPending && Number(nextPending.insurance) > 0 ? ` incl. seguro ${formatMoney(nextPending.insurance)}` : '';
      doc.text(
        `Próxima Cuota: ${nextPending ? `${formatMoney(nextPending.totalPayment)}${insuranceNote} (${nextPending.dueDate})` : 'Crédito cancelado'}`,
        310,
        boxTop + 66,
      );

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
          doc.font('Helvetica-Bold').text(formatMoney(p.amountApplied), 485, currentY + 5, { width: 85, align: 'right' });
          doc.font('Helvetica');
          currentY += 18;
        }
      }

      drawFooters(doc, 'Este estado de cuenta refleja los movimientos contables registrados hasta la fecha de corte.', colorBorder, colorMuted);
      doc.end();
    });
  }
}
