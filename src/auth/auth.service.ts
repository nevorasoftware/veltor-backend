import { Injectable, UnauthorizedException, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as argon2 from 'argon2';
import { UserRole } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { passwordResetMail, siteLink } from '../mail/templates';
import { TenantContext } from '../tenant/tenant-context';
import { toCompanyInfo } from '../tenant/tenant-resolver.service';

/** Vigencia del enlace de recuperación */
const RESET_TTL_MINUTES = 60;
/** En la BD solo se guarda el hash del token: una fuga de la tabla no permite restablecer contraseñas */
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const NEUTRAL_RESET_MESSAGE =
  'Si el correo está registrado, te enviamos un enlace para restablecer la contraseña. Revisa tu bandeja de entrada.';

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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mail: MailService,
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

  /**
   * Recuperación de contraseña: siempre responde lo mismo (no revela si el correo existe).
   * Envía un enlace de un solo uso que vence en 1 hora; en la BD queda solo el hash del token.
   * Aplica a todos los usuarios: superadmin, personal y clientes del portal.
   */
  async forgotPassword(emailRaw: string) {
    const email = emailRaw.toLowerCase().trim();
    try {
      const user = await this.prisma.unscoped.user.findUnique({ where: { email } });
      if (!user || !user.isActive) return { message: NEUTRAL_RESET_MESSAGE };

      const company = user.companyId
        ? await this.prisma.unscoped.company.findUnique({ where: { id: user.companyId }, omit: { logoData: true } })
        : null;
      if (user.companyId && !company?.isActive) return { message: NEUTRAL_RESET_MESSAGE };

      const token = randomBytes(32).toString('hex');
      await this.prisma.unscoped.user.update({
        where: { id: user.id },
        data: { resetToken: hashToken(token), resetExpires: new Date(Date.now() + RESET_TTL_MINUTES * 60_000) },
      });

      // El correo sale con la marca de la empresa del usuario (o de la plataforma para el superadmin)
      const send = () =>
        this.mail.send({
          to: user.email,
          template: 'auth.password-reset',
          ...passwordResetMail({ fullName: user.fullName, url: siteLink('/restablecer', { token }), minutes: RESET_TTL_MINUTES }),
        });
      const result = company ? await TenantContext.run(company.id, send, toCompanyInfo(company)) : await TenantContext.run(null, send);
      if (result.status !== 'SENT') this.logger.warn(`No se pudo enviar la recuperación de contraseña a ${email}: ${result.error}`);
    } catch (err: any) {
      this.logger.error(`Recuperación de contraseña para ${email}: ${err?.message || err}`);
    }
    return { message: NEUTRAL_RESET_MESSAGE };
  }

  async resetPassword(token: string, newPassword: string) {
    const invalid = new BadRequestException('El enlace no es válido o ya venció. Solicita uno nuevo.');
    if (!/^[a-f0-9]{64}$/.test(token || '')) throw invalid;
    const user = await this.prisma.unscoped.user.findUnique({ where: { resetToken: hashToken(token) } });
    if (!user || !user.isActive || !user.resetExpires || user.resetExpires.getTime() < Date.now()) throw invalid;

    await this.prisma.unscoped.user.update({
      where: { id: user.id },
      data: { passwordHash: await argon2.hash(newPassword), resetToken: null, resetExpires: null, mustChangePass: false },
    });
    this.logger.log(`Contraseña restablecida para ${user.email}`);
    return { success: true, message: 'Tu contraseña se actualizó. Ya puedes iniciar sesión.' };
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
