import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getPublicSettings() {
    // 1. Buscar en system_settings
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'PREFERENTIAL_MONTHLY_RATE' },
    });

    let monthlyRate = 0.015; // 1.50% mensual por defecto

    if (setting?.value) {
      const parsed = parseFloat(setting.value);
      if (!isNaN(parsed) && parsed > 0) {
        monthlyRate = parsed;
      }
    } else {
      // Buscar en el producto estándar si existe
      const product = await this.prisma.financingProduct.findFirst({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      if (product) {
        monthlyRate = Number(product.defaultMonthlyRate);
      }
    }

    return {
      preferentialMonthlyRate: monthlyRate,
      preferentialAnnualRate: Number((monthlyRate * 12).toFixed(4)),
      minDownPercent: 15,
      defaultTermMonths: 36,
      productName: 'Crédito Vehicular Estándar VELTOR',
      updatedAt: setting?.updatedAt || new Date(),
    };
  }

  async updatePreferentialRate(monthlyRate: number, userId?: string) {
    if (monthlyRate <= 0 || monthlyRate > 0.10) {
      throw new Error('La tasa mensual debe estar entre 0.1% y 10.0% (ej. 0.0150 para 1.50%)');
    }

    // 1. Guardar en system_settings
    const updatedSetting = await this.prisma.systemSetting.upsert({
      where: { key: 'PREFERENTIAL_MONTHLY_RATE' },
      update: {
        value: monthlyRate.toString(),
        isPublic: true,
      },
      create: {
        key: 'PREFERENTIAL_MONTHLY_RATE',
        value: monthlyRate.toString(),
        description: 'Tasa de interés preferencial mensual para el simulador y cotizaciones VELTOR',
        isPublic: true,
      },
    });

    // 2. Actualizar productos financieros activos en el sistema
    await this.prisma.financingProduct.updateMany({
      where: { isActive: true },
      data: {
        defaultMonthlyRate: monthlyRate,
      },
    });

    this.logger.log(`Tasa de interés preferencial actualizada a ${(monthlyRate * 100).toFixed(2)}% por usuario ${userId || 'ADMIN'}`);

    return {
      success: true,
      preferentialMonthlyRate: monthlyRate,
      preferentialAnnualRate: Number((monthlyRate * 12).toFixed(4)),
      message: `Tasa preferencial actualizada exitosamente a ${(monthlyRate * 100).toFixed(2)}% mensual (${(monthlyRate * 1200).toFixed(1)}% anual)`,
      updatedAt: updatedSetting.updatedAt,
    };
  }
}
