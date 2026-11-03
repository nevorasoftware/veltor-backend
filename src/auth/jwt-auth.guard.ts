import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@prisma/client';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SKIP_TENANT_KEY } from '../tenant/skip-tenant.decorator';
import { TenantResolverService, toCompanyInfo } from '../tenant/tenant-resolver.service';
import { TenantRequest } from '../tenant/tenant.interceptor';
import type { JwtPayload } from './auth.service';

export const COMPANY_HEADER = 'x-company-id';
export const TENANT_HEADER = 'x-tenant';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  fullName: string;
  customerId?: string | null;
  /** Empresa del usuario (null para el superadmin) */
  companyId: string | null;
  /** Superadmin operando una empresa con X-Company-Id ("Entrar como soporte") */
  supportCompanyId?: string;
}

const header = (req: any, name: string): string | undefined => {
  const v = req.headers?.[name];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() ? s.trim() : undefined;
};

/**
 * Autentica (JWT) y resuelve la empresa de la petición:
 *  - autenticada: la empresa del token; el SUPERADMIN solo opera una empresa si envía X-Company-Id
 *    (sin el header queda sin empresa y solo puede usar /platform/*);
 *  - pública: la empresa del token si viene uno válido; si no, X-Tenant → Host/Origin → empresa por defecto.
 * La empresa se consulta en cada petición: si está inactiva se rechaza de inmediato.
 * El TenantInterceptor ejecuta luego el controlador dentro de TenantContext.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly tenants: TenantResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    const skipTenant = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_KEY, targets);
    const request = context.switchToHttp().getRequest<TenantRequest & Record<string, any>>();
    request.tenantCompanyId = null;

    if (isPublic) {
      if (skipTenant) return true;
      // Un usuario con sesión siempre ve su propia empresa, aunque la ruta sea pública
      const user = this.tryAuthenticate(request);
      if (user?.companyId) {
        await this.useCompany(request, user.companyId, false);
        request.user = user;
        return true;
      }
      // Superadmin en modo soporte: la empresa del X-Company-Id, aunque esté inactiva
      const supportCompanyId = user?.role === UserRole.SUPERADMIN ? header(request, COMPANY_HEADER) : undefined;
      if (user && supportCompanyId) {
        await this.useCompany(request, supportCompanyId, true);
        user.supportCompanyId = supportCompanyId;
        request.user = user;
        return true;
      }
      const company = await this.tenants.resolvePublic({
        slug: header(request, TENANT_HEADER),
        host: request.hostname,
        origin: header(request, 'origin') || header(request, 'referer'),
      });
      request.tenantCompanyId = company.id;
      request.tenantCompany = toCompanyInfo(company);
      return true;
    }

    const authHeader = request.headers?.authorization;
    if (!authHeader) throw new UnauthorizedException('Token de autenticación requerido');
    const [bearer, token] = String(authHeader).split(' ');
    if (bearer !== 'Bearer' || !token) throw new UnauthorizedException('Formato de autorización inválido');

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Token inválido o expirado');
    }
    const user = this.toUser(payload);
    if (!user) throw new UnauthorizedException('Su sesión es de una versión anterior. Inicie sesión nuevamente.');
    request.user = user;

    if (user.role === UserRole.SUPERADMIN) {
      const supportCompanyId = header(request, COMPANY_HEADER);
      if (supportCompanyId) {
        // Soporte: el superadmin puede entrar también a empresas inactivas
        await this.useCompany(request, supportCompanyId, true);
        user.supportCompanyId = supportCompanyId;
      }
      return true;
    }

    await this.useCompany(request, user.companyId!, false);
    return true;
  }

  /** Valida el payload. Los tokens emitidos antes de multiempresa no traen `companyId` y se rechazan. */
  private toUser(payload: JwtPayload | null): AuthUser | null {
    if (!payload?.sub || !payload.role || !('companyId' in payload)) return null;
    const companyId = payload.companyId ?? null;
    if (payload.role === UserRole.SUPERADMIN ? companyId !== null : !companyId) return null;
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      fullName: payload.fullName,
      customerId: payload.customerId,
      companyId,
    };
  }

  private tryAuthenticate(request: any): AuthUser | null {
    const [bearer, token] = String(request.headers?.authorization || '').split(' ');
    if (bearer !== 'Bearer' || !token) return null;
    try {
      return this.toUser(this.jwtService.verify<JwtPayload>(token));
    } catch {
      return null;
    }
  }

  private async useCompany(request: TenantRequest, companyId: string, allowInactive: boolean) {
    const company = await this.tenants.findById(companyId);
    if (!company) throw new NotFoundException('Empresa no encontrada');
    if (!company.isActive && !allowInactive) throw new ForbiddenException('La empresa está inactiva.');
    request.tenantCompanyId = company.id;
    request.tenantCompany = toCompanyInfo(company);
  }
}
