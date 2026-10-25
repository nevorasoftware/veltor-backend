import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ReportsService } from './reports.service';

@ApiTags('Reportes e Indicadores Financieros')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Obtener indicadores del Dashboard administrativo' })
  async getDashboard() {
    return this.reportsService.getDashboardMetrics();
  }

  @Get('loans')
  @ApiOperation({ summary: 'Listar cartera de créditos para reportes' })
  async getLoans() {
    return this.reportsService.getLoansSummary();
  }
}
