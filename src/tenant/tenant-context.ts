import { AsyncLocalStorage } from 'async_hooks';

/** Datos de la empresa que necesitan los correos, los PDF y la cobranza (se cargan de la BD en cada petición). */
export interface TenantCompanyInfo {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  tagline: string | null;
  primaryColor: string;
  accentColor: string;
  locale: string;
  currency: string;
  timezone: string;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface TenantStore {
  /** Empresa sobre la que opera el código actual; null = plataforma (superadmin sin X-Company-Id). */
  companyId: string | null;
  company?: TenantCompanyInfo;
}

/** Se lanza cuando se consulta un modelo con companyId fuera de un contexto de empresa. */
export class MissingTenantError extends Error {
  constructor(detail?: string) {
    super(
      `Consulta sin contexto de empresa${detail ? ` (${detail})` : ''}. ` +
        'Ejecútela dentro de TenantContext.run(companyId, …) o use prisma.unscoped de forma explícita.',
    );
    this.name = 'MissingTenantError';
  }
}

const storage = new AsyncLocalStorage<TenantStore>();

/**
 * Contexto de empresa por petición, cron o evento (AsyncLocalStorage).
 * Lo llena el TenantInterceptor (HTTP), el daemon de cobranza (por empresa) y DomainEvents (hereda el del emisor).
 */
export const TenantContext = {
  run<T>(companyId: string | null, fn: () => T, company?: TenantCompanyInfo): T {
    return storage.run({ companyId, company: company && company.id === companyId ? company : undefined }, fn);
  },

  /** Ejecuta `fn` con el mismo contexto (copiado) que `store`; sin store, sin contexto de empresa. */
  runWith<T>(store: TenantStore | undefined, fn: () => T): T {
    return storage.run(store ? { ...store } : { companyId: null }, fn);
  },

  store(): TenantStore | undefined {
    return storage.getStore();
  },

  /** companyId actual o undefined si no hay contexto de empresa. */
  companyId(): string | undefined {
    return storage.getStore()?.companyId ?? undefined;
  },

  /** Datos de la empresa actual, si se cargaron (peticiones HTTP y cron). */
  company(): TenantCompanyInfo | undefined {
    return storage.getStore()?.company;
  },

  requireCompanyId(detail?: string): string {
    const id = storage.getStore()?.companyId;
    if (!id) throw new MissingTenantError(detail);
    return id;
  },
};
