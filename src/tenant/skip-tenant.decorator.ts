import { SetMetadata } from '@nestjs/common';

export const SKIP_TENANT_KEY = 'skipTenant';

/**
 * Ruta pública que no necesita (ni resuelve) una empresa: login, salud, logo por slug, fotos públicas.
 * Su código solo puede usar `prisma.unscoped`.
 */
export const SkipTenant = () => SetMetadata(SKIP_TENANT_KEY, true);
