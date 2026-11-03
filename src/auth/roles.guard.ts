import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthUser } from './jwt-auth.guard';

/**
 * Autorización por rol:
 *  - Rutas de plataforma: las que declaran SUPERADMIN en @Roles sin ningún rol de empresa → solo SUPERADMIN.
 *  - SUPERADMIN sin X-Company-Id: solo rutas que incluyan SUPERADMIN en @Roles (plataforma y su propio perfil).
 *  - SUPERADMIN con X-Company-Id (soporte): actúa como ADMIN de esa empresa.
 *  - ADMIN: el rol más alto dentro de su empresa; conserva el acceso total que antes tenía el SUPERADMIN
 *    (todas las rutas de empresa), salvo las de plataforma.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    if (isPublic) return true;

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!user || !user.role) {
      throw new ForbiddenException('Acceso no autorizado: credenciales requeridas.');
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, targets) ?? [];
    const platformOnly = requiredRoles.length > 0 && requiredRoles.every((r) => r === UserRole.SUPERADMIN);

    let role = user.role;
    if (role === UserRole.SUPERADMIN) {
      if (requiredRoles.includes(UserRole.SUPERADMIN)) return true;
      if (!user.supportCompanyId) {
        throw new ForbiddenException(
          'El superadministrador solo accede a la plataforma. Para operar una empresa use "Entrar como soporte" (X-Company-Id).',
        );
      }
      role = UserRole.ADMIN;
    }

    if (platformOnly) {
      throw new ForbiddenException('Acceso denegado: operación reservada al superadministrador de la plataforma.');
    }

    // ADMIN: acceso total dentro de su empresa (equivale al SUPERADMIN anterior a multiempresa)
    if (role === UserRole.ADMIN) return true;

    // Sin @Roles explícito el endpoint es de uso interno: cualquier rol de personal, nunca un cliente.
    if (requiredRoles.length === 0) {
      if (role === UserRole.CUSTOMER) {
        throw new ForbiddenException('Acceso denegado: operación reservada al personal autorizado.');
      }
      return true;
    }

    if (!requiredRoles.includes(role)) {
      throw new ForbiddenException(`Acceso denegado: se requiere uno de los siguientes roles: ${requiredRoles.join(', ')}`);
    }
    return true;
  }
}
