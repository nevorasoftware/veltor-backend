import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { SkipTenant } from '../tenant/skip-tenant.decorator';

@ApiTags('Health & Monitoring')
@Controller('health')
export class HealthController {
  @Public()
  @SkipTenant()
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
