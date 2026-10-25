import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VehicleStatus, VehicleTransmission, VehicleFuel, Prisma } from '@prisma/client';

export interface VehicleFilterDto {
  brand?: string;
  model?: string;
  year?: number;
  minPrice?: number;
  maxPrice?: number;
  transmission?: VehicleTransmission;
  fuel?: VehicleFuel;
  type?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAllPublic(filters: VehicleFilterDto) {
    const page = filters.page && filters.page > 0 ? Number(filters.page) : 1;
    const limit = filters.limit && filters.limit > 0 ? Number(filters.limit) : 12;
    const skip = (page - 1) * limit;

    const where: Prisma.VehicleWhereInput = {
      isPublished: true,
      status: VehicleStatus.AVAILABLE,
    };

    if (filters.brand) {
      where.brand = { contains: filters.brand, mode: 'insensitive' };
    }
    if (filters.model) {
      where.model = { contains: filters.model, mode: 'insensitive' };
    }
    if (filters.year) {
      where.year = Number(filters.year);
    }
    if (filters.minPrice || filters.maxPrice) {
      where.salePrice = {};
      if (filters.minPrice) where.salePrice.gte = filters.minPrice;
      if (filters.maxPrice) where.salePrice.lte = filters.maxPrice;
    }
    if (filters.transmission) {
      where.transmission = filters.transmission;
    }
    if (filters.fuel) {
      where.fuel = filters.fuel;
    }
    if (filters.type) {
      where.type = { contains: filters.type, mode: 'insensitive' };
    }

    const [total, items] = await Promise.all([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.findMany({
        where,
        include: {
          images: {
            orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: {
        images: {
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
        },
      },
    });
    if (!vehicle) throw new NotFoundException('Vehículo no encontrado');
    return vehicle;
  }

  async findAllAdmin() {
    return this.prisma.vehicle.findMany({
      include: {
        images: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: Prisma.VehicleCreateInput) {
    return this.prisma.vehicle.create({
      data,
      include: { images: true },
    });
  }

  async update(id: string, data: Prisma.VehicleUpdateInput) {
    await this.findOne(id);
    return this.prisma.vehicle.update({
      where: { id },
      data,
      include: { images: true },
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
