import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PersonType, CustomerStatus, Prisma, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';
import { CreateCustomerDto, CustomerQueryDto, UpdateCustomerDto } from './customer.dto';
import { nextSequentialCode, withUniqueRetry } from '../common/codes';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: CustomerQueryDto = {}) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.search) {
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
        applications: { include: { vehicle: true, product: true } },
        loans: { include: { vehicle: true } },
        user: { select: { id: true, email: true, isActive: true } },
      },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');
    return customer;
  }

  async create(dto: CreateCustomerDto) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.customer.findFirst({
      where: { OR: [{ dui: dto.dui }, { email }] },
    });
    if (existing) {
      throw new ConflictException('Ya existe un cliente registrado con ese DUI o correo electrónico');
    }

    return withUniqueRetry(async () => {
      const code = await nextSequentialCode(
        (prefix) =>
          this.prisma.customer.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: 'desc' }, select: { code: true } }),
        'CLI',
      );
      return this.prisma.customer.create({
        data: {
          code,
          fullName: dto.fullName,
          personType: dto.personType || PersonType.NATURAL,
          dui: dto.dui,
          nit: dto.nit,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
          phone: dto.phone,
          email,
          address: dto.address,
          municipality: dto.municipality,
          department: dto.department,
          economicActivity: dto.economicActivity,
          employerName: dto.employerName,
          monthlyIncome: dto.monthlyIncome,
          declaredDebts: dto.declaredDebts || 0,
          status: CustomerStatus.ACTIVE,
          internalNotes: dto.internalNotes,
        },
      });
    });
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: {
        ...dto,
        email: dto.email?.toLowerCase().trim(),
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
      },
    });
  }

  /** Crea (o restablece) el usuario del portal del cliente con una contraseña temporal. */
  async grantPortalAccess(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { user: true },
    });
    if (!customer) throw new NotFoundException('Cliente no encontrado');

    const email = customer.email.toLowerCase().trim();
    const emailOwner = await this.prisma.user.findUnique({ where: { email } });
    if (emailOwner && emailOwner.customerId !== customer.id) {
      throw new ConflictException('El correo del cliente ya está en uso por otro usuario del sistema.');
    }

    const temporaryPassword = AuthService.generateTemporaryPassword();
    const passwordHash = await argon2.hash(temporaryPassword);

    if (customer.user) {
      await this.prisma.user.update({
        where: { id: customer.user.id },
        data: { email, passwordHash, isActive: true, mustChangePass: true },
      });
    } else {
      await this.prisma.user.create({
        data: {
          email,
          fullName: customer.fullName,
          phone: customer.phone,
          role: UserRole.CUSTOMER,
          passwordHash,
          isActive: true,
          mustChangePass: true,
          customerId: customer.id,
        },
      });
    }

    return {
      email,
      temporaryPassword,
      message: 'Acceso al portal habilitado. Entregue la contraseña temporal al cliente; se le pedirá cambiarla al ingresar.',
    };
  }
}
