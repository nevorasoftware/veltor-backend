import { BadRequestException, Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { SkipTenant } from '../tenant/skip-tenant.decorator';
import { TenantResolverService } from '../tenant/tenant-resolver.service';

/** Origen del frontend que pide el manifiesto: https (o http solo en localhost), sin ruta. */
export function frontendOrigin(raw?: string): string {
  try {
    const u = new URL(String(raw || ''));
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return u.origin;
  } catch {
    /* inválido */
  }
  throw new BadRequestException('Parámetro origin inválido');
}

/**
 * Manifiesto de la app instalable (PWA) con el nombre y los colores de cada empresa.
 * El frontend lo enlaza con <link rel="manifest" href=".../public/manifest.webmanifest?empresa=…&origin=…">.
 * start_url, scope e íconos son absolutos al origen del frontend (el manifiesto vive en el dominio de la API).
 */
@ApiTags('Público: Empresa')
@Controller('public')
export class PwaController {
  constructor(private readonly resolver: TenantResolverService) {}

  @Public()
  @SkipTenant()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get('manifest.webmanifest')
  @Header('Content-Type', 'application/manifest+json; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Manifiesto PWA (app instalable) de la empresa' })
  async manifest(@Query('empresa') slug?: string, @Query('origin') origin?: string) {
    const base = frontendOrigin(origin);
    const c = await this.resolver.resolvePublic({ slug, origin: base });
    // En un dominio compartido la empresa va en la URL de inicio; en su dominio propio no hace falta
    const own = c.domains.includes(new URL(base).hostname);
    const q = own ? '' : `?empresa=${encodeURIComponent(c.slug)}`;
    const shortName = c.name.length > 12 ? c.name.split(/\s+/)[0].slice(0, 12) : c.name;
    return {
      id: `${base}/app${q}`,
      name: c.name,
      short_name: shortName,
      description: c.tagline || `Portal de clientes y administración de ${c.name}`,
      lang: (c.locale || 'es').split('-')[0],
      start_url: `${base}/app${q}`,
      scope: `${base}/`,
      display: 'standalone',
      background_color: '#0B132B',
      theme_color: c.primaryColor,
      icons: [
        { src: `${base}/pwa/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `${base}/pwa/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `${base}/pwa/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
  }
}
