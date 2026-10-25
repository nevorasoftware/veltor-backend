import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Health & Monitoring')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Verificación de estado de la aplicación' })
  check() {
    return {
      status: 'ok',
      product: 'VELTOR',
      developer: 'Nevora Software',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      timezone: 'America/El_Salvador',
      currency: 'USD',
    };
  }
}
