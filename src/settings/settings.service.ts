import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const RATE_KEY = 'PREFERENTIAL_MONTHLY_RATE';

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
}
