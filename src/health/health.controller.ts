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
    const commit = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || null;
    return {
      status: 'ok',
      developer: 'Nevora Software',
      // Versión desplegada (Railway la inyecta en cada build)
      commit,
      commitShort: commit ? commit.slice(0, 7) : null,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
