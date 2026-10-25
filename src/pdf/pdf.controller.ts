import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiProduces } from '@nestjs/swagger';
import { Response } from 'express';
import { PdfService } from './pdf.service';

@ApiTags('Reportes PDF y Documentos Oficiales')
@Controller('finance/loans')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  @Get(':id/schedule.pdf')
  @ApiOperation({ summary: 'Generar y descargar Tabla de Amortización oficial en formato PDF' })
  @ApiProduces('application/pdf')
  async getAmortizationSchedulePdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.pdfService.generateAmortizationSchedulePdf(id);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="VELTOR-Tabla-Amortizacion-${id}.pdf"`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }

  @Get(':id/statement.pdf')
  @ApiOperation({ summary: 'Generar y descargar Estado de Cuenta de crédito en formato PDF' })
  @ApiProduces('application/pdf')
  async getAccountStatementPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.pdfService.generateAccountStatementPdf(id);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="VELTOR-Estado-Cuenta-${id}.pdf"`,
      'Content-Length': buffer.length,
    });

    res.end(buffer);
  }
}
