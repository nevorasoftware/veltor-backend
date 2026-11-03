/**
 * Pruebas unitarias de la extensión de Prisma multiempresa (sin BD).
 * Contrato: docs/MULTITENANT-CONTRATO.md > Backend > "Extensión de Prisma".
 */
import { PrismaClient } from '@prisma/client';
import { scopeArgs, TENANT_MODELS, tenantExtension } from './prisma-tenant.extension';
import { TenantContext, MissingTenantError } from './tenant-context';

const CID = '11111111-1111-4111-8111-111111111111';

// Modelos de negocio que el contrato exige con companyId
const CONTRACT_MODELS = [
  'Customer', 'CustomerDocument', 'Vehicle', 'VehicleImage', 'VehicleStatusHistory', 'Lead',
  'FinancingProduct', 'FinancingApplication', 'CreditEvaluation', 'CreditApproval', 'Loan',
  'LoanContractVersion', 'AmortizationInstallment', 'PaymentTransaction', 'PaymentAllocation',
  'PaymentReversal', 'AccountStatement', 'CollectionCase', 'CollectionActivity', 'NotificationLog',
  'AuditLog', 'SystemSetting', 'Expense',
];

describe('TENANT_MODELS', () => {
  it('incluye todos los modelos de negocio del contrato', () => {
    const missing = CONTRACT_MODELS.filter((m) => !TENANT_MODELS.has(m));
    expect(missing).toEqual([]);
  });

  it('no incluye Company', () => {
    expect(TENANT_MODELS.has('Company')).toBe(false);
  });
});

describe('scopeArgs: filtros (where)', () => {
  const READS = ['findMany', 'findFirst', 'findFirstOrThrow', 'findUnique', 'findUniqueOrThrow', 'count', 'aggregate', 'groupBy'];
  const WRITES = ['update', 'updateMany', 'delete', 'deleteMany'];

  it.each([...READS, ...WRITES])('%s inyecta companyId en where', (op) => {
    const args: any = op === 'groupBy' ? { by: ['status'], where: { status: 'ACTIVE' } } : { where: { status: 'ACTIVE' } };
    if (op === 'update' || op === 'updateMany') args.data = { status: 'X' };
    const out: any = scopeArgs('Loan', op, args, CID);
    expect(out.where.companyId).toBe(CID);
    expect(out.where.status).toBe('ACTIVE'); // conserva el filtro original
  });

  it.each(['findMany', 'count', 'deleteMany', 'updateMany'])('%s sin where agrega where con companyId', (op) => {
    const args: any = op === 'updateMany' ? { data: { status: 'X' } } : {};
    const out: any = scopeArgs('Customer', op, op === 'findMany' || op === 'count' ? undefined : args, CID);
    expect(out.where.companyId).toBe(CID);
  });

  it('findUnique por id también queda filtrado por empresa (no se puede leer otra empresa por ID)', () => {
    const out: any = scopeArgs('Customer', 'findUnique', { where: { id: 'abc' } }, CID);
    expect(out.where).toEqual(expect.objectContaining({ id: 'abc', companyId: CID }));
  });

  it('no permite sobrescribir companyId desde el where del llamador', () => {
    const out: any = scopeArgs('Customer', 'findMany', { where: { companyId: 'OTRA' } }, CID);
    // o se reemplaza por el del contexto o se combina con AND; nunca debe quedar solo 'OTRA'
    const s = JSON.stringify(out.where);
    expect(s).toContain(CID);
  });

  it('no modifica los argumentos de entrada (sin mutación)', () => {
    const args = { where: { id: 'abc' } };
    scopeArgs('Customer', 'findFirst', args, CID);
    expect(args).toEqual({ where: { id: 'abc' } });
  });
});

