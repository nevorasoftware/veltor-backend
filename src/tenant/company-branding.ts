import type { PrismaClient } from '@prisma/client';
import { TenantContext } from './tenant-context';

/**
 * Marca de la empresa del contexto para correos y PDF. Todo sale de la BD (TenantContext); la única
 * leyenda fija es el crédito de la plataforma.
 */
export const PLATFORM_CREDIT = 'Desarrollado por Nevora Software';
/** Sitio web del desarrollador, enlazado en cada "Desarrollado por Nevora Software" */
export const PLATFORM_URL = 'https://nevorasoftware.com/';

/** Formatos de logo que se pueden incrustar en PDF (pdfkit) y en correos (Gmail/Outlook) */
export const RASTER_LOGO_MIMES = ['image/png', 'image/jpeg'];

const DEFAULT_LOCALE = 'es-SV';
const DEFAULT_CURRENCY = 'USD';

/** Nombre comercial de la empresa; sin contexto (no debería ocurrir) se firma como la plataforma */
export const brandName = () => TenantContext.company()?.name || 'Nevora Software';
export const brandLegalName = () => TenantContext.company()?.legalName || brandName();
export const brandTagline = () => TenantContext.company()?.tagline || '';
export const brandPrimary = () => TenantContext.company()?.primaryColor || '#0f172a';
export const brandAccent = () => TenantContext.company()?.accentColor || '#38bdf8';
export const brandHasRasterLogo = () => RASTER_LOGO_MIMES.includes(TenantContext.company()?.logoMime ?? '');

export function formatMoney(v: unknown): string {
  const c = TenantContext.company();
  const n = Number(v) || 0;
  try {
    return new Intl.NumberFormat(c?.locale || DEFAULT_LOCALE, { style: 'currency', currency: c?.currency || DEFAULT_CURRENCY }).format(n);
  } catch {
    return new Intl.NumberFormat(DEFAULT_LOCALE, { style: 'currency', currency: DEFAULT_CURRENCY }).format(n);
  }
}

/** Fecha de hoy (o la indicada) en el formato y la zona horaria de la empresa */
export function formatDate(d: Date = new Date()): string {
  const c = TenantContext.company();
  try {
    return d.toLocaleDateString(c?.locale || DEFAULT_LOCALE, { timeZone: c?.timezone || 'America/El_Salvador' });
  } catch {
    return d.toLocaleDateString(DEFAULT_LOCALE);
  }
}

/** Teléfono, correo y horario de atención de la empresa (solo los configurados) */
export function contactParts(): string[] {
  const c = TenantContext.company();
  return [c?.contactPhone && `Tel. ${c.contactPhone}`, c?.contactEmail, c?.contactHours].filter((x): x is string => !!x);
}

/** Canales de pago de la empresa (cuentas bancarias, WhatsApp y correo de pagos) */
export function paymentChannels(): { label: string; value: string }[] {
  const c = TenantContext.company();
  if (!c) return [];
  const rows = c.bankAccounts.map((a) => ({ label: a.bank, value: a.detail }));
  if (rows.length && c.bankAccountHolder) rows.push({ label: 'Titular', value: c.bankAccountHolder });
  if (c.paymentsWhatsapp) rows.push({ label: 'WhatsApp de pagos', value: c.paymentsWhatsapp });
  if (c.paymentsEmail) rows.push({ label: 'Correo de pagos', value: c.paymentsEmail });
  return rows;
}

/** Bytes del logo de la empresa del contexto si es PNG o JPEG (los únicos que se incrustan) */
export async function loadRasterLogo(db: Pick<PrismaClient, 'company'>): Promise<{ data: Buffer; mime: string } | null> {
  const companyId = TenantContext.companyId();
  if (!companyId || !brandHasRasterLogo()) return null;
  const row = await db.company.findUnique({ where: { id: companyId }, select: { logoData: true, logoMime: true } });
  if (!row?.logoData || !row.logoMime || !RASTER_LOGO_MIMES.includes(row.logoMime)) return null;
  return { data: Buffer.from(row.logoData), mime: row.logoMime };
}
