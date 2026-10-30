import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const RATE_KEY = 'PREFERENTIAL_MONTHLY_RATE';
const STAFF_EMAILS_KEY = 'NOTIFY_STAFF_EMAILS';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Cobranza: recordatorios, gracia y mora
const COLLECTION_KEYS = {
  reminderDaysBefore: 'REMINDER_DAYS_BEFORE',
  overdueReminderEveryDays: 'OVERDUE_REMINDER_EVERY_DAYS',
  defaultPaymentDay: 'DEFAULT_PAYMENT_DAY',
  defaultLateFeeType: 'DEFAULT_LATE_FEE_TYPE',
  lateFeePerDayAmount: 'LATE_FEE_PER_DAY_AMOUNT',
  lateFeePerInstallmentAmount: 'LATE_FEE_PER_INSTALLMENT_AMOUNT',
} as const;

export type LateFeeTypeValue = 'NONE' | 'PER_DAY' | 'PER_INSTALLMENT';

export interface CollectionSettings {
  /** Días antes del vencimiento en que se envía el recordatorio (0 = el mismo día) */
  reminderDaysBefore: number;
  /** Días de gracia tras el vencimiento antes de cobrar mora */
  graceDays: number;
  /** Cada cuántos días se repite el aviso de cuota vencida (0 = solo una vez) */
  overdueReminderEveryDays: number;
  /** Día del mes sugerido para las cuotas de un crédito nuevo (null = mismo día del desembolso) */
  defaultPaymentDay: number | null;
  defaultLateFeeType: LateFeeTypeValue;
  lateFeePerDayAmount: number;
  lateFeePerInstallmentAmount: number;
}

const LATE_FEE_TYPES: LateFeeTypeValue[] = ['NONE', 'PER_DAY', 'PER_INSTALLMENT'];

const toInt = (v: string | undefined, fallback: number) => {
  const n = v === undefined ? NaN : parseInt(v, 10);
  return Number.isInteger(n) ? n : fallback;
};
const toNum = (v: string | undefined, fallback: number) => {
  const n = v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

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

  async getCollectionSettings(): Promise<CollectionSettings> {
    const [rows, product] = await Promise.all([
      this.prisma.systemSetting.findMany({ where: { key: { in: Object.values(COLLECTION_KEYS) } } }),
      this.activeProduct(),
    ]);
    const get = (k: keyof typeof COLLECTION_KEYS) => rows.find((r) => r.key === COLLECTION_KEYS[k])?.value;
    const envDays = (process.env.PAYMENT_REMINDER_DAYS || '').split(',')[0]?.trim();
    const paymentDay = toInt(get('defaultPaymentDay'), 0);
    const type = get('defaultLateFeeType') as LateFeeTypeValue | undefined;

    return {
      reminderDaysBefore: toInt(get('reminderDaysBefore') ?? envDays, 3),
      graceDays: product?.graceDays ?? 5,
      overdueReminderEveryDays: toInt(get('overdueReminderEveryDays'), 7),
      defaultPaymentDay: paymentDay >= 1 && paymentDay <= 28 ? paymentDay : null,
      defaultLateFeeType: type && LATE_FEE_TYPES.includes(type) ? type : 'PER_DAY',
      lateFeePerDayAmount: toNum(get('lateFeePerDayAmount'), 5),
      lateFeePerInstallmentAmount: toNum(get('lateFeePerInstallmentAmount'), 20),
    };
  }

  async updateCollectionSettings(dto: Partial<CollectionSettings>, userId?: string) {
    const product = await this.activeProduct();
    if (dto.graceDays !== undefined && !product) {
      throw new BadRequestException('No hay un producto financiero activo configurado.');
    }

    const values: [keyof typeof COLLECTION_KEYS, string, string][] = [];
    const add = (k: keyof typeof COLLECTION_KEYS, v: unknown, description: string) => {
      if (v !== undefined) values.push([k, v === null ? '' : String(v), description]);
    };
    add('reminderDaysBefore', dto.reminderDaysBefore, 'Días antes del vencimiento para enviar el recordatorio de pago');
    add('overdueReminderEveryDays', dto.overdueReminderEveryDays, 'Frecuencia en días del aviso de cuota vencida (0 = una vez)');
    add('defaultPaymentDay', dto.defaultPaymentDay, 'Día del mes sugerido para el vencimiento de cuotas');
    add('defaultLateFeeType', dto.defaultLateFeeType, 'Tipo de mora sugerido al aperturar un crédito');
    add('lateFeePerDayAmount', dto.lateFeePerDayAmount, 'Monto de mora por día de atraso (USD)');
    add('lateFeePerInstallmentAmount', dto.lateFeePerInstallmentAmount, 'Monto de mora por cuota vencida (USD)');

    await this.prisma.$transaction(async (tx) => {
      for (const [k, value, description] of values) {
        await tx.systemSetting.upsert({
          where: { key: COLLECTION_KEYS[k] },
          update: { value },
          create: { key: COLLECTION_KEYS[k], value, description, isPublic: false },
        });
      }
      // Los días de gracia viven en el producto activo y se copian a cada crédito al aperturarlo
      if (dto.graceDays !== undefined) {
        await tx.financingProduct.updateMany({ where: { isActive: true }, data: { graceDays: dto.graceDays } });
      }
    });

    this.logger.log(`Parámetros de cobranza actualizados por usuario ${userId}`);
    return { success: true, message: 'Parámetros de cobranza y mora actualizados.', ...(await this.getCollectionSettings()) };
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