describe('scopeArgs: datos (data)', () => {
  it('create inyecta companyId en data', () => {
    const out: any = scopeArgs('Customer', 'create', { data: { fullName: 'X' } }, CID);
    expect(out.data.companyId ?? out.data.company?.connect?.id).toBe(CID);
    expect(out.data.fullName).toBe('X');
  });

  it('createMany inyecta companyId en cada fila', () => {
    const out: any = scopeArgs('AmortizationInstallment', 'createMany', { data: [{ number: 1 }, { number: 2 }] }, CID);
    expect(out.data).toHaveLength(2);
    for (const row of out.data) expect(row.companyId).toBe(CID);
  });

  it('createMany con un objeto (no arreglo) también se marca', () => {
    const out: any = scopeArgs('Expense', 'createMany', { data: { concept: 'x' } }, CID);
    const rows = Array.isArray(out.data) ? out.data : [out.data];
    for (const row of rows) expect(row.companyId).toBe(CID);
  });

  it('upsert inyecta companyId en where y en create', () => {
    const out: any = scopeArgs('SystemSetting', 'upsert', {
      where: { companyId_key: { companyId: CID, key: 'K' } },
      create: { key: 'K', value: '1' },
      update: { value: '1' },
    }, CID);
    expect(out.create.companyId ?? out.create.company?.connect?.id).toBe(CID);
    expect(JSON.stringify(out.where)).toContain(CID);
  });

  it('creates anidados (crédito con cuotas y versión de contrato) reciben companyId', () => {
    const out: any = scopeArgs('Loan', 'create', {
      data: {
        code: 'CRE-1',
        installments: { create: [{ number: 1 }, { number: 2 }] },
        contractVersions: { create: { versionIndex: 0 } },
      },
    }, CID);
    const nested = JSON.stringify(out.data);
    for (const i of out.data.installments.create) expect(i.companyId ?? i.company?.connect?.id).toBe(CID);
    const cv = out.data.contractVersions.create;
    expect(cv.companyId ?? cv.company?.connect?.id).toBe(CID);
    expect(nested).toContain(CID);
  });

  it('createMany anidado (pago con asignaciones) recibe companyId', () => {
    const out: any = scopeArgs('PaymentTransaction', 'create', {
      data: { code: 'PAG-1', allocations: { createMany: { data: [{ concept: 'INTEREST' }, { concept: 'PRINCIPAL' }] } } },
    }, CID);
    for (const a of out.data.allocations.createMany.data) expect(a.companyId).toBe(CID);
  });

  it('un modelo fuera de TENANT_MODELS no se toca', () => {
    const args = { where: { slug: 'x' } };
    const out: any = scopeArgs('Company', 'findUnique', args, CID);
    expect(out).toEqual(args);
  });
});

describe('TenantContext', () => {
  it('sin contexto, companyId() es undefined y requireCompanyId() lanza MissingTenantError', () => {
    expect(TenantContext.companyId()).toBeUndefined();
    expect(() => TenantContext.requireCompanyId()).toThrow(MissingTenantError);
  });

  it('run() expone el companyId dentro y lo limpia al salir', async () => {
    await TenantContext.run(CID, async () => {
      await new Promise((r) => setTimeout(r, 5)); // sobrevive a un salto asíncrono
      expect(TenantContext.companyId()).toBe(CID);
      expect(TenantContext.requireCompanyId()).toBe(CID);
    });
    expect(TenantContext.companyId()).toBeUndefined();
  });

  it('contextos concurrentes no se mezclan', async () => {
    const seen: string[] = [];
    await Promise.all(
      ['A', 'B', 'C'].map((id, i) =>
        TenantContext.run(id, async () => {
          await new Promise((r) => setTimeout(r, 15 - i * 5));
          seen.push(`${id}=${TenantContext.companyId()}`);
        }),
      ),
    );
    expect(seen.sort()).toEqual(['A=A', 'B=B', 'C=C']);
  });

  it('contextos anidados restauran el externo', () => {
    TenantContext.run('EXT', () => {
      TenantContext.run('INT', () => expect(TenantContext.companyId()).toBe('INT'));
      expect(TenantContext.companyId()).toBe('EXT');
    });
  });
});

describe('tenantExtension sobre un PrismaClient real (sin BD)', () => {
  // URL inválida a propósito: si la extensión deja pasar la consulta, el error sería de conexión, no de tenant.
  const base = new PrismaClient({ datasources: { db: { url: 'postgresql://x:y@127.0.0.1:1/none' } } });
  const ext: any = typeof tenantExtension === 'function' && (tenantExtension as any).length === 0
    ? base.$extends((tenantExtension as any)())
    : base.$extends(tenantExtension as any);

  afterAll(() => base.$disconnect());

  it.each([
    ['customer', 'findMany', {}],
    ['loan', 'findUnique', { where: { id: 'x' } }],
    ['expense', 'create', { data: { concept: 'x' } }],
    ['systemSetting', 'deleteMany', {}],
    ['amortizationInstallment', 'count', {}],
  ])('sin contexto, %s.%s lanza MissingTenantError', async (model, op, args) => {
    await expect(ext[model][op](args)).rejects.toBeInstanceOf(MissingTenantError);
  });

  it('la extensión no exige contexto para Company', async () => {
    const err = await ext.company.findMany({}).catch((e: any) => e);
    expect(err).not.toBeInstanceOf(MissingTenantError);
  }, 20_000);
});
