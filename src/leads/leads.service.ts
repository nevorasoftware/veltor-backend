import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeadStatus, LeadSource } from '@prisma/client';
import { IsNotEmpty, IsString, IsEmail, IsOptional, IsNumber, IsBoolean } from 'class-validator';

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

@Injectable()
export class LeadsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async updateStatus(id: string, status: LeadStatus, internalNotes?: string, assignedToUserId?: string) {
    const lead = await this.prisma.lead.findUnique({ where: { id } });
    if (!lead) throw new NotFoundException('Prospecto no encontrado');

    return this.prisma.lead.update({
      where: { id },
      data: {
        status,
        internalNotes: internalNotes ?? lead.internalNotes,
        assignedToUserId: assignedToUserId ?? lead.assignedToUserId,
      },
    });
  }
}
