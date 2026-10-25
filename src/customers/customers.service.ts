import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PersonType, CustomerStatus, Prisma } from '@prisma/client';

export interface CreateCustomerDto {
  fullName: string;
  personType?: PersonType;
  dui: string;
  nit?: string;
  birthDate?: string;
  phone: string;
  email: string;
  address: string;
  municipality?: string;
  department?: string;
  economicActivity: string;
  employerName?: string;
  monthlyIncome: number;
  declaredDebts?: number;
  internalNotes?: string;
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query?: { search?: string; status?: CustomerStatus; page?: number; limit?: number }) {
    const page = query?.page && query.page > 0 ? Number(query.page) : 1;
    const limit = query?.limit && query.limit > 0 ? Number(query.limit) : 10;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {};
    if (query?.status) where.status = query.status;
    if (query?.search) {
      where.OR = [
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { dui: { contains: query.search } },
        { phone: { contains: query.search } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        include: {
          documents: true,
          loans: { select: { id: true, code: true, status: true, currentPrincipalBalance: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      items,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        documents: true,
        applications: {
          include: { vehicle: true, product: true },
        },
        loans: {
          include: { vehicle: true },
        },
        user: { select: { id: true, email: true, isActive: true } },
      },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');
    return customer;
  }

  async create(dto: CreateCustomerDto) {
    const existing = await this.prisma.customer.findFirst({
      where: {
        OR: [{ dui: dto.dui }, { email: dto.email }],
      },
    });
    if (existing) {
      throw new ConflictException('Ya existe un cliente registrado con ese DUI o correo electrónico');
    }

    const code = `CLI-${Date.now().toString().slice(-6)}`;

    return this.prisma.customer.create({
      data: {
        code,
        fullName: dto.fullName,
        personType: dto.personType || PersonType.NATURAL,
        dui: dto.dui,
        nit: dto.nit,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        municipality: dto.municipality,
        department: dto.department || 'San Salvador',
        economicActivity: dto.economicActivity,
        employerName: dto.employerName,
        monthlyIncome: dto.monthlyIncome,
        declaredDebts: dto.declaredDebts || 0,
        status: CustomerStatus.ACTIVE,
        internalNotes: dto.internalNotes,
      },
    });
  }

  async update(id: string, dto: Partial<CreateCustomerDto>) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: {
        ...dto,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
      },
    });
  }
}
