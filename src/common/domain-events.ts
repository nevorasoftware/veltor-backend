import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { EventEmitter } from 'events';

/** Eventos de negocio que otros módulos (p. ej. notificaciones) escuchan sin acoplarse al emisor. */
export interface DomainEventMap {
  'lead.created': { leadId: string };
  'loan.activated': { loanId: string };
  'payment.registered': { paymentId: string };
}

type EventName = keyof DomainEventMap;

@Injectable()
export class DomainEvents {
  private readonly logger = new Logger(DomainEvents.name);
  private readonly emitter = new EventEmitter();

  /** Se despacha fuera de la petición actual: un error del oyente nunca afecta al emisor. */
  emit<K extends EventName>(event: K, payload: DomainEventMap[K]) {
    setImmediate(() => this.emitter.emit(event, payload));
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
