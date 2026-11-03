import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { tenantExtension } from '../tenant/prisma-tenant.extension';

/** Nombres de los delegados de modelo (customer, loan, ...) */
const MODEL_DELEGATES = new Set(Prisma.dmmf.datamodel.models.map((m) => m.name.charAt(0).toLowerCase() + m.name.slice(1)));

/**
 * Cliente de Prisma con aislamiento por empresa.
 *
 * - `prisma.<modelo>` y `prisma.$transaction` pasan por la extensión de empresa (filtran e inyectan companyId
 *   según TenantContext y fallan si no hay contexto).
 * - `prisma.unscoped` es el cliente sin filtro: solo para plataforma, bootstrap, autenticación y tareas que
 *   recorren todas las empresas. Su uso debe ser explícito y justificado.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** Cliente sin filtro de empresa (bypass explícito). */
  readonly unscoped: PrismaClient;

  constructor() {
    super();
    this.unscoped = this;
    const base = this;
    const scoped = this.$extends(tenantExtension);
    return new Proxy(this, {
      get(target, prop) {
        if (prop === 'unscoped') return base;
        if (typeof prop === 'string' && MODEL_DELEGATES.has(prop)) return (scoped as any)[prop];
        // Enlazado al cliente extendido: así el `tx` de las transacciones interactivas también filtra por empresa
        if (prop === '$transaction') return scoped.$transaction.bind(scoped);
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
    } catch {
      console.warn('Advertencia: No se pudo conectar a PostgreSQL en inicio. La API continuará en modo seguro.');
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
