import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VehicleStatus, Prisma } from '@prisma/client';
import { CreateVehicleDto, UpdateVehicleDto, VehicleFilterDto, VehicleImageDto } from './vehicle.dto';
import { nextSequentialCode, withUniqueRetry } from '../common/codes';

const IMAGE_ORDER: Prisma.VehicleImageOrderByWithRelationInput[] = [{ isPrimary: 'desc' }, { sortOrder: 'asc' }];

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllPublic(filters: VehicleFilterDto) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 12;
    const skip = (page - 1) * limit;

    const where: Prisma.VehicleWhereInput = {
      isPublished: true,
      status: VehicleStatus.AVAILABLE,
    };

    if (filters.brand) where.brand = { contains: filters.brand, mode: 'insensitive' };
    if (filters.model) where.model = { contains: filters.model, mode: 'insensitive' };
    if (filters.year) where.year = filters.year;
    if (filters.minPrice || filters.maxPrice) {
      where.salePrice = {};
      if (filters.minPrice) where.salePrice.gte = filters.minPrice;
      if (filters.maxPrice) where.salePrice.lte = filters.maxPrice;
    }
    if (filters.transmission) where.transmission = filters.transmission;
    if (filters.fuel) where.fuel = filters.fuel;
    if (filters.type) where.type = { contains: filters.type, mode: 'insensitive' };

    const [total, items] = await Promise.all([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.findMany({
        where,
        // El costo de adquisición es confidencial y nunca se expone en el catálogo público
        omit: { costPrice: true },
        include: { images: { orderBy: IMAGE_ORDER } },
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

  async findPublished(id: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, isPublished: true },
      omit: { costPrice: true },
      include: { images: { orderBy: IMAGE_ORDER } },
    });
    if (!vehicle) throw new NotFoundException('Vehículo no encontrado');
    return vehicle;
  }

  async findOne(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: { images: { orderBy: IMAGE_ORDER } },
    });
    if (!vehicle) throw new NotFoundException('Vehículo no encontrado');
    return vehicle;
  }

  async findAllAdmin() {
    return this.prisma.vehicle.findMany({
      include: { images: { orderBy: IMAGE_ORDER } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private imagesCreate(images: VehicleImageDto[]) {
    return images.map((img, idx) => ({
      url: img.url,
      caption: img.caption,
      isPrimary: idx === 0,
      sortOrder: idx,
    }));
  }

  private validatePrices(salePrice: number, minDownPayment?: number) {
    if (minDownPayment !== undefined && minDownPayment > salePrice) {
      throw new BadRequestException('La prima mínima no puede ser mayor al precio de venta.');
    }
  }

  async create(dto: CreateVehicleDto) {
    this.validatePrices(dto.salePrice, dto.minDownPayment);
    const { images, ...data } = dto;

    return withUniqueRetry(async () => {
      const code = await nextSequentialCode(
        (prefix) =>
          this.prisma.vehicle.findFirst({ where: { code: { startsWith: prefix } }, orderBy: { code: 'desc' }, select: { code: true } }),
        'VEH',
        4,
      );
      return this.prisma.vehicle.create({
        data: {
          ...data,
          code,
          description: data.description ?? '',
          features: data.features ?? [],
          minDownPayment: data.minDownPayment ?? 0,
          images: images?.length ? { create: this.imagesCreate(images) } : undefined,
        },
        include: { images: { orderBy: IMAGE_ORDER } },
      });
    });
  }

  async update(id: string, dto: UpdateVehicleDto) {
    const current = await this.findOne(id);
    this.validatePrices(
      dto.salePrice ?? Number(current.salePrice),
      dto.minDownPayment ?? Number(current.minDownPayment),
    );
    const { images, status, ...data } = dto;

    return this.prisma.$transaction(async (tx) => {
      if (images) {
        await tx.vehicleImage.deleteMany({ where: { vehicleId: id } });
        if (images.length) {
          await tx.vehicleImage.createMany({
            data: this.imagesCreate(images).map((img) => ({ ...img, vehicleId: id })),
          });
        }
      }
      if (status && status !== current.status) {
        await tx.vehicleStatusHistory.create({
          data: { vehicleId: id, fromStatus: current.status, toStatus: status, reason: 'Edición de ficha' },
        });
      }
      return tx.vehicle.update({
        where: { id },
        data: { ...data, ...(status ? { status } : {}) },
        include: { images: { orderBy: IMAGE_ORDER } },
      });
    });
  }

  async changeStatus(id: string, toStatus: VehicleStatus, reason?: string, userId?: string) {
    const current = await this.findOne(id);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.vehicle.update({
        where: { id },
        data: { status: toStatus },
      });

      await tx.vehicleStatusHistory.create({
        data: {
          vehicleId: id,
          fromStatus: current.status,
          toStatus,
          reason,
          changedByUserId: userId,
        },
      });

      return updated;
    });
  }
}
