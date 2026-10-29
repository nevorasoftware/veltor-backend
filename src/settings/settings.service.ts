import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const RATE_KEY = 'PREFERENTIAL_MONTHLY_RATE';
const STAFF_EMAILS_KEY = 'NOTIFY_STAFF_EMAILS';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseEmails = (raw: string) => [
  ...new Set(
    raw
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  ),
];

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private activeProduct() {
    return this.prisma.financingProduct.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getPublicSettings() {
    const [setting, product] = await Promise.all([
      this.prisma.systemSetting.findUnique({ where: { key: RATE_KEY } }),
      this.activeProduct(),
    ]);

    let monthlyRate: number | null = product ? Number(product.defaultMonthlyRate) : null;
    const parsed = setting?.value ? parseFloat(setting.value) : NaN;
    if (!isNaN(parsed) && parsed > 0) monthlyRate = parsed;

    return {
      configured: monthlyRate !== null,
      preferentialMonthlyRate: monthlyRate,
      preferentialAnnualRate: monthlyRate !== null ? Number((monthlyRate * 12).toFixed(4)) : null,
      minMonthlyRate: product ? Number(product.minMonthlyRate) : null,
      maxMonthlyRate: product ? Number(product.maxMonthlyRate) : null,
      minDownPercent: product ? Number(product.minDownPercent) : null,
      minTermMonths: product?.minTermMonths ?? null,
      maxTermMonths: product?.maxTermMonths ?? null,
      defaultTermMonths: product ? Math.min(product.maxTermMonths, Math.max(product.minTermMonths, 36)) : null,
      productName: product?.name ?? null,
      updatedAt: setting?.updatedAt ?? product?.updatedAt ?? null,
    };
  }

  async updatePreferentialRate(monthlyRate: number, userId?: string) {
    const product = await this.activeProduct();
    if (!product) throw new BadRequestException('No hay un producto financiero activo configurado.');

    const updatedSetting = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.systemSetting.upsert({
        where: { key: RATE_KEY },
        update: { value: monthlyRate.toString(), isPublic: true },
        create: {
          key: RATE_KEY,
          value: monthlyRate.toString(),
          description: 'Tasa de interés preferencial mensual para el simulador y cotizaciones',
          isPublic: true,
        },
      });

      // Mantener el rango del producto coherente con la nueva tasa por defecto
      await tx.financingProduct.updateMany({
        where: { isActive: true },
        data: { defaultMonthlyRate: monthlyRate },
      });
      if (monthlyRate < Number(product.minMonthlyRate)) {
        await tx.financingProduct.updateMany({ where: { isActive: true }, data: { minMonthlyRate: monthlyRate } });
      }
      if (monthlyRate > Number(product.maxMonthlyRate)) {
        await tx.financingProduct.updateMany({ where: { isActive: true }, data: { maxMonthlyRate: monthlyRate } });
      }
      return saved;
    });

    this.logger.log(`Tasa preferencial actualizada a ${(monthlyRate * 100).toFixed(2)}% por usuario ${userId}`);

    return {
      success: true,
      preferentialMonthlyRate: monthlyRate,
      preferentialAnnualRate: Number((monthlyRate * 12).toFixed(4)),
      message: `Tasa preferencial actualizada a ${(monthlyRate * 100).toFixed(2)}% mensual (${(monthlyRate * 1200).toFixed(1)}% anual)`,
      updatedAt: updatedSetting.updatedAt,
    };
  }

  /** Correos del personal que reciben avisos (nuevo prospecto, crédito aprobado). Si no se han parametrizado, usa NOTIFY_STAFF_EMAILS. */
  async getStaffNotificationEmails(): Promise<string[]> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: STAFF_EMAILS_KEY } });
    return parseEmails(setting ? setting.value : process.env.NOTIFY_STAFF_EMAILS || '');
  }

  async getNotificationSettings() {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: STAFF_EMAILS_KEY } });
    return {
      staffEmails: await this.getStaffNotificationEmails(),
      source: setting ? 'database' : 'environment',
      updatedAt: setting?.updatedAt ?? null,
    };
  }

  async updateStaffNotificationEmails(emails: string[], userId?: string) {
    const clean = parseEmails(emails.join(','));
    const invalid = clean.filter((e) => !EMAIL_RE.test(e));
    if (invalid.length) throw new BadRequestException(`Correos inválidos: ${invalid.join(', ')}`);

    const saved = await this.prisma.systemSetting.upsert({
      where: { key: STAFF_EMAILS_KEY },
      update: { value: clean.join(',') },
      create: {
        key: STAFF_EMAILS_KEY,
        value: clean.join(','),
        description: 'Correos del personal que reciben avisos de nuevos prospectos y créditos aprobados',
        isPublic: false,
      },
    });

    this.logger.log(`Correos de notificación al personal actualizados (${clean.length}) por usuario ${userId}`);
    return {
      success: true,
      staffEmails: clean,
      source: 'database',
      message: clean.length
        ? `Se notificará a ${clean.length} correo(s) del personal.`
        : 'Sin correos configurados: el personal no recibirá avisos.',
      updatedAt: saved.updatedAt,
    };
  }
}
