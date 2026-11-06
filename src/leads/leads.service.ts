import { Injectable, NotFoundException, BadRequestException, Logger, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  LeadStatus,
  LeadSource,
  CustomerStatus,
  DocumentCategory,
  DocumentStatus,
  VehicleStatus,
  LoanStatus,
  PaymentFrequency,
  InstallmentStatus,
  LateFeeType,
  PersonType,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import * as fs from 'fs';
import * as path from 'path';
import Decimal from 'decimal.js';
import { generateSchedule, todayInTz, addMonths, firstDueDateForDay, fmt, isValidDate } from '../finance/engine';
import { SettingsService } from '../settings/settings.service';
import { nextSequentialCode, withUniqueRetry } from '../common/codes';
import { DomainEvents } from '../common/domain-events';
import { vehicleName } from '../common/labels';
import { ALLOWED_DOCUMENT_MIME_TYPES, DOCUMENTS_UPLOAD_DIR, MAX_DOCUMENT_BYTES } from '../documents/documents.constants';

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName!: string;

  /** Obligatorio en el formulario público; opcional en carga inicial del personal (queda null) */
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  @IsOptional()
  phone?: string;

  /** Opcional: prospectos/clientes sin correo (no reciben correos; las copias van a los ADMIN) */
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  message?: string;

  @IsEnum(LeadSource)
  @IsOptional()
  source?: LeadSource;

  @IsString()
  @IsOptional()
  vehicleId?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedDown?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  @IsOptional()
  termMonths?: number;

  @IsBoolean()
  privacyAccepted!: boolean;

  /** Carga inicial por el personal: no envía correos (solo se respeta con sesión de personal) */
  @IsBoolean()
  @IsOptional()
  initialLoad?: boolean;
}

export class UpdateLeadDto {
  @IsString()
  @IsOptional()
  fullName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsEnum(LeadStatus)
  @IsOptional()
  status?: LeadStatus;

  @IsString()
  @IsOptional()
  internalNotes?: string;

  @IsString()
  @IsOptional()
  vehicleId?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  estimatedDown?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  @IsOptional()
  termMonths?: number;

  @IsString()
  @IsOptional()
  assignedToUserId?: string;
}

export class UpdateLeadStatusDto {
  @IsEnum(LeadStatus)
  status!: LeadStatus;

  @IsString()
  @IsOptional()
  internalNotes?: string;

  @IsString()
  @IsOptional()
  assignedToUserId?: string;
}

export class DocumentUploadInput {
  @IsEnum(DocumentCategory)
  category!: DocumentCategory;

  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @IsString()
  @IsNotEmpty()
  contentBase64!: string;

  @IsString()
  @IsOptional()
  title?: string;
}

/**
 * dui, nit, address, economicActivity y monthlyIncome son obligatorios salvo con initialLoad=true (carga parcial):
 * ahí pueden faltar y quedan en null para que el admin los complete. La regla se valida en el servicio.
 */
export class ConvertLeadToLoanDto {
  @Matches(/^\d{8}-\d$/, { message: 'El DUI debe tener el formato 00000000-0' })
  @IsOptional()
  dui?: string;

  @Matches(/^(\d{8}-\d|\d{4}-\d{6}-\d{3}-\d)$/, {
    message: 'El NIT debe tener el formato 00000000-0 o 0000-000000-000-0',
  })
  @IsOptional()
  nit?: string;

  @IsString()
  @IsNotEmpty({ message: 'La dirección del cliente es obligatoria' })
  @IsOptional()
  address?: string;

