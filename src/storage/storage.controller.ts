import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleDriveService } from './google-drive.service';

const CACHE_LIMIT = 60;

@ApiTags('Almacenamiento de Archivos')
@Controller()
export class StorageController {
  /** Caché en memoria de las fotos más consultadas del catálogo, para no ir a Drive en cada visita */
  private readonly cache = new Map<string, { content: Buffer; mimeType: string }>();

  constructor(
    private readonly drive: GoogleDriveService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('storage/status')
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Estado del almacenamiento en Google Drive (carpeta raíz del sistema)' })
  status() {
    return this.drive.status();
  }

  @Public()
  @Get('media/vehicle-images/:fileId')
  @ApiOperation({ summary: 'Foto de vehículo almacenada en Google Drive (pública, solo imágenes del catálogo)' })
  async vehicleImage(@Param('fileId') fileId: string, @Res() res: Response) {
    let file = this.cache.get(fileId);
    if (!file) {
      // Solo se sirven archivos registrados como foto de vehículo: nunca documentos de clientes
      const image = await this.prisma.vehicleImage.findUnique({ where: { driveFileId: fileId }, select: { id: true } });
      if (!image) throw new NotFoundException('Imagen no encontrada');
      file = await this.drive.download(fileId).catch(() => {
        throw new NotFoundException('La imagen no está disponible en el almacenamiento');
      });
      if (this.cache.size >= CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(fileId, file);
    }

    res.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.content.length),
      'Cache-Control': 'public, max-age=86400, immutable',
      // El catálogo se sirve desde otro dominio (frontend)
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.end(file.content);
  }
}
