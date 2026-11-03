import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantCompanyInfo, TenantContext } from './tenant-context';

/** Campos que el JwtAuthGuard deja en la petición con la empresa resuelta. */
export interface TenantRequest {
  tenantCompanyId?: string | null;
  tenantCompany?: TenantCompanyInfo;
}

/**
 * Ejecuta el controlador (pipes incluidos) dentro de TenantContext con la empresa que resolvió el
 * JwtAuthGuard. Sin empresa (rutas de plataforma o sin tenant), el contexto queda en null y
 * cualquier consulta a un modelo con companyId falla.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<TenantRequest>();
    const companyId = req.tenantCompanyId ?? null;

    return new Observable((subscriber) => {
      const subscription = TenantContext.run(companyId, () => next.handle().subscribe(subscriber), req.tenantCompany);
      return () => subscription.unsubscribe();
    });
  }
}
