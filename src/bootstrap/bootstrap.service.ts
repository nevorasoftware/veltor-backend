import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AmortizationMethod, DayCountBasis, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

/**
 * Inicialización mínima al arrancar:
 *  - Garantiza un superadministrador (BOOTSTRAP_ADMIN_*) si no existe ningún usuario de personal.
 *  - Garantiza un producto financiero activo, parametrizado por variables de entorno.
 * No crea datos de demostración (vehículos, clientes, créditos ni prospectos).
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    try {
      await this.ensureAdmin();
      await this.ensureFinancingProduct();
    } catch (err: any) {
      this.logger.error(`No se pudo completar la inicialización: ${err?.message || err}`);
    }
  }

  private async ensureAdmin() {
    const staffCount = await this.prisma.user.count({ where: { role: { not: UserRole.CUSTOMER } } });
    if (staffCount > 0) return;

    // Sin correo configurado se usa uno por defecto; la contraseña siempre es aleatoria en ese caso
    const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@veltor.app').toLowerCase().trim();

    let password = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
    const generated = password.length < 10;
    if (generated) password = AuthService.generateTemporaryPassword();

    await this.prisma.user.create({
      data: {
        email,
        fullName: process.env.BOOTSTRAP_ADMIN_NAME || 'Administrador',
        role: UserRole.SUPERADMIN,
        passwordHash: await argon2.hash(password),
        isActive: true,
        mustChangePass: true,
      },
    });

    this.logger.warn(`Superadministrador inicial creado: ${email}`);
    if (generated) {
      this.logger.warn(`Contraseña temporal generada (cámbiala al ingresar): ${password}`);
    }
  }

  private async ensureFinancingProduct() {
    const active = await this.prisma.financingProduct.count({ where: { isActive: true } });
    if (active > 0) return;

    const num = (name: string, fallback: number) => {
      const v = Number(process.env[name]);
      return Number.isFinite(v) && v > 0 ? v : fallback;
    };
    const defaultRate = num('PRODUCT_DEFAULT_MONTHLY_RATE', 0.015);

    await this.prisma.financingProduct.upsert({
      where: { code: 'PROD-AUTO-ESTANDAR' },
      update: { isActive: true },
      create: {
        code: 'PROD-AUTO-ESTANDAR',
        name: process.env.PRODUCT_FINANCING_NAME || 'Crédito Vehicular Estándar',
        minMonthlyRate: num('PRODUCT_MIN_MONTHLY_RATE', Math.min(0.012, defaultRate)),
        maxMonthlyRate: num('PRODUCT_MAX_MONTHLY_RATE', Math.max(0.022, defaultRate)),
        defaultMonthlyRate: defaultRate,
        minTermMonths: num('PRODUCT_MIN_TERM_MONTHS', 12),
        maxTermMonths: num('PRODUCT_MAX_TERM_MONTHS', 72),
        minDownPercent: num('PRODUCT_MIN_DOWN_PERCENT', 15),
        dayCountBasis: DayCountBasis.D30_360,
        method: AmortizationMethod.FRENCH,
        graceDays: num('PRODUCT_GRACE_DAYS', 5),
        lateRateMonthly: num('PRODUCT_LATE_MONTHLY_RATE', 0.03),
        isActive: true,
      },
    });
    this.logger.log('Producto financiero por defecto configurado.');
  }
}
