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
} from '@prisma/client';
import { Type } from 'class-transformer';
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
import { generateSchedule, todayInTz, addMonths, fmt } from '../finance/engine';
import { nextSequentialCode, withUniqueRetry } from '../common/codes';
import { DomainEvents } from '../common/domain-events';
import { ALLOWED_DOCUMENT_MIME_TYPES, DOCUMENTS_UPLOAD_DIR, MAX_DOCUMENT_BYTES } from '../documents/documents.constants';

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  phone!: string;

  @IsEmail()
  email!: string;

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

export class ConvertLeadToLoanDto {
  @Matches(/^\d{8}-\d$/, { message: 'El DUI debe tener el formato 00000000-0' })
  dui!: string;

  @Matches(/^(\d{8}-\d|\d{4}-\d{6}-\d{3}-\d)$/, {
    message: 'El NIT debe tener el formato 00000000-0 o 0000-000000-000-0',
  })
  nit!: string;

  @IsString()
  @IsNotEmpty({ message: 'La dirección del cliente es obligatoria' })
  address!: string;

  @IsString()
  @IsNotEmpty({ message: 'La actividad económica del cliente es obligatoria' })
  economicActivity!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1, { message: 'El ingreso mensual debe ser mayor a cero' })
  monthlyIncome!: number;

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

  @IsArray()
  @ArrayMinSize(5)
  @ValidateNested({ each: true })
  @Type(() => DocumentUploadInput)
  documents!: DocumentUploadInput[];

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
  ) {
    if (!fs.existsSync(DOCUMENTS_UPLOAD_DIR)) {
      fs.mkdirSync(DOCUMENTS_UPLOAD_DIR, { recursive: true });
    }
  }

  async createPublicLead(dto: CreateLeadDto) {
    if (!dto.privacyAccepted) {
      throw new BadRequestException('Debe aceptar el aviso de privacidad y consentimiento para tratamiento de datos.');
    }

    if (dto.vehicleId) {
      const exists = await this.prisma.vehicle.count({ where: { id: dto.vehicleId, isPublished: true } });
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
          phone: dto.phone.trim(),
          email: dto.email.toLowerCase().trim(),
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

    this.events.emit('lead.created', { leadId: lead.id });
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

  private validateDocuments(documents: DocumentUploadInput[]) {
    const categories = documents.map((d) => d.category);
    const missingDocs: string[] = [];
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

    const documents = this.validateDocuments(dto.documents);

    // Vehículo: obligatorio y disponible (nunca se asigna uno arbitrario)
    const vehicleId = dto.vehicleId || lead.vehicleId;
    if (!vehicleId) throw new BadRequestException('Debe seleccionar el vehículo a financiar.');
    const vehicle = await this.prisma.vehicle.findUnique({ where: { id: vehicleId } });
    if (!vehicle) throw new BadRequestException('El vehículo seleccionado no existe.');
    if (vehicle.status !== VehicleStatus.AVAILABLE && vehicle.status !== VehicleStatus.RESERVED) {
      throw new BadRequestException(`El vehículo ${vehicle.brand} ${vehicle.model} no está disponible para financiar.`);
    }

    const product = await this.prisma.financingProduct.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!product) throw new BadRequestException('No hay un producto financiero activo configurado.');

    // Parámetros del crédito
    const vehiclePrice = new Decimal(vehicle.salePrice.toString());
    const downPayment = new Decimal(
      dto.downPayment ?? (lead.estimatedDown !== null ? lead.estimatedDown.toString() : vehicle.minDownPayment.toString()),
    );
    if (downPayment.gte(vehiclePrice)) {
      throw new BadRequestException('La prima debe ser menor al precio del vehículo.');
    }
    const minDown = vehiclePrice.mul(product.minDownPercent.toString()).div(100).toDecimalPlaces(2);
    if (downPayment.lt(minDown)) {
      throw new BadRequestException(
        `La prima mínima para este producto es ${product.minDownPercent.toString()}% (${fmt(minDown)} USD).`,
      );
    }
    const principal = vehiclePrice.minus(downPayment).toDecimalPlaces(2);

    const termCount = dto.termMonths ?? lead.termMonths ?? product.minTermMonths;
    if (termCount < product.minTermMonths || termCount > product.maxTermMonths) {
      throw new BadRequestException(
        `El plazo debe estar entre ${product.minTermMonths} y ${product.maxTermMonths} meses.`,
      );
    }
    const monthlyRate = new Decimal(dto.monthlyRate ?? product.defaultMonthlyRate.toString());

    const disbursementDate = todayInTz();
    const firstDueDate = addMonths(disbursementDate, 1);

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
          // Cliente: reutilizar si ya existe por DUI o correo
          let customer = await tx.customer.findFirst({
            where: { OR: [{ dui: dto.dui }, { email: lead.email }] },
          });

          if (customer) {
            customer = await tx.customer.update({
              where: { id: customer.id },
              data: {
                status: CustomerStatus.ACTIVE,
                dui: dto.dui,
                nit: dto.nit,
                address: dto.address,
                economicActivity: dto.economicActivity,
                monthlyIncome: dto.monthlyIncome,
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
                dui: dto.dui,
                nit: dto.nit,
                phone: lead.phone,
                email: lead.email,
                address: dto.address,
                economicActivity: dto.economicActivity,
                monthlyIncome: dto.monthlyIncome,
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
              lateRateMonthly: product.lateRateMonthly,
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

          const note = `Formalizado a Crédito Activo [${loanCode}] el ${disbursementDate}. Expediente documental completo adjunto.`;
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
      this.events.emit('loan.activated', { loanId: result.loan.id });

      return {
        success: true,
        message: `Crédito formalizado y activado exitosamente con código ${result.loan.code}.`,
        loan: result.loan,
        customer: result.customer,
        levelPayment: schedule.installments[0]?.payment.toFixed(2),
        documentsUploaded: documents.length,
      };
    } catch (err) {
      await Promise.all(writtenFiles.map((f) => fs.promises.unlink(f).catch(() => undefined)));
      throw err;
    }
  }
}
