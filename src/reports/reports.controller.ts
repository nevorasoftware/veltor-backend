import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReportsService } from './reports.service';

@ApiTags('Reportes e Indicadores Financieros')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Obtener indicadores del Dashboard administrativo' })
  async getDashboard() {
    return this.reportsService.getDashboardMetrics();
  }

  @Get('delinquency')
  @ApiOperation({ summary: 'Resumen de mora a hoy (zona horaria de la empresa): totales y detalle por crédito' })
  async getDelinquency() {
    return this.reportsService.getDelinquency();
  }

  @Get('loans')
  @ApiOperation({ summary: 'Listar cartera de créditos para reportes' })
  async getLoans() {
    return this.reportsService.getLoansSummary();
  }
}
