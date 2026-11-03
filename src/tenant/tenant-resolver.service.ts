import { Injectable, NotFoundException } from '@nestjs/common';
import { Company } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantCompanyInfo } from './tenant-context';

export interface PublicTenantHints {
  /** Header X-Tenant (slug) */
  slug?: string | null;
  /** Hostname de la petición (Host / X-Forwarded-Host) */
  host?: string | null;
  /** Header Origin (o Referer) del navegador */
  origin?: string | null;
}

/** "https://Mi.Dominio.com:443/ruta" o "mi.dominio.com:8080" → "mi.dominio.com" */
export function hostnameOf(value?: string | null): string | null {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  try {
    return new URL(v.includes('://') ? v : `http://${v}`).hostname || null;
  } catch {
    return null;
  }
}

/** Empresa sin los bytes del logo (se consulta en cada petición) */
export type CompanyRecord = Omit<Company, 'logoData'>;
export const WITHOUT_LOGO = { logoData: true } as const;

const asBankAccounts = (v: unknown): { bank: string; detail: string }[] =>
  Array.isArray(v)
    ? v
        .filter((x) => x && typeof x === 'object')
        .map((x: any) => ({ bank: String(x.bank ?? ''), detail: String(x.detail ?? '') }))
    : [];

export const toCompanyInfo = (c: CompanyRecord): TenantCompanyInfo => ({
  id: c.id,
  slug: c.slug,
  name: c.name,
  legalName: c.legalName,
  tagline: c.tagline,
  primaryColor: c.primaryColor,
  secondaryColor: c.secondaryColor,
  accentColor: c.accentColor,
  locale: c.locale,
  currency: c.currency,
  timezone: c.timezone,
  domains: c.domains,
  contactEmail: c.contactEmail,
  contactPhone: c.contactPhone,
  contactHours: c.contactHours,
  paymentsEmail: c.paymentsEmail,
  paymentsWhatsapp: c.paymentsWhatsapp,
  bankAccounts: asBankAccounts(c.bankAccounts),
  bankAccountHolder: c.bankAccountHolder,
  logoMime: c.logoMime,
});

const NOT_FOUND = 'Empresa no encontrada o inactiva';

/**
 * Resuelve la empresa de una petición. Todas las consultas son a `companies` (sin filtro de empresa)
 * y se hacen en cada petición: activar o desactivar una empresa tiene efecto inmediato.
 */
@Injectable()
export class TenantResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Petición pública: header X-Tenant (slug) → Host/Origin contra `domains` → empresa por defecto.
   * Si la empresa no existe o está inactiva responde 404.
   */
  async resolvePublic(hints: PublicTenantHints): Promise<CompanyRecord> {
    const db = this.prisma.unscoped;

    const slug = hints.slug?.trim().toLowerCase();
    if (slug) {
      const bySlug = await db.company.findUnique({ where: { slug }, omit: WITHOUT_LOGO });
      if (!bySlug?.isActive) throw new NotFoundException(NOT_FOUND);
      return bySlug;
    }

    // El Origin identifica el sitio del frontend; el Host, la API cuando se publica en el dominio de la empresa
    for (const host of [hostnameOf(hints.origin), hostnameOf(hints.host)]) {
      if (!host) continue;
      const byDomain = await db.company.findFirst({ where: { domains: { has: host } }, orderBy: { createdAt: 'asc' }, omit: WITHOUT_LOGO });
      if (byDomain) {
        if (!byDomain.isActive) throw new NotFoundException(NOT_FOUND);
        return byDomain;
      }
    }

    const byDefault = await db.company.findFirst({ where: { isDefault: true }, orderBy: { createdAt: 'asc' }, omit: WITHOUT_LOGO });
    if (!byDefault?.isActive) throw new NotFoundException(NOT_FOUND);
    return byDefault;
  }

  findById(id: string): Promise<CompanyRecord | null> {
    return this.prisma.unscoped.company.findUnique({ where: { id }, omit: WITHOUT_LOGO });
  }
}
