import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { EventEmitter } from 'events';
import { TenantContext } from '../tenant/tenant-context';

/** Eventos de negocio que otros módulos (p. ej. notificaciones) escuchan sin acoplarse al emisor. */
export interface DomainEventMap {
  /** silent: carga inicial (no se avisa al prospecto ni a administración) */
  'lead.created': { leadId: string; silent?: boolean };
  /** silent: carga inicial de un crédito ya en curso (no se envían correos; Drive sí se archiva) */
  'loan.activated': { loanId: string; silent?: boolean };
  /** silent: pago histórico de carga inicial (sin correos) */
  'payment.registered': { paymentId: string; silent?: boolean };
  /** El cliente completó sus datos con el enlace de registro (se avisa a administración) */
  'customer.registered': { customerId: string };
}

type EventName = keyof DomainEventMap;

@Injectable()
export class DomainEvents {
  private readonly logger = new Logger(DomainEvents.name);
  private readonly emitter = new EventEmitter();

  /**
   * Se despacha fuera de la petición actual: un error del oyente nunca afecta al emisor.
   * Los oyentes corren con la misma empresa (TenantContext) que el emisor.
   */
  emit<K extends EventName>(event: K, payload: DomainEventMap[K]) {
    const tenant = TenantContext.store();
    setImmediate(() => TenantContext.runWith(tenant, () => this.emitter.emit(event, payload)));
  }

  on<K extends EventName>(event: K, handler: (payload: DomainEventMap[K]) => unknown) {
    this.emitter.on(event, (payload: DomainEventMap[K]) => {
      Promise.resolve()
        .then(() => handler(payload))
        .catch((err) => this.logger.error(`Error procesando el evento ${event}: ${err?.message || err}`));
    });
  }
}

@Global()
@Module({
  providers: [DomainEvents],
  exports: [DomainEvents],
})
export class DomainEventsModule {}
