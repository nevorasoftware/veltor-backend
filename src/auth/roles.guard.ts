import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.role) {
      throw new ForbiddenException('Acceso no autorizado: credenciales requeridas.');
    }

    // SUPERADMIN tiene acceso a todas las operaciones
    if (user.role === UserRole.SUPERADMIN) return true;

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Sin @Roles explícito el endpoint es de uso interno: cualquier rol de personal, nunca un cliente.
    if (!requiredRoles || requiredRoles.length === 0) {
      if (user.role === UserRole.CUSTOMER) {
        throw new ForbiddenException('Acceso denegado: operación reservada al personal autorizado.');
      }
      return true;
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException(`Acceso denegado: se requiere uno de los siguientes roles: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}