  @IsString()
  @IsNotEmpty({ message: 'La actividad económica del cliente es obligatoria' })
  @IsOptional()
  economicActivity?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: 'El ingreso mensual debe ser mayor a cero' })
  @IsOptional()
  monthlyIncome?: number;

  /** Persona natural (por defecto) o jurídica (p. ej. "Chacon Inversiones SA de CV") */
  @IsEnum(PersonType)
  @IsOptional()
  personType?: PersonType;

  /**
   * Cliente existente al que se asigna el crédito (un cliente con varios créditos). Si se omite, se reutiliza
   * el cliente con el mismo DUI o correo, o se crea uno nuevo.
   */
  @IsString()
  @IsOptional()
  customerId?: string;

  @IsString()
  @IsOptional()
  vehicleId?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  downPayment?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  @IsOptional()
  termMonths?: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(0.1)
  @IsOptional()
  monthlyRate?: number;

  /** Día del mes en que vence cada cuota (1-28). Si se omite, se usa el parámetro general o el día del desembolso. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(28, { message: 'El día de pago debe estar entre 1 y 28 para existir en todos los meses.' })
  @IsOptional()
  paymentDay?: number;

  /** Mora del crédito: por día de atraso, cuota fija por cuota vencida o sin recargo */
  @IsEnum(LateFeeType)
  @IsOptional()
  lateFeeType?: LateFeeType;

  /** Monto en USD: por día (PER_DAY) o por cuota vencida (PER_INSTALLMENT) */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000)
  @IsOptional()
  lateFeeAmount?: number;

  /**
   * Expediente: obligatorio con los 5 documentos, salvo en carga inicial (initialLoad), donde es opcional.
   * La regla de los 5 documentos se valida en el servicio.
   */
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => DocumentUploadInput)
  documents?: DocumentUploadInput[];

  /** Fecha de la PRIMERA cuota (AAAA-MM-DD). El día de pago se deriva de ella (p. ej. 2026-07-10 → día 10). */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'firstPaymentDate debe tener el formato AAAA-MM-DD' })
  @IsOptional()
  firstPaymentDate?: string;

  /**
   * Fecha de desembolso (AAAA-MM-DD). Por defecto hoy; en carga inicial con firstPaymentDate, un mes antes de
   * la primera cuota (así la primera cuota es un periodo completo y coincide con la cuota nivelada).
   */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'disbursementDate debe tener el formato AAAA-MM-DD' })
  @IsOptional()
  disbursementDate?: string;

  /** Tasa ANUAL nominal en porcentaje (36 = 36 % anual = 3 % mensual; 0 = sin interés). Reemplaza a monthlyRate. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(120)
  @IsOptional()
  annualRate?: number;

  /** Monto financiado. Si se indica, la prima es precio del vehículo − monto financiado. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @IsOptional()
  principal?: number;

  /** Seguro mensual (USD) que se sugiere al registrar cada pago. No forma parte del crédito ni de su tabla de amortización. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10000)
  @IsOptional()
  insuranceMonthly?: number;

  /**
   * Carga inicial de un crédito que ya está en curso: no envía los correos de creación/formalización (cliente
   * ni administración), permite fechas pasadas y no exige los documentos ni los rangos del producto (prima,
   * plazo). El crédito queda con su atraso real: las cuotas vencidas quedan vencidas, la mora se calcula según
   * sus parámetros y la cobranza diaria avisa a los ADMIN como en cualquier otro crédito.
   */
  @IsBoolean()
  @IsOptional()
  initialLoad?: boolean;

  @IsString()
  @IsOptional()
  notes?: string;
}

