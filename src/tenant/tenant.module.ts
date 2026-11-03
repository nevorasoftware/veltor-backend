import { ArgumentsHost, Catch, ExceptionFilter, ForbiddenException, Global, Logger, Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, BaseExceptionFilter } from '@nestjs/core';
import { MissingTenantError } from './tenant-context';
import { TenantInterceptor } from './tenant.interceptor';
import { TenantResolverService } from './tenant-resolver.service';

/** Una consulta sin contexto de empresa es un error de uso (p. ej. superadmin sin X-Company-Id): 403, no 500. */
@Catch(MissingTenantError)
export class MissingTenantFilter extends BaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('TenantContext');

  catch(exception: MissingTenantError, host: ArgumentsHost) {
    this.logger.warn(exception.message);
    super.catch(
      new ForbiddenException('Esta operación requiere una empresa. El superadministrador debe indicar X-Company-Id.'),
      host,
    );
  }
}

@Global()
@Module({
  providers: [
    TenantResolverService,
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    { provide: APP_FILTER, useClass: MissingTenantFilter },
  ],
  exports: [TenantResolverService],
})
export class TenantModule {}
