import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CompaniesService } from '../companies/companies.service';

/** Único superadministrador de la plataforma (contrato multiempresa) */
export const PLATFORM_SUPERADMIN_EMAIL = 'softwarenevora@gmail.com';

/**
 * Inicialización mínima al arrancar (idempotente):
 *  - Garantiza la empresa por defecto (y su producto financiero si la empresa no tiene ninguno).
 *  - Garantiza el superadministrador de plataforma softwarenevora@gmail.com (companyId = null).
 *    Cualquier otro SUPERADMIN pasa a ADMIN de la empresa por defecto.
 * Los productos financieros de las demás empresas se crean al crear la empresa, no al arrancar.
 * No crea datos de demostración. Todas las consultas son de plataforma: usan `prisma.unscoped`.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
  ) {}

  async onApplicationBootstrap() {
    try {
      const company = await this.companies.ensureDefaultCompany();
      await this.companies.ensureProductFor(company.id);
      await this.ensureSuperadmin(company.id);
    } catch (err: any) {
      this.logger.error(`No se pudo completar la inicialización: ${err?.message || err}`);
    }
    this.warnEphemeralStorage();
  }

  private async ensureSuperadmin(defaultCompanyId: string) {
    const db = this.prisma.unscoped;

    const demoted = await db.user.updateMany({
      where: { role: UserRole.SUPERADMIN, email: { not: PLATFORM_SUPERADMIN_EMAIL } },
      data: { role: UserRole.ADMIN },
    });
    if (demoted.count) this.logger.warn(`${demoted.count} superadministrador(es) adicional(es) pasaron a ADMIN.`);
    await db.user.updateMany({
      where: { companyId: null, email: { not: PLATFORM_SUPERADMIN_EMAIL } },
      data: { companyId: defaultCompanyId },
    });

    const existing = await db.user.findUnique({ where: { email: PLATFORM_SUPERADMIN_EMAIL } });
    if (existing) {
      if (existing.role !== UserRole.SUPERADMIN || existing.companyId !== null || !existing.isActive) {
        await db.user.update({
          where: { id: existing.id },
          data: { role: UserRole.SUPERADMIN, companyId: null, isActive: true },
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
    if (generated) {
      this.logger.warn(`Contraseña temporal generada (cámbiala al ingresar): ${password}`);
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