const INCOME_CATEGORIES: DocumentCategory[] = [
  DocumentCategory.PAYSLIP,
  DocumentCategory.BANK_STATEMENT,
  DocumentCategory.TAX_RETURN,
];

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly settings: SettingsService,
  ) {
    if (!fs.existsSync(DOCUMENTS_UPLOAD_DIR)) {
      fs.mkdirSync(DOCUMENTS_UPLOAD_DIR, { recursive: true });
    }
  }

  async createPublicLead(dto: CreateLeadDto, silent = false) {
    if (!dto.privacyAccepted) {
      throw new BadRequestException('Debe aceptar el aviso de privacidad y consentimiento para tratamiento de datos.');
    }

    if (!silent && !dto.phone?.trim()) throw new BadRequestException('El teléfono es obligatorio.');
    if (dto.vehicleId) {
      // En carga inicial el vehículo puede no estar publicado (ya está vendido)
      const exists = await this.prisma.vehicle.count({ where: { id: dto.vehicleId, ...(silent ? {} : { isPublished: true }) } });
      if (!exists) throw new BadRequestException('El vehículo seleccionado no está disponible.');
    }

    const lead = await withUniqueRetry(async () => {
      const code = await nextSequentialCode(
        (prefix) =>
          this.prisma.lead.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: 'desc' }, select: { code: true } }),
        'PROS',
      );
      return this.prisma.lead.create({
        data: {
          code,
          fullName: dto.fullName.trim(),
          phone: dto.phone?.trim() || null,
          email: dto.email ? dto.email.toLowerCase().trim() : null,
          message: dto.message,
          source: dto.source || LeadSource.CATALOG_REQUEST,
          status: LeadStatus.NEW,
          vehicleId: dto.vehicleId,
          estimatedDown: dto.estimatedDown,
          termMonths: dto.termMonths,
          privacyAccepted: dto.privacyAccepted,
        },
      });
    });

    this.events.emit('lead.created', { leadId: lead.id, silent });
    // Respuesta pública mínima: no se devuelven datos internos
    return { code: lead.code, createdAt: lead.createdAt };
  }

  async findAll(status?: LeadStatus) {
    const where = status ? { status } : {};
    return this.prisma.lead.findMany({
      where,
      include: { vehicle: { include: { images: { where: { isPrimary: true }, take: 1 } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: { vehicle: true },
    });
    if (!lead) throw new NotFoundException('Prospecto no encontrado');
    return lead;
  }

  async updateLead(id: string, dto: UpdateLeadDto) {
    await this.findOne(id);
    // El vehículo debe ser de la misma empresa (la consulta ya está filtrada por empresa)
    if (dto.vehicleId && !(await this.prisma.vehicle.count({ where: { id: dto.vehicleId } }))) {
      throw new BadRequestException('El vehículo seleccionado no existe.');
    }

    return this.prisma.lead.update({
      where: { id },
      data: {
        fullName: dto.fullName,
        phone: dto.phone,
        email: dto.email?.toLowerCase().trim(),
        status: dto.status,
        internalNotes: dto.internalNotes,
        vehicleId: dto.vehicleId,
        estimatedDown: dto.estimatedDown,
        termMonths: dto.termMonths,
        assignedToUserId: dto.assignedToUserId,
      },
      include: { vehicle: true },
    });
  }

  private validateDocuments(documents: DocumentUploadInput[], requireAll = true) {
    const categories = documents.map((d) => d.category);
    const missingDocs: string[] = [];
    if (!requireAll) return this.decodeDocuments(documents);
    if (!categories.includes(DocumentCategory.DUI_FRONT) && !categories.includes(DocumentCategory.DUI_BACK)) missingDocs.push('DUI');
    if (!categories.includes(DocumentCategory.NIT)) missingDocs.push('NIT');
    if (!categories.includes(DocumentCategory.DRIVER_LICENSE)) missingDocs.push('Licencia de Conducir');
    if (!categories.some((c) => INCOME_CATEGORIES.includes(c))) missingDocs.push('Comprobante de Ingresos');
    if (!categories.includes(DocumentCategory.UTILITY_BILL)) missingDocs.push('Recibo de Agua o Luz (Comprobante de Domicilio)');

    if (missingDocs.length > 0) {
      throw new BadRequestException(
        `Faltan documentos obligatorios: ${missingDocs.join(', ')}. No es posible activar el crédito sin el expediente completo de 5 documentos.`,
      );
    }
    return this.decodeDocuments(documents);
  }

  private decodeDocuments(documents: DocumentUploadInput[]) {
    return documents.map((doc) => {
      if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(doc.mimeType)) {
        throw new BadRequestException(`Tipo de archivo no permitido para ${doc.fileName}. Use PDF, JPG, PNG o WEBP.`);
      }
      const buffer = Buffer.from(doc.contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      if (buffer.length === 0) throw new BadRequestException(`El archivo ${doc.fileName} está vacío o es inválido.`);
      if (buffer.length > MAX_DOCUMENT_BYTES) {
        throw new BadRequestException(`El archivo ${doc.fileName} supera el tamaño máximo de 10 MB.`);
      }
      return { ...doc, buffer };
    });
  }

  /**
   * Formaliza un prospecto convirtiéndolo en un Crédito Activo.
   * Requiere los 5 documentos del cliente: DUI, NIT, Licencia, Comprobante de Ingresos y Recibo de servicio.
   * Toda la operación es atómica: si algo falla no queda cliente, crédito ni archivo a medias.
   */
  async convertLeadToLoan(leadId: string, dto: ConvertLeadToLoanDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw new NotFoundException('Prospecto no encontrado');
    if (lead.status === LeadStatus.CONVERTED) {
      throw new ConflictException('Este prospecto ya fue formalizado a crédito.');
    }

    const initialLoad = !!dto.initialLoad;
    if (!initialLoad) {
      const required: [keyof ConvertLeadToLoanDto, string][] = [
        ['dui', 'DUI'],
        ['nit', 'NIT'],
        ['address', 'dirección'],
        ['economicActivity', 'actividad económica'],
        ['monthlyIncome', 'ingreso mensual'],
      ];
      const missing = required.filter(([k]) => dto[k] === undefined || dto[k] === null || dto[k] === '').map(([, l]) => l);
      if (missing.length) throw new BadRequestException(`Faltan datos del cliente: ${missing.join(', ')}.`);
    }
    const documents = this.validateDocuments(dto.documents ?? [], !initialLoad);

    // Vehículo: obligatorio y disponible (nunca se asigna uno arbitrario)
    const vehicleId = dto.vehicleId || lead.vehicleId;
    if (!vehicleId) throw new BadRequestException('Debe seleccionar el vehículo a financiar.');
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new BadRequestException('El vehículo seleccionado no existe.');
    if (vehicle.status !== VehicleStatus.AVAILABLE && vehicle.status !== VehicleStatus.RESERVED) {
      throw new BadRequestException(`El vehículo ${vehicleName(vehicle)} no está disponible para financiar.`);
    }

    const product = await this.prisma.financingProduct.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!product) throw new BadRequestException('No hay un producto financiero activo configurado.');

    // Parámetros del crédito
    const vehiclePrice = new Decimal(vehicle.salePrice.toString());
    const downPayment =
      dto.principal !== undefined
        ? vehiclePrice.minus(dto.principal)
        : new Decimal(
            dto.downPayment ?? (lead.estimatedDown !== null ? lead.estimatedDown.toString() : vehicle.minDownPayment.toString()),
          );
    if (downPayment.lt(0)) {
      throw new BadRequestException('El monto financiado no puede ser mayor al precio del vehículo.');
    }
    if (downPayment.gte(vehiclePrice)) {
      throw new BadRequestException('La prima debe ser menor al precio del vehículo.');
    }
    const minDown = vehiclePrice.mul(product.minDownPercent.toString()).div(100).toDecimalPlaces(2);
    // En carga inicial el contrato ya existe: no se reevalúan prima ni plazo contra el producto actual
    if (!initialLoad && downPayment.lt(minDown)) {
      throw new BadRequestException(
        `La prima mínima para este producto es ${product.minDownPercent.toString()}% (${fmt(minDown)} USD).`,
      );
    }
    const principal = vehiclePrice.minus(downPayment).toDecimalPlaces(2);

    const termCount = dto.termMonths ?? lead.termMonths ?? product.minTermMonths;
    if (!initialLoad && (termCount < product.minTermMonths || termCount > product.maxTermMonths)) {
      throw new BadRequestException(
        `El plazo debe estar entre ${product.minTermMonths} y ${product.maxTermMonths} meses.`,
      );
    }
    // Tasa: anual nominal (36 % → 0.03 mensual) o mensual en decimal; si no, la del producto
    // Se guarda con 10 decimales (Decimal(12,10)): 40 % anual → 0.0333333333, cuota exacta al centavo
    const monthlyRate = (
      dto.annualRate !== undefined
        ? new Decimal(dto.annualRate).div(1200)
        : new Decimal(dto.monthlyRate ?? product.defaultMonthlyRate.toString())
    ).toDecimalPlaces(10);
    const insurance = dto.insuranceMonthly && dto.insuranceMonthly > 0 ? new Decimal(dto.insuranceMonthly).toDecimalPlaces(2) : null;

    // Día de pago y mora: lo indicado al aperturar o, si no, los parámetros de cobranza
    const collection = await this.settings.getCollectionSettings();
    if (dto.firstPaymentDate && !isValidDate(dto.firstPaymentDate)) throw new BadRequestException('firstPaymentDate no es una fecha válida.');
    if (dto.disbursementDate && !isValidDate(dto.disbursementDate)) throw new BadRequestException('disbursementDate no es una fecha válida.');
    // Con primera cuota explícita, el día de pago sale de ella (los días 29-31 se manejan como fin de mes)
    const explicitDay = dto.firstPaymentDate ? Number(dto.firstPaymentDate.slice(8, 10)) : null;
    // En carga inicial se respeta el día real (29-31: en meses cortos la cuota cae el último día del mes)
    const paymentDay =
      explicitDay !== null
        ? explicitDay <= 28 || initialLoad
          ? explicitDay
          : null
        : dto.paymentDay ?? null; // sin día indicado: el día de apertura (se completa abajo con la fecha de desembolso)
    const lateFeeType = dto.lateFeeType ?? collection.defaultLateFeeType;
    const lateFeeAmount =
      lateFeeType === LateFeeType.NONE
        ? null
        : new Decimal(
            dto.lateFeeAmount ??
              (lateFeeType === LateFeeType.PER_DAY ? collection.lateFeePerDayAmount : collection.lateFeePerInstallmentAmount),
          );
    if (lateFeeAmount && lateFeeAmount.lte(0)) {
      throw new BadRequestException('Indique el monto de la mora o seleccione "Sin mora".');
    }

    const disbursementDate =
      dto.disbursementDate ?? (dto.firstPaymentDate && initialLoad ? addMonths(dto.firstPaymentDate, -1) : todayInTz());
    const firstDueDate =
      dto.firstPaymentDate ?? (paymentDay ? firstDueDateForDay(disbursementDate, paymentDay) : addMonths(disbursementDate, 1));
    // Día de pago del crédito: el indicado, o el mismo día del mes en que se apertura (29-31 vencen a fin de mes en meses cortos)
    const loanPaymentDay = paymentDay ?? Number(firstDueDate.slice(8, 10));
    if (firstDueDate <= disbursementDate) {
      throw new BadRequestException('La primera cuota debe ser posterior a la fecha de desembolso.');
    }
    if (!initialLoad && disbursementDate < todayInTz()) {
      throw new BadRequestException('La fecha de desembolso no puede ser pasada; para créditos ya en curso use initialLoad.');
    }

    const schedule = generateSchedule({
      principal,
      monthlyRate,
      dayCount: product.dayCountBasis,
      frequency: 'MONTHLY',
      rounding: 'HALF_UP',
      method: product.method,
      startDate: disbursementDate,
      startNumber: 1,
      anchorDate: firstDueDate,
      anchorNumber: 1,
      count: termCount,
    });

    // Guardar archivos primero; se eliminan si la transacción falla
    const writtenFiles: string[] = [];
    const storedDocs: { doc: (typeof documents)[number]; storedFileName: string }[] = [];

    try {
      for (const doc of documents) {
        const ext = path.extname(doc.fileName).toLowerCase() || (doc.mimeType.includes('pdf') ? '.pdf' : '.jpg');
        const storedFileName = `${leadId}_${doc.category}_${Date.now()}_${Math.floor(Math.random() * 1e6)}${ext}`;
        const filePath = path.join(DOCUMENTS_UPLOAD_DIR, storedFileName);
        await fs.promises.writeFile(filePath, doc.buffer);
        writtenFiles.push(filePath);
        storedDocs.push({ doc, storedFileName });
      }

      const result = await withUniqueRetry(() =>
        this.prisma.$transaction(async (tx) => {
          // Cliente: el indicado (customerId), o el que tenga el mismo DUI o correo, o uno nuevo.
          // Solo se busca por los datos presentes: un { dui: undefined } dentro de OR coincidiría con todos.
          let customer = null as Awaited<ReturnType<typeof tx.customer.findFirst>>;
          if (dto.customerId) {
            customer = await tx.customer.findUnique({ where: { id: dto.customerId } });
            if (!customer) throw new BadRequestException('El cliente indicado (customerId) no existe en esta empresa.');
          } else {
            const match: { dui?: string; email?: string }[] = [];
            if (dto.dui) match.push({ dui: dto.dui });
            if (lead.email) match.push({ email: lead.email });
            if (match.length) customer = await tx.customer.findFirst({ where: { OR: match } });
          }

          if (customer) {
            // Solo se completan los datos que vienen; nunca se borra lo existente
            customer = await tx.customer.update({
              where: { id: customer.id },
              data: {
                status: CustomerStatus.ACTIVE,
                dui: dto.dui ?? undefined,
                nit: dto.nit ?? undefined,
                address: dto.address ?? undefined,
                economicActivity: dto.economicActivity ?? undefined,
                monthlyIncome: dto.monthlyIncome ?? undefined,
                personType: dto.personType ?? undefined,
              },
            });
          } else {
            const customerCode = await nextSequentialCode(
              (prefix) => tx.customer.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: 'desc' }, select: { code: true } }),
              'CLI',
            );
            customer = await tx.customer.create({
              data: {
                code: customerCode,
                fullName: lead.fullName,
                personType: dto.personType ?? PersonType.NATURAL,
                dui: dto.dui ?? null,
                nit: dto.nit ?? null,
                phone: lead.phone ?? null,
                email: lead.email ?? null,
                address: dto.address ?? null,
                economicActivity: dto.economicActivity ?? null,
                monthlyIncome: dto.monthlyIncome ?? null,
                status: CustomerStatus.ACTIVE,
                internalNotes: `Cliente formalizado a partir del prospecto ${lead.code}`,
              },
            });
          }

          await tx.customerDocument.createMany({
            data: storedDocs.map(({ doc, storedFileName }) => ({
              customerId: customer!.id,
              category: doc.category,
              title: doc.title || `${doc.category} - ${doc.fileName}`,
              fileKey: storedFileName,
              fileName: doc.fileName,
              mimeType: doc.mimeType,
              fileSizeBytes: doc.buffer.length,
              status: DocumentStatus.APPROVED,
              notes: 'Documento validado en formalización de crédito desde prospecto',
            })),
          });

          const loanCode = await nextSequentialCode(
            (prefix) => tx.loan.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: 'desc' }, select: { code: true } }),
            'CRE',
            4,
          );

          const loan = await tx.loan.create({
            data: {
              code: loanCode,
              customerId: customer.id,
              vehicleId: vehicle.id,
              productId: product.id,
              vehiclePrice: vehiclePrice.toFixed(2),
              downPayment: downPayment.toFixed(2),
              financedFees: 0,
              originalPrincipal: principal.toFixed(2),
              currentPrincipalBalance: principal.toFixed(2),
              monthlyRate: monthlyRate.toString(),
              termCount,
              frequency: PaymentFrequency.MONTHLY,
              dayCount: product.dayCountBasis,
              method: product.method,
              graceDays: product.graceDays,
              // La mora se rige por el recargo fijo del crédito; el interés moratorio queda para créditos anteriores
              lateRateMonthly: null,
              lateFeeType,
              lateFeeAmount: lateFeeAmount?.toFixed(2) ?? null,
              paymentDay: loanPaymentDay,
              insuranceMonthly: insurance ? insurance.toFixed(2) : null,
              notificationsPaused: false,
              disbursementDate: new Date(disbursementDate),
              firstDueDate: new Date(firstDueDate),
              status: LoanStatus.ACTIVE,
            },
            include: { customer: true, vehicle: true },
          });

          await tx.loanContractVersion.create({
            data: {
              loanId: loan.id,
              versionIndex: 0,
              reason: 'ORIGINAL',
              effectiveDate: new Date(disbursementDate),
              principalBalance: principal.toFixed(2),
              monthlyRate: monthlyRate.toString(),
              levelPayment: schedule.installments[0]?.payment.toFixed(2) ?? null,
            },
          });

          await tx.amortizationInstallment.createMany({
            data: schedule.installments.map((inst) => ({
              loanId: loan.id,
              versionIndex: 0,
              number: inst.number,
              dueDate: new Date(inst.dueDate),
              periodStart: new Date(inst.periodStart),
              openingBalance: inst.openingBalance.toFixed(2),
              scheduledPrincipal: inst.principal.toFixed(2),
              scheduledInterest: inst.interest.toFixed(2),
              scheduledPayment: inst.payment.toFixed(2),
              closingBalance: inst.closingBalance.toFixed(2),
              scheduledInsurance: '0', // el seguro no forma parte de la cuota
              status: InstallmentStatus.PENDING,
            })),
          });

          await tx.vehicle.update({ where: { id: vehicle.id }, data: { status: VehicleStatus.SOLD } });
          await tx.vehicleStatusHistory.create({
            data: {
              vehicleId: vehicle.id,
              fromStatus: vehicle.status,
              toStatus: VehicleStatus.SOLD,
              reason: `Financiado con crédito ${loanCode}`,
            },
          });

          // La nota describe lo que realmente pasó: en carga inicial el expediente puede estar incompleto o vacío
          const docsNote = !initialLoad
            ? 'Expediente documental completo adjunto.'
            : documents.length
              ? `Carga inicial: ${documents.length} documento(s) adjunto(s); expediente pendiente de completar.`
              : 'Carga inicial: expediente pendiente.';
          const note = `Formalizado a Crédito Activo [${loanCode}] el ${disbursementDate}. ${docsNote}`;
          await tx.lead.update({
            where: { id: leadId },
            data: {
              status: LeadStatus.CONVERTED,
              vehicleId: vehicle.id,
              internalNotes: [lead.internalNotes, dto.notes, note].filter(Boolean).join('\n'),
            },
          });

          return { loan, customer };
        }),
      );

      this.logger.log(`Crédito ${result.loan.code} activado para cliente ${result.customer.fullName}`);
      this.events.emit('loan.activated', { loanId: result.loan.id, silent: initialLoad });

      return {
        success: true,
        message: `Crédito formalizado y activado exitosamente con código ${result.loan.code}.`,
        loan: result.loan,
        customer: result.customer,
        levelPayment: schedule.installments[0]?.payment.toFixed(2),
        insuranceMonthly: insurance ? insurance.toFixed(2) : null,
        totalInstallment: schedule.installments[0] ? schedule.installments[0].payment.plus(insurance ?? 0).toFixed(2) : null,
        initialLoad,
        documentsUploaded: documents.length,
      };
    } catch (err) {
      await Promise.all(writtenFiles.map((f) => fs.promises.unlink(f).catch(() => undefined)));
      throw err;
    }
  }
}
