import { Controller, Get, Param, Res, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiProduces, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { Prisma, UserRole } from '@prisma/client';
import { PdfService } from './pdf.service';
import { Roles } from '../auth/roles.decorator';

/** Los clientes solo pueden descargar documentos de sus propios créditos. */
function scopeFor(user: any): Prisma.LoanWhereInput {
  return user.role === UserRole.CUSTOMER ? { customerId: user.customerId ?? '__none__' } : {};
}

@ApiTags('Reportes PDF y Documentos Oficiales')
@ApiBearerAuth()
@Roles(...Object.values(UserRole))
@Controller('finance/loans')
export class PdfController {
  constructor(private readonly pdfService: PdfService) {}

  private send(res: Response, buffer: Buffer, filename: string) {
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
      'Content-Length': buffer.length,
      'Cache-Control': 'no-store',
    });
    res.end(buffer);
  }

  @Get(':id/schedule.pdf')
  @ApiOperation({ summary: 'Generar y descargar Tabla de Amortización oficial en formato PDF' })
  @ApiProduces('application/pdf')
  async getAmortizationSchedulePdf(@Param('id') id: string, @Request() req: any, @Res() res: Response) {
    const buffer = await this.pdfService.generateAmortizationSchedulePdf(id, scopeFor(req.user));
    this.send(res, buffer, `Tabla-Amortizacion-${encodeURIComponent(id)}.pdf`);
  }

  @Get(':id/statement.pdf')
  @ApiOperation({ summary: 'Generar y descargar Estado de Cuenta de crédito en formato PDF' })
  @ApiProduces('application/pdf')
  async getAccountStatementPdf(@Param('id') id: string, @Request() req: any, @Res() res: Response) {
    const buffer = await this.pdfService.generateAccountStatementPdf(id, scopeFor(req.user));
    this.send(res, buffer, `Estado-Cuenta-${encodeURIComponent(id)}.pdf`);
  }
}
