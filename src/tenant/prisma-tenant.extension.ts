import { Prisma } from '@prisma/client';
import { MissingTenantError, TenantContext } from './tenant-context';

/**
 * Extensión de Prisma que aísla los datos por empresa.
 *
 * En los modelos con `companyId`:
 *  - lecturas, conteos, agregados, update* y delete*: agrega `companyId` al `where`;
 *  - create, createMany, upsert: agrega `companyId` (o `company: { connect }`) al `data`,
 *    también en los `create` anidados de relaciones;
 *  - sin contexto de empresa lanza MissingTenantError. El bypass explícito es `prisma.unscoped`.
 */

interface RelationMeta {
  target: string;
  /** La relación guarda la FK en este modelo (to-one dueña de la FK) */
  ownsForeignKey: boolean;
}

interface ModelMeta {
  scoped: boolean;
  relations: Map<string, RelationMeta>;
}

const MODEL_META = new Map<string, ModelMeta>();
for (const model of Prisma.dmmf.datamodel.models) {
  const relations = new Map<string, RelationMeta>();
  for (const f of model.fields) {
    if (f.kind === 'object') {
      relations.set(f.name, { target: f.type, ownsForeignKey: (f.relationFromFields?.length ?? 0) > 0 });
    }
  }
  MODEL_META.set(model.name, {
    scoped: model.fields.some((f) => f.name === 'companyId' && f.kind === 'scalar'),
    relations,
  });
}

/** Modelos que llevan companyId (nombres de Prisma: Customer, Loan, ...). */
export const TENANT_MODELS: ReadonlySet<string> = new Set(
  [...MODEL_META.entries()].filter(([, m]) => m.scoped).map(([name]) => name),
);

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

const CREATE_MANY_OPERATIONS = new Set(['createMany', 'createManyAndReturn']);

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const each = <T>(v: T | T[], fn: (x: T) => T): T | T[] => (Array.isArray(v) ? v.map(fn) : fn(v));

/** ¿El `data` usa la forma "checked" (relaciones con connect) en lugar de las FK escalares? */
function usesRelationInput(meta: ModelMeta, data: Record<string, any>): boolean {
  for (const [name, rel] of meta.relations) {
    if (name !== 'company' && rel.ownsForeignKey && data[name] !== undefined) return true;
  }
  return false;
}

function scopeCreateData(model: string, data: Record<string, any>, companyId: string): Record<string, any> {
  const meta = MODEL_META.get(model);
  if (!meta || !isObject(data)) return data;
  const out: Record<string, any> = { ...data };
  if (meta.scoped) {
    delete out.companyId;
    delete out.company;
    if (usesRelationInput(meta, out)) out.company = { connect: { id: companyId } };
    else out.companyId = companyId;
  }
  return scopeNestedWrites(meta, out, companyId);
}

function scopeCreateManyItem(model: string, item: Record<string, any>, companyId: string) {
  return MODEL_META.get(model)?.scoped ? { ...item, companyId } : item;
}

/** Recorre las relaciones del `data` e inyecta companyId en los create anidados. */
function scopeNestedWrites(meta: ModelMeta, data: Record<string, any>, companyId: string): Record<string, any> {
  for (const [name, rel] of meta.relations) {
    const op = data[name];
    if (name === 'company' || !isObject(op)) continue;
    const target = rel.target;
    const targetMeta = MODEL_META.get(target)!;
    const nested: Record<string, any> = { ...op };

    if (nested.create !== undefined) {
      nested.create = each(nested.create, (c: any) => scopeCreateData(target, c, companyId));
    }
    if (isObject(nested.createMany) && nested.createMany.data !== undefined) {
      nested.createMany = {
        ...nested.createMany,
        data: each(nested.createMany.data, (c: any) => scopeCreateManyItem(target, c, companyId)),
      };
    }
    if (nested.connectOrCreate !== undefined) {
      nested.connectOrCreate = each(nested.connectOrCreate, (c: any) =>
        isObject(c) ? { ...c, create: scopeCreateData(target, c.create, companyId) } : c,
      );
    }
    if (nested.upsert !== undefined) {
      nested.upsert = each(nested.upsert, (u: any) =>
        isObject(u)
          ? {
              ...u,
              create: scopeCreateData(target, u.create, companyId),
              update: isObject(u.update) ? scopeNestedWrites(targetMeta, { ...u.update }, companyId) : u.update,
            }
          : u,
      );
    }
    if (nested.update !== undefined) {
      nested.update = each(nested.update, (u: any) => {
        if (!isObject(u)) return u;
        if (isObject(u.data) && 'where' in u) return { ...u, data: scopeNestedWrites(targetMeta, { ...u.data }, companyId) };
        return scopeNestedWrites(targetMeta, { ...u }, companyId);
      });
    }
    data[name] = nested;
  }
  return data;
}

/**
 * Devuelve los argumentos de la operación con el filtro/valor de empresa aplicado.
 * Función pura (no depende del contexto) para poder probarla de forma aislada.
 */
export function scopeArgs(model: string, operation: string, args: any, companyId: string): any {
  const meta = MODEL_META.get(model);
  if (!meta?.scoped) return args;
  const out: any = { ...(args ?? {}) };

  if (WHERE_OPERATIONS.has(operation) || operation === 'upsert') {
    out.where = { ...(out.where ?? {}), companyId };
  }
  if (operation === 'create') {
    out.data = scopeCreateData(model, out.data ?? {}, companyId);
  } else if (CREATE_MANY_OPERATIONS.has(operation)) {
    out.data = each(out.data ?? [], (d: any) => scopeCreateManyItem(model, d, companyId));
  } else if (operation === 'upsert') {
    out.create = scopeCreateData(model, out.create ?? {}, companyId);
    if (isObject(out.update)) out.update = scopeNestedWrites(meta, { ...out.update }, companyId);
  } else if ((operation === 'update' || operation === 'updateMany') && isObject(out.data)) {
    out.data = scopeNestedWrites(meta, { ...out.data }, companyId);
    // Un registro nunca cambia de empresa
    delete out.data.companyId;
    delete out.data.company;
  }
  return out;
}

export const tenantExtension = Prisma.defineExtension({
  name: 'tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args);
        const companyId = TenantContext.companyId();
        if (!companyId) throw new MissingTenantError(`${model}.${operation}`);
        return query(scopeArgs(model, operation, args, companyId));
      },
    },
  },
});
