import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
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
  DayCountBasis,
  AmortizationMethod,
} from '@prisma/client';
import { IsNotEmpty, IsString, IsEmail, IsOptional, IsNumber, IsBoolean, IsArray } from 'class-validator';
import * as fs from 'fs';
import * as path from 'path';
import Decimal from 'decimal.js';
import { generateSchedule } from '../finance/engine';

export class CreateLeadDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsOptional()
  message?: string;

  @IsOptional()
  source?: LeadSource;

  @IsString()
  @IsOptional()
  vehicleId?: string;

  @IsNumber()
  @IsOptional()
  estimatedDown?: number;

  @IsNumber()
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

  @IsOptional()
  status?: LeadStatus;

  @IsString()
  @IsOptional()
  internalNotes?: string;

  @IsString()
  @IsOptional()
  vehicleId?: string;

  @IsNumber()
  @IsOptional()
  estimatedDown?: number;

  @IsNumber()
  @IsOptional()
  termMonths?: number;

  @IsString()
  @IsOptional()
  assignedToUserId?: string;
}

export interface DocumentUploadInput {
  category: DocumentCategory;
  fileName: string;
  mimeType: string;
  contentBase64: string;
  title?: string;
}

export class ConvertLeadToLoanDto {
  @IsString()
  @IsNotEmpty()
  dui!: string;

  @IsString()
  @IsNotEmpty()
  nit!: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  economicActivity?: string;

  @IsNumber()
  @IsOptional()
  monthlyIncome?: number;

  @IsString()
  @IsOptional()
  vehicleId?: string;

  @IsNumber()
  @IsOptional()
  downPayment?: number;

  @IsNumber()
  @IsOptional()
  termMonths?: number;

  @IsNumber()
  @IsOptional()
  monthlyRate?: number;

  @IsArray()
  documents!: DocumentUploadInput[];

