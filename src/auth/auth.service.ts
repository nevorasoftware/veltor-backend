import { Injectable, UnauthorizedException, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as argon2 from 'argon2';
import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  fullName: string;
  customerId?: string | null;
  /** Empresa del usuario; null solo para el SUPERADMIN de plataforma */
  companyId: string | null;
}

/**
 * El login es global (correo + contraseña) y la empresa sale del usuario, por eso este servicio usa
 * `prisma.unscoped`: el correo es único en toda la plataforma.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(email: string, pass: string) {
    const user = await this.prisma.unscoped.user.findUnique({
      where: { email: email.toLowerCase().trim() },
    });
    if (!user || !user.isActive) return null;

    const matches = await argon2.verify(user.passwordHash, pass);
    if (!matches) return null;

    return user;
  }

  async login(email: string, pass: string) {
    const user = await this.validateUser(email, pass);
    if (!user) {
      throw new UnauthorizedException('Correo electrónico o contraseña incorrectos.');
    }

    const isSuperadmin = user.role === UserRole.SUPERADMIN;
    const company =
      !isSuperadmin && user.companyId
        ? await this.prisma.unscoped.company.findUnique({
            where: { id: user.companyId },
            select: { id: true, slug: true, name: true, isActive: true },
          })
        : null;
    if (!isSuperadmin) {
      if (!company) throw new UnauthorizedException('Su usuario no está asociado a una empresa.');
      if (!company.isActive) {
        throw new ForbiddenException('La empresa está inactiva. Comuníquese con el administrador de la plataforma.');
      }
    }

    // Registrar último inicio de sesión
    await this.prisma.unscoped.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      customerId: user.customerId,
      companyId: company?.id ?? null,
    };

    const accessToken = this.jwtService.sign(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        customerId: user.customerId,
        companyId: payload.companyId,
        company: company ? { id: company.id, slug: company.slug, name: company.name } : null,
        mustChangePass: user.mustChangePass,
      },
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.unscoped.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        phone: true,
        customerId: true,
        companyId: true,
        company: { select: { id: true, slug: true, name: true } },
        mustChangePass: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return user;
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.unscoped.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new NotFoundException('Usuario no encontrado');

    const matches = await argon2.verify(user.passwordHash, currentPassword);
    if (!matches) throw new BadRequestException('La contraseña actual no es correcta.');
    if (currentPassword === newPassword) {
      throw new BadRequestException('La nueva contraseña debe ser distinta a la actual.');
    }

    await this.prisma.unscoped.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(newPassword), mustChangePass: false },
    });
    return { success: true, message: 'Contraseña actualizada exitosamente.' };
  }

  /** Genera una contraseña temporal legible para entregar al cliente (se exige cambiarla al ingresar). */
  static generateTemporaryPassword(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const bytes = randomBytes(12);
    let out = '';
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return out;
  }
}
