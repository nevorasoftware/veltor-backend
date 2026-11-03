import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { platformAccessMail } from '../mail/templates';
import { TenantContext } from '../tenant/tenant-context';

/** Único superadministrador de la plataforma (contrato multiempresa) */
export const PLATFORM_SUPERADMIN_EMAIL = 'softwarenevora@gmail.com';

/**
 * Inicialización al arrancar (idempotente). NO crea empresas, productos ni datos de ejemplo (fase 2, punto 6):
 *  - Garantiza el superadministrador de plataforma softwarenevora@gmail.com (companyId = null). Si hay que
 *    crearlo, usa BOOTSTRAP_SUPERADMIN_PASSWORD o genera una contraseña temporal que se envía POR CORREO a esa
 *    cuenta (y queda en el log como respaldo si el correo falla).
 *  - Cualquier otro SUPERADMIN pasa a ADMIN (de la empresa por defecto, si el usuario no tiene empresa).
 * Todas las consultas son de plataforma: usan `prisma.unscoped`.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.ensureSingleSuperadmin();
      await this.ensureSuperadmin();
    } catch (err: any) {
      this.logger.error(`No se pudo completar la inicialización: ${err?.message || err}`);
    }
    this.warnEphemeralStorage();
  }

  /** Solo softwarenevora@gmail.com es SUPERADMIN; los demás pasan a ADMIN de su empresa. */
  private async ensureSingleSuperadmin() {
    const db = this.prisma.unscoped;
    const others = await db.user.findMany({
      where: { role: UserRole.SUPERADMIN, email: { not: PLATFORM_SUPERADMIN_EMAIL } },
      select: { id: true, companyId: true },
    });
    if (!others.length) return;
    const fallback = await db.company.findFirst({ where: { isDefault: true }, select: { id: true } });
    for (const u of others) {
      const companyId = u.companyId ?? fallback?.id;
      if (!companyId) {
        await db.user.update({ where: { id: u.id }, data: { role: UserRole.ADMIN, isActive: false } });
        this.logger.warn(`Usuario ${u.id}: SUPERADMIN sin empresa; se desactivó como ADMIN (no hay empresa por defecto).`);
      } else {
        await db.user.update({ where: { id: u.id }, data: { role: UserRole.ADMIN, companyId } });
      }
    }
    this.logger.warn(`${others.length} superadministrador(es) adicional(es) pasaron a ADMIN.`);
  }

  private async ensureSuperadmin() {
    const db = this.prisma.unscoped;
    const existing = await db.user.findUnique({ where: { email: PLATFORM_SUPERADMIN_EMAIL } });
    if (existing) {
      if (existing.role !== UserRole.SUPERADMIN || existing.companyId !== null || !existing.isActive) {
        await db.user.update({
          where: { id: existing.id },
          data: { role: UserRole.SUPERADMIN, companyId: null, customerId: null, isActive: true },
        });
        this.logger.warn(`${PLATFORM_SUPERADMIN_EMAIL} quedó como superadministrador de plataforma.`);
      }
      return;
    }

    let password = process.env.BOOTSTRAP_SUPERADMIN_PASSWORD || '';
    const generated = password.length < 10;
    if (generated) password = AuthService.generateTemporaryPassword();

    await db.user.create({
      data: {
        email: PLATFORM_SUPERADMIN_EMAIL,
        fullName: process.env.BOOTSTRAP_SUPERADMIN_NAME || 'Nevora Software',
        role: UserRole.SUPERADMIN,
        companyId: null,
        passwordHash: await argon2.hash(password),
        isActive: true,
        mustChangePass: true,
      },
    });
    this.logger.warn(`Superadministrador de plataforma creado: ${PLATFORM_SUPERADMIN_EMAIL}`);
    if (!generated) return;

    // La contraseña temporal se entrega por correo; el log es solo el respaldo si el correo falla
    const result = await TenantContext.run(null, () =>
      this.mail.send({
        to: PLATFORM_SUPERADMIN_EMAIL,
        template: 'platform.superadmin-access',
        ...platformAccessMail({ email: PLATFORM_SUPERADMIN_EMAIL, temporaryPassword: password }),
      }),
    );
    if (result.status === 'SENT') {
      this.logger.warn(`Contraseña temporal enviada por correo a ${PLATFORM_SUPERADMIN_EMAIL}.`);
    } else {
      this.logger.warn(`No se pudo enviar el correo (${result.error}). Contraseña temporal (cámbiala al ingresar): ${password}`);
    }
  }

  /** Sin Google Drive, los documentos y fotos van al disco del contenedor, que se pierde al redeplegar. */
  private warnEphemeralStorage() {
    if (process.env.NODE_ENV === 'production' && process.env.STORAGE_DRIVER !== 'gdrive') {
      this.logger.error(
        '¡ATENCIÓN! NODE_ENV=production sin STORAGE_DRIVER=gdrive: los documentos y fotos se guardan en el disco ' +
          'efímero del contenedor y se PERDERÁN al reiniciar o redeplegar. Configure Google Drive.',
      );
    }
  }
}