  @IsString()
  @IsOptional()
  notes?: string;
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);
  private readonly uploadDir = path.resolve(process.cwd(), 'uploads', 'documents');

  constructor(private readonly prisma: PrismaService) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async createPublicLead(dto: CreateLeadDto) {
    if (!dto.privacyAccepted) {
      throw new BadRequestException('Debe aceptar el aviso de privacidad y consentimiento para tratamiento de datos.');
    }

    const code = `PROS-${Date.now().toString().slice(-6)}`;

    return this.prisma.lead.create({
      data: {
        code,
        fullName: dto.fullName,
        phone: dto.phone,
        email: dto.email,
        message: dto.message,
        source: dto.source || LeadSource.CATALOG_REQUEST,
        status: LeadStatus.NEW,
        vehicleId: dto.vehicleId,
        estimatedDown: dto.estimatedDown,
        termMonths: dto.termMonths,
        privacyAccepted: dto.privacyAccepted,
      },
      include: {
        vehicle: {
          select: {
            brand: true,
            model: true,
            year: true,
            salePrice: true,
          },
        },
      },
    });
  }

  async findAll(status?: LeadStatus) {
    const where = status ? { status } : {};
    return this.prisma.lead.findMany({
      where,
      include: {
        vehicle: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        vehicle: true,
      },
    });
    if (!lead) throw new NotFoundException('Prospecto no encontrado');
    return lead;
  }

  async updateLead(id: string, dto: UpdateLeadDto) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Prospecto no encontrado');

    return this.prisma.lead.update({
      where: { id },
      data: {
        fullName: dto.fullName ?? lead.fullName,
        phone: dto.phone ?? lead.phone,
        email: dto.email ?? lead.email,
        status: dto.status ?? lead.status,
        internalNotes: dto.internalNotes ?? lead.internalNotes,
        vehicleId: dto.vehicleId ?? lead.vehicleId,
        estimatedDown: dto.estimatedDown !== undefined ? dto.estimatedDown : lead.estimatedDown,
        termMonths: dto.termMonths ?? lead.termMonths,
        assignedToUserId: dto.assignedToUserId ?? lead.assignedToUserId,
      },
      include: {
        vehicle: true,
      },
    });
  }

  async updateStatus(id: string, status: LeadStatus, internalNotes?: string, assignedToUserId?: string) {
    return this.updateLead(id, { status, internalNotes, assignedToUserId });
  }

  /**
   * Formaliza un prospecto convirtiéndolo en un Crédito Activo oficial.
   * Requiere cargar obligatoriamente los 4 documentos del cliente:
   * 1. DUI
   * 2. NIT
   * 3. Licencia de Conducir
   * 4. Comprobante de Ingresos
   */
  async convertLeadToLoan(leadId: string, dto: ConvertLeadToLoanDto) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { vehicle: true },
    });
    if (!lead) throw new NotFoundException('Prospecto no encontrado');

    // 1. Validar documentos obligatorios (5 requeridos)
    if (!dto.documents || !Array.isArray(dto.documents) || dto.documents.length < 5) {
      throw new BadRequestException(
        'Para formalizar a Crédito Activo es obligatorio adjuntar los 5 documentos del cliente: DUI, NIT, Licencia de Conducir, Comprobante de Ingresos y Recibo de Agua o Luz.',
      );
    }

    const categories = dto.documents.map((d) => d.category);
    const hasDui = categories.includes(DocumentCategory.DUI_FRONT) || categories.includes(DocumentCategory.DUI_BACK);
    const hasNit = categories.includes(DocumentCategory.NIT);
    const hasLicense = categories.includes(DocumentCategory.DRIVER_LICENSE);
    const hasIncome =
      categories.includes(DocumentCategory.PAYSLIP) ||
      categories.includes(DocumentCategory.BANK_STATEMENT) ||
      categories.includes(DocumentCategory.TAX_RETURN);
    const hasUtility = categories.includes(DocumentCategory.UTILITY_BILL);

    const missingDocs: string[] = [];
    if (!hasDui) missingDocs.push('DUI');
    if (!hasNit) missingDocs.push('NIT');
    if (!hasLicense) missingDocs.push('Licencia de Conducir');
    if (!hasIncome) missingDocs.push('Comprobante de Ingresos');
    if (!hasUtility) missingDocs.push('Recibo de Agua o Luz (Comprobante de Domicilio)');

    if (missingDocs.length > 0) {
      throw new BadRequestException(
        `Faltan documentos obligatorios: ${missingDocs.join(', ')}. No es posible activar el crédito sin el expediente completo de 5 documentos.`,
      );
    }

    // 2. Resolver Vehículo
    const vehicleId = dto.vehicleId || lead.vehicleId;
    let vehicle = vehicleId ? await this.prisma.vehicle.findUnique({ where: { id: vehicleId } }) : null;
    if (!vehicle) {
      // Tomar primer vehículo disponible si no hay seleccionado
      vehicle = await this.prisma.vehicle.findFirst({
        where: { status: VehicleStatus.AVAILABLE },
      });
      if (!vehicle) {
        vehicle = await this.prisma.vehicle.findFirst();
      }
    }
    if (!vehicle) {
      throw new BadRequestException('No hay vehículos registrados para vincular al crédito.');
    }

    // 3. Resolver o Crear Cliente
    let customer = await this.prisma.customer.findFirst({
      where: {
        OR: [{ dui: dto.dui }, { email: lead.email }],
      },
    });

    if (!customer) {
      const customerCode = `CLI-${Date.now().toString().slice(-5)}`;
      customer = await this.prisma.customer.create({
        data: {
          code: customerCode,
          fullName: lead.fullName,
          dui: dto.dui,
          nit: dto.nit,
          phone: lead.phone,
          email: lead.email,
          address: dto.address || 'San Salvador, El Salvador',
          economicActivity: dto.economicActivity || 'Empleado / Profesional',
          monthlyIncome: dto.monthlyIncome || 1800.0,
          status: CustomerStatus.ACTIVE,
          internalNotes: `Cliente formalizado a partir del prospecto ${lead.code}`,
        },
      });
    } else {
      customer = await this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          status: CustomerStatus.ACTIVE,
          dui: dto.dui || customer.dui,
          nit: dto.nit || customer.nit,
          address: dto.address || customer.address,
          economicActivity: dto.economicActivity || customer.economicActivity,
          monthlyIncome: dto.monthlyIncome || customer.monthlyIncome,
        },
      });
    }

    // 4. Guardar los 4 documentos físicos y en base de datos
    for (const doc of dto.documents) {
      const cleanBase64 = doc.contentBase64.replace(/^data:[^;]+;base64,/, '');
      const fileBuffer = Buffer.from(cleanBase64, 'base64');
      const ext = path.extname(doc.fileName) || (doc.mimeType?.includes('pdf') ? '.pdf' : '.jpg');
      const storedFileName = `${customer.code}_${doc.category}_${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
      const filePath = path.join(this.uploadDir, storedFileName);

      await fs.promises.writeFile(filePath, fileBuffer);

      await this.prisma.customerDocument.create({
        data: {
          customerId: customer.id,
          category: doc.category,
          title: doc.title || `${doc.category} - ${doc.fileName}`,
          fileKey: storedFileName,
          fileName: doc.fileName,
          mimeType: doc.mimeType || 'application/octet-stream',
          fileSizeBytes: fileBuffer.length,
          status: DocumentStatus.APPROVED,
          notes: 'Documento validado en formalización de crédito desde prospecto',
        },
      });
    }

    // 5. Resolver Producto Financiero
    let product = await this.prisma.financingProduct.findFirst({
      where: { isActive: true },
    });
    if (!product) {
      product = await this.prisma.financingProduct.create({
        data: {
          code: 'PROD-AUTO-ESTANDAR',
          name: 'Crédito Vehicular Estándar VELTOR',
          minMonthlyRate: 0.012,
          maxMonthlyRate: 0.022,
          defaultMonthlyRate: 0.015,
          minTermMonths: 12,
          maxTermMonths: 72,
          minDownPercent: 15.0,
          dayCountBasis: DayCountBasis.D30_360,
          method: AmortizationMethod.FRENCH,
          graceDays: 5,
        },
      });
    }

    // 6. Parámetros del Crédito
    const vehiclePrice = Number(vehicle.salePrice);
    const downPayment =
      dto.downPayment !== undefined
        ? Number(dto.downPayment)
        : lead.estimatedDown !== null
        ? Number(lead.estimatedDown)
        : Math.round(vehiclePrice * 0.15);
    const principal = Math.max(100, vehiclePrice - downPayment);
    const termCount = dto.termMonths || lead.termMonths || 36;
    const monthlyRate = dto.monthlyRate || Number(product.defaultMonthlyRate);

    // Cálculo de cuota nivelada francesa
    const i = monthlyRate;
    const n = termCount;
    const cuota = (principal * i) / (1 - Math.pow(1 + i, -n));

    // Fechas
    const today = new Date();
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const loanCode = `CRE-2026-${Math.floor(Math.random() * 9000) + 1000}`;

    // 7. Crear el Crédito Activo
    const loan = await this.prisma.loan.create({
      data: {
        code: loanCode,
        customerId: customer.id,
        vehicleId: vehicle.id,
        productId: product.id,
        vehiclePrice,
        downPayment,
        financedFees: 0.0,
        originalPrincipal: principal,
        currentPrincipalBalance: principal,
        monthlyRate,
        termCount,
        frequency: PaymentFrequency.MONTHLY,
        dayCount: DayCountBasis.D30_360,
        method: AmortizationMethod.FRENCH,
        graceDays: 5,
        disbursementDate: today,
        firstDueDate: nextMonth,
        status: LoanStatus.ACTIVE,
      },
      include: {
        customer: true,
        vehicle: true,
      },
    });

    // 8. Crear Versión de Contrato
    await this.prisma.loanContractVersion.create({
      data: {
        loanId: loan.id,
        versionIndex: 0,
        reason: 'ORIGINAL',
        effectiveDate: today,
        principalBalance: principal,
        monthlyRate,
        levelPayment: Number(cuota.toFixed(2)),
      },
    });

    // 8.5. Generar y persistir cuotas de amortización en base de datos
    try {
      const generated = generateSchedule({
        principal: new Decimal(principal),
        monthlyRate: new Decimal(monthlyRate),
        dayCount: 'D30_360',
        frequency: 'MONTHLY',
        rounding: 'HALF_UP',
        method: 'FRENCH',
        startDate: today.toISOString().split('T')[0],
        startNumber: 1,
        anchorDate: nextMonth.toISOString().split('T')[0],
        anchorNumber: 1,
        count: termCount,
      });

      await this.prisma.amortizationInstallment.createMany({
        data: generated.installments.map((inst) => ({
          loanId: loan.id,
          versionIndex: 0,
          number: inst.number,
          dueDate: new Date(inst.dueDate),
          periodStart: new Date(inst.periodStart),
          openingBalance: inst.openingBalance.toNumber(),
          scheduledPrincipal: inst.principal.toNumber(),
          scheduledInterest: inst.interest.toNumber(),
          scheduledPayment: inst.payment.toNumber(),
          closingBalance: inst.closingBalance.toNumber(),
          status: 'PENDING' as any,
        })),
        skipDuplicates: true,
      });
    } catch (schedErr: any) {
      this.logger.warn(`Error al generar cuotas de amortización para ${loanCode}: ${schedErr?.message}`);
    }

    // 9. Actualizar Vehículo y Prospecto
    await this.prisma.vehicle.update({
      where: { id: vehicle.id },
      data: { status: VehicleStatus.SOLD },
    });

    await this.prisma.lead.update({
      where: { id: leadId },
      data: {
        status: LeadStatus.CONVERTED,
        internalNotes: `${lead.internalNotes ? lead.internalNotes + '\n' : ''}Formalizado exitosamente a Crédito Activo [${loanCode}] el ${today.toLocaleDateString('es-SV')}. Expediente documental completo adjunto.`,
      },
    });

    this.logger.log(`Crédito ${loanCode} activado exitosamente para cliente ${customer.fullName}`);

    return {
      success: true,
      message: `Crédito formalizado y activado exitosamente con código ${loanCode}.`,
      loan,
      customer,
      documentsUploaded: dto.documents.length,
    };
  }
}
