import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VehicleStatus, Prisma } from '@prisma/client';
import { CreateVehicleDto, UpdateVehicleDto, VehicleFilterDto, VehicleImageDto } from './vehicle.dto';
import { nextSequentialCode, withUniqueRetry } from '../common/codes';
import { DRIVE_FOLDERS, GoogleDriveService } from '../storage/google-drive.service';

const IMAGE_ORDER: Prisma.VehicleImageOrderByWithRelationInput[] = [{ isPrimary: 'desc' }, { sortOrder: 'asc' }];

/** Ruta (relativa a la API) con la que se publican las fotos guardadas en Google Drive */
const DRIVE_IMAGE_PATH = 'media/vehicle-images/';
const DATA_URL_RE = /^data:(image\/[\w.+-]+);base64,(.+)$/s;

type VehicleRef = { code: string; brand: string; model: string; year: number };
type ImageRow = { url: string; caption?: string; driveFileId: string | null; isPrimary: boolean; sortOrder: number };

@Injectable()
export class VehiclesService {
  private readonly logger = new Logger(VehiclesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: GoogleDriveService,
  ) {}

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

  /**
   * Prepara las filas de imágenes. Con Google Drive activo, las fotos cargadas desde el equipo (data URL)
   * se suben a VELTOR/Vehiculos/<código - vehículo> y se publican por la API; las URL externas se guardan tal cual.
   * Si Drive falla, la foto se conserva embebida para no perder la carga del usuario.
   */
  private async prepareImages(vehicle: VehicleRef, images: VehicleImageDto[], existing: { url: string; driveFileId: string | null }[] = []) {
    const rows: ImageRow[] = [];
    for (const [idx, img] of images.entries()) {
      const row: ImageRow = { url: img.url, caption: img.caption, driveFileId: null, isPrimary: idx === 0, sortOrder: idx };
      const kept = existing.find((e) => e.url === img.url && e.driveFileId);
      const data = DATA_URL_RE.exec(img.url);
      if (kept) {
        row.driveFileId = kept.driveFileId;
      } else if (data && this.drive.isEnabled()) {
        try {
          const ext = data[1].split('/')[1].replace('jpeg', 'jpg');
          const file = await this.drive.upload(
            [DRIVE_FOLDERS.vehicles, `${vehicle.code} - ${vehicle.brand} ${vehicle.model} ${vehicle.year}`],
            `${vehicle.code}_foto-${idx + 1}_${Date.now()}.${ext}`,
            data[1],
            Buffer.from(data[2], 'base64'),
          );
          row.driveFileId = file.id;
          row.url = DRIVE_IMAGE_PATH + file.id;
        } catch (err: any) {
          this.logger.error(`No se pudo subir la foto ${idx + 1} de ${vehicle.code} a Drive: ${err?.message || err}`);
        }
      }
      rows.push(row);
    }
    return rows;
  }

  /** Envía a la papelera de Drive las fotos que ya no usa ningún vehículo */
  private async trashUnused(previous: { driveFileId: string | null }[], current: ImageRow[]) {
    const keep = new Set(current.map((r) => r.driveFileId).filter(Boolean));
    for (const p of previous) {
      if (p.driveFileId && !keep.has(p.driveFileId)) await this.drive.trash(p.driveFileId);
    }
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
        },
      });
    }).then(async (vehicle) => {
      if (images?.length) {
        const rows = await this.prepareImages(vehicle, images);
        await this.prisma.vehicleImage.createMany({ data: rows.map((r) => ({ ...r, vehicleId: vehicle.id })) });
      }
      return this.findOne(vehicle.id);
    });
  }

  async update(id: string, dto: UpdateVehicleDto) {
    const current = await this.findOne(id);
    this.validatePrices(
      dto.salePrice ?? Number(current.salePrice),
      dto.minDownPayment ?? Number(current.minDownPayment),
    );
    const { images, status, ...data } = dto;
    const rows = images ? await this.prepareImages({ ...current, ...data }, images, current.images) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (rows) {
        await tx.vehicleImage.deleteMany({ where: { vehicleId: id } });
        if (rows.length) {
          await tx.vehicleImage.createMany({ data: rows.map((r) => ({ ...r, vehicleId: id })) });
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
    if (rows) await this.trashUnused(current.images, rows);
    return updated;
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
