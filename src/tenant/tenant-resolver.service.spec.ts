/**
 * Pruebas unitarias de la resolución pública de empresa (sin BD).
 * Orden del contrato: X-Tenant (slug) -> Host/Origin contra Company.domains -> isDefault. Inactiva -> 404.
 */
import { NotFoundException } from '@nestjs/common';
import { TenantResolverService } from './tenant-resolver.service';

type Co = { id: string; slug: string; domains: string[]; isDefault: boolean; isActive: boolean; name: string };

const COMPANIES: Co[] = [
  { id: 'c-veltor', slug: 'veltor', domains: ['veltor.app', 'www.veltor.app'], isDefault: true, isActive: true, name: 'VELTOR' },
  { id: 'c-acme', slug: 'acme', domains: ['autos.acme.com'], isDefault: false, isActive: true, name: 'ACME' },
  { id: 'c-off', slug: 'apagada', domains: ['apagada.com'], isDefault: false, isActive: false, name: 'Apagada' },
];

/** Evalúa un `where` de Prisma sencillo sobre un objeto en memoria. */
function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, cond]: [string, any]) => {
    if (k === 'AND') return (cond as any[]).every((w) => matches(row, w));
    if (k === 'OR') return (cond as any[]).some((w) => matches(row, w));
    if (k === 'NOT') return !matches(row, cond);
    const v = row[k];
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('has' in cond) return Array.isArray(v) && v.includes(cond.has);
      if ('hasSome' in cond) return Array.isArray(v) && cond.hasSome.some((x: any) => v.includes(x));
      if ('equals' in cond) {
        return cond.mode === 'insensitive' ? String(v).toLowerCase() === String(cond.equals).toLowerCase() : v === cond.equals;
      }
      if ('in' in cond) return cond.in.includes(v);
      if ('not' in cond) return v !== cond.not;
      return false;
    }
    return v === cond;
  });
}

function fakePrisma(rows: Co[]) {
  const company = {
    findUnique: jest.fn(async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null),
    findUniqueOrThrow: jest.fn(async ({ where }: any) => {
      const r = rows.find((x) => matches(x, where));
      if (!r) throw Object.assign(new Error('not found'), { code: 'P2025' });
      return r;
    }),
    findFirst: jest.fn(async ({ where }: any = {}) => rows.find((r) => matches(r, where)) ?? null),
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where))),
  };
  const client: any = { company };
  client.unscoped = client;
  return client;
}

describe('TenantResolverService.resolvePublic', () => {
  let svc: TenantResolverService;
  beforeEach(() => {
    svc = new (TenantResolverService as any)(fakePrisma(COMPANIES));
  });

  it('X-Tenant (slug) tiene prioridad sobre Host y Origin', async () => {
    const c = await svc.resolvePublic({ slug: 'acme', host: 'veltor.app', origin: 'https://veltor.app' });
    expect(c.id).toBe('c-acme');
  });

  it('resuelve por Host contra domains', async () => {
    expect((await svc.resolvePublic({ host: 'autos.acme.com' })).id).toBe('c-acme');
  });

  it('ignora el puerto en Host', async () => {
    expect((await svc.resolvePublic({ host: 'autos.acme.com:443' })).id).toBe('c-acme');
  });

  it('resuelve por Origin (URL completa) cuando el Host no coincide', async () => {
    expect((await svc.resolvePublic({ host: 'api.railway.internal', origin: 'https://autos.acme.com' })).id).toBe('c-acme');
  });

  it('Host en mayúsculas también resuelve', async () => {
    expect((await svc.resolvePublic({ host: 'AUTOS.ACME.COM' })).id).toBe('c-acme');
  });

  it('sin pistas usa la empresa isDefault', async () => {
    expect((await svc.resolvePublic({})).id).toBe('c-veltor');
  });

  it('un Host desconocido cae en la empresa por defecto', async () => {
    expect((await svc.resolvePublic({ host: 'localhost:5173' })).id).toBe('c-veltor');
  });

  it('slug inexistente responde 404 (no cae en la empresa por defecto)', async () => {
    await expect(svc.resolvePublic({ slug: 'no-existe' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('empresa inactiva por slug responde 404', async () => {
    await expect(svc.resolvePublic({ slug: 'apagada' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('empresa inactiva por dominio responde 404', async () => {
    await expect(svc.resolvePublic({ host: 'apagada.com' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('si la empresa por defecto está inactiva y no hay pistas, responde 404', async () => {
    const rows = COMPANIES.map((c) => (c.isDefault ? { ...c, isActive: false } : c));
    const s = new (TenantResolverService as any)(fakePrisma(rows));
    await expect(s.resolvePublic({})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sin empresas en la BD responde 404', async () => {
    const s = new (TenantResolverService as any)(fakePrisma([]));
    await expect(s.resolvePublic({})).rejects.toBeInstanceOf(NotFoundException);
  });
});
