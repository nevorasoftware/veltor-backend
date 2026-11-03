/**
 * Daemon de cobranza multiempresa: recorre las empresas activas y ejecuta la cobranza de cada una
 * dentro de su propio TenantContext, solo cuando son las 8:00 en la zona horaria de la empresa.
 */
import { NotificationsService, localHour } from './notifications.service';
import { TenantContext } from '../tenant/tenant-context';

const company = (id: string, slug: string, timezone: string) => ({
  id, slug, name: slug, timezone, isActive: true, locale: 'es-SV', currency: 'USD',
  primaryColor: '#000000', secondaryColor: '#000000', accentColor: '#000000', bankAccounts: [], domains: [],
});

function makeService(companies: any[], mailConfigured = true) {
  const svc: any = Object.create(NotificationsService.prototype);
  svc.logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  svc.mail = { isConfigured: () => mailConfigured };
  svc.prisma = { unscoped: { company: { findMany: jest.fn(async () => companies) } } };
  const seen: string[] = [];
  svc.sendPaymentReminders = jest.fn(async () => {
    seen.push(`${TenantContext.companyId()}|${TenantContext.company()?.timezone}`);
    return { checked: 1, reminders: 0, overdueNotices: 0, sent: 0 };
  });
  return { svc, seen };
}

describe('localHour', () => {
  it('convierte a la hora local de la zona', () => {
    const now = new Date('2026-11-03T14:00:00Z');
    expect(localHour('America/El_Salvador', now)).toBe(8); // UTC-6
    expect(localHour('America/Mexico_City', now)).toBe(8); // UTC-6 sin horario de verano
    expect(localHour('America/New_York', now)).toBe(9); // UTC-5 en noviembre
    expect(localHour('UTC', now)).toBe(14);
  });

  it('una zona inválida no rompe (usa la zona por defecto)', () => {
    expect(() => localHour('No/Existe', new Date())).not.toThrow();
  });
});

describe('NotificationsService.runDailyCollections', () => {
  const now = new Date('2026-11-03T14:00:00Z'); // 8:00 en El Salvador

  it('ejecuta la cobranza de cada empresa a las 8:00 locales y dentro de su propio contexto', async () => {
    const { svc, seen } = makeService([
      company('c1', 'sv', 'America/El_Salvador'),
      company('c2', 'ny', 'America/New_York'), // 9:00 -> no corre
      company('c3', 'gt', 'America/Guatemala'), // 8:00 -> corre
    ]);
    const res = await svc.runDailyCollections(now);
    expect(seen).toEqual(['c1|America/El_Salvador', 'c3|America/Guatemala']);
    expect(res.map((r: any) => r.company)).toEqual(['sv', 'gt']);
    expect(TenantContext.companyId()).toBeUndefined(); // no se filtra contexto fuera
  });

  it('solo consulta empresas activas', async () => {
    const { svc } = makeService([]);
    await svc.runDailyCollections(now);
    const args = svc.prisma.unscoped.company.findMany.mock.calls[0][0];
    expect(args.where).toEqual(expect.objectContaining({ isActive: true }));
  });

  it('un error en una empresa no detiene a las demás', async () => {
    const { svc, seen } = makeService([company('c1', 'a', 'America/El_Salvador'), company('c2', 'b', 'America/El_Salvador')]);
    const orig = svc.sendPaymentReminders;
    svc.sendPaymentReminders = jest.fn(async () => {
      if (TenantContext.companyId() === 'c1') throw new Error('falla');
      return orig();
    });
    const res = await svc.runDailyCollections(now);
    expect(res.map((r: any) => r.company)).toEqual(['b']);
    expect(seen).toEqual(['c2|America/El_Salvador']);
    expect(svc.logger.error).toHaveBeenCalled();
  });

  it('sin correo configurado no hace nada', async () => {
    const { svc } = makeService([company('c1', 'a', 'America/El_Salvador')], false);
    expect(await svc.runDailyCollections(now)).toEqual([]);
    expect(svc.sendPaymentReminders).not.toHaveBeenCalled();
  });

  it('sendPaymentReminders sin empresa en contexto lanza (no corre para todas las empresas mezcladas)', async () => {
    const svc: any = Object.create(NotificationsService.prototype);
    svc.mail = { isConfigured: () => true };
    await expect(svc.sendPaymentReminders()).rejects.toThrow();
  });
});
