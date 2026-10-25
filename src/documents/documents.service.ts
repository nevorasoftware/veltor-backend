import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentCategory, DocumentStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

export interface UploadDocumentDto {
  customerId: string;
  category: DocumentCategory;
  title: string;
  notes?: string;
  uploadedById?: string;
  issueDate?: string;
  expiryDate?: string;
}

export interface UpdateDocumentStatusDto {
  status: DocumentStatus;
  rejectionReason?: string;
  notes?: string;
}

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly uploadDir = path.resolve(process.cwd(), 'uploads', 'documents');

  constructor(private readonly prisma: PrismaService) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async uploadCustomerDocument(
    dto: UploadDocumentDto,
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo no adjunto o inválido');
    }

    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
    });
    if (!customer) {
      throw new NotFoundException(`Cliente con ID ${dto.customerId} no encontrado`);
    }

    // Generar nombre seguro de archivo
    const timestamp = Date.now();
    const ext = path.extname(file.originalname).toLowerCase();
    const safeBaseName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    const storedFileName = `${customer.code}_${dto.category}_${timestamp}${ext}`;
    const filePath = path.join(this.uploadDir, storedFileName);

    // Guardar archivo en disco
    await fs.promises.writeFile(filePath, file.buffer);

    this.logger.log(`Documento guardado: ${filePath} (${file.size} bytes)`);

    // Crear registro en base de datos
    return this.prisma.customerDocument.create({
      data: {
        customerId: dto.customerId,
        category: dto.category,
        title: dto.title || `${dto.category} - ${file.originalname}`,
        fileKey: storedFileName,
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSizeBytes: file.size,
        status: DocumentStatus.PENDING,
        notes: dto.notes,
        issueDate: dto.issueDate ? new Date(dto.issueDate) : null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        uploadedById: dto.uploadedById,
      },
    });
  }

  async getCustomerDocuments(customerId: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException(`Cliente con ID ${customerId} no encontrado`);
    }

    return this.prisma.customerDocument.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: {
          select: { id: true, fullName: true, email: true, role: true },
        },
      },
    });
  }

  async getDocumentFile(id: string) {
    const doc = await this.prisma.customerDocument.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!doc) {
      throw new NotFoundException(`Documento con ID ${id} no encontrado`);
    }

    const filePath = path.join(this.uploadDir, doc.fileKey);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('El archivo físico no se encuentra en el servidor de almacenamiento');
    }

    const stream = fs.createReadStream(filePath);
    return {
      stream,
      document: doc,
    };
  }

  async updateStatus(id: string, dto: UpdateDocumentStatusDto) {
    const doc = await this.prisma.customerDocument.findUnique({ where: { id } });
    if (!doc) {
      throw new NotFoundException(`Documento con ID ${id} no encontrado`);
    }

    return this.prisma.customerDocument.update({
      where: { id },
      data: {
        status: dto.status,
        rejectionReason: dto.rejectionReason,
        notes: dto.notes ? `${doc.notes ? doc.notes + '\n' : ''}${dto.notes}` : doc.notes,
      },
    });
  }

  async deleteDocument(id: string) {
    const doc = await this.prisma.customerDocument.findUnique({ where: { id } });
    if (!doc) {
      throw new NotFoundException(`Documento con ID ${id} no encontrado`);
    }

    const filePath = path.join(this.uploadDir, doc.fileKey);
    if (fs.existsSync(filePath)) {
      try {
        await fs.promises.unlink(filePath);
      } catch (err) {
        this.logger.warn(`No se pudo eliminar el archivo físico ${filePath}: ${err}`);
      }
    }

    return this.prisma.customerDocument.delete({
      where: { id },
    });
  }
}
