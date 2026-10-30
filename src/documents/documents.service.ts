import { Injectable, NotFoundException, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentCategory, DocumentStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { ALLOWED_DOCUMENT_MIME_TYPES, DOCUMENTS_UPLOAD_DIR } from './documents.constants';
import { DomainEvents } from '../common/domain-events';
import { PdfService } from '../pdf/pdf.service';
import { todayInTz } from '../finance/engine';
import { DRIVE_FOLDERS, DRIVE_KEY_PREFIX, GoogleDriveService } from '../storage/google-drive.service';

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

const driveId = (fileKey: string) => (fileKey.startsWith(DRIVE_KEY_PREFIX) ? fileKey.slice(DRIVE_KEY_PREFIX.length) : null);

/** Carpeta de un crédito en Drive: VELTOR/Creditos/<número de crédito> - <cliente> */
export const loanFolderPath = (loan: { code: string; customer: { fullName: string } }) => [
  DRIVE_FOLDERS.loans,
  `${loan.code} - ${loan.customer.fullName}`,
];

@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly logger = new Logger(DocumentsService.name);
  private readonly uploadDir = DOCUMENTS_UPLOAD_DIR;

  constructor(
    private readonly prisma: PrismaService,
    private readonly drive: GoogleDriveService,
    private readonly events: DomainEvents,
    private readonly pdf: PdfService,
  ) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  onModuleInit() {
    // Al aprobar un crédito, su expediente y la tabla de amortización se archivan en la carpeta del crédito
    this.events.on('loan.activated', ({ loanId }) => this.archiveLoanToDrive(loanId));
  }

  /** Carpeta del expediente: la del crédito más reciente del cliente o, si no tiene, VELTOR/Clientes/<cliente> */
  private async customerFolderPath(customer: { id: string; code: string; fullName: string }) {
    const loan = await this.prisma.loan.findFirst({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'desc' },
      select: { code: true },
    });
    return loan
      ? loanFolderPath({ code: loan.code, customer })
      : [DRIVE_FOLDERS.customers, `${customer.code} - ${customer.fullName}`];
  }

  async uploadCustomerDocument(
    dto: UploadDocumentDto,
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo no adjunto o inválido');
    }
    if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException('Tipo de archivo no permitido. Use PDF, JPG, PNG o WEBP.');
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
    const storedFileName = `${customer.code}_${dto.category}_${timestamp}_${Math.floor(Math.random() * 1e6)}${ext}`;

    let fileKey = storedFileName;
    if (this.drive.isEnabled()) {
      const uploaded = await this.drive.upload(await this.customerFolderPath(customer), storedFileName, file.mimetype, file.buffer);
      fileKey = DRIVE_KEY_PREFIX + uploaded.id;
    } else {
      const filePath = path.join(this.uploadDir, storedFileName);
      await fs.promises.writeFile(filePath, file.buffer);
      this.logger.log(`Documento guardado: ${filePath} (${file.size} bytes)`);
    }

    // Crear registro en base de datos
    return this.prisma.customerDocument.create({
      data: {
        customerId: dto.customerId,
        category: dto.category,
        title: dto.title || `${dto.category} - ${file.originalname}`,
        fileKey,
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

    const fileId = driveId(doc.fileKey);
    if (fileId) {
      const { content } = await this.drive.download(fileId).catch((err) => {
        this.logger.error(`No se pudo descargar ${doc.fileKey} de Drive: ${err?.message || err}`);
        throw new NotFoundException('El archivo no está disponible en Google Drive');
      });
      return { stream: Readable.from(content), document: doc };
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

    const fileId = driveId(doc.fileKey);
    if (fileId) {
      await this.drive.trash(fileId);
    } else {
      const filePath = path.join(this.uploadDir, doc.fileKey);
      if (fs.existsSync(filePath)) {
        try {
          await fs.promises.unlink(filePath);
        } catch (err) {
          this.logger.warn(`No se pudo eliminar el archivo físico ${filePath}: ${err}`);
        }
      }
    }

    return this.prisma.customerDocument.delete({
      where: { id },
    });
  }

  /**
   * Archiva en Google Drive el expediente de un crédito: crea VELTOR/Creditos/<número de crédito> - <cliente>,
   * mueve allí los documentos del cliente que siguen en el servidor y guarda la tabla de amortización vigente.
   * Es idempotente: los documentos ya archivados no se vuelven a subir.
   */
  async archiveLoanToDrive(loanId: string) {
    if (!this.drive.isEnabled()) {
      return { enabled: false, message: 'Google Drive no está activo (STORAGE_DRIVER=gdrive).' };
    }
    const loan = await this.prisma.loan.findUnique({ where: { id: loanId }, include: { customer: true } });
    if (!loan) throw new NotFoundException('Crédito no encontrado');

    const folderPath = loanFolderPath(loan);
    const folderId = await this.drive.ensureFolder(folderPath);
    if (loan.driveFolderId !== folderId) {
      await this.prisma.loan.update({ where: { id: loan.id }, data: { driveFolderId: folderId } });
    }

    const docs = await this.prisma.customerDocument.findMany({
      where: { customerId: loan.customerId, NOT: { fileKey: { startsWith: DRIVE_KEY_PREFIX } } },
    });
    let moved = 0;
    const missing: string[] = [];
    for (const doc of docs) {
      const filePath = path.join(this.uploadDir, doc.fileKey);
      if (!fs.existsSync(filePath)) {
        missing.push(doc.fileName);
        continue;
      }
      const uploaded = await this.drive.upload(folderPath, doc.fileKey, doc.mimeType, await fs.promises.readFile(filePath));
      await this.prisma.customerDocument.update({ where: { id: doc.id }, data: { fileKey: DRIVE_KEY_PREFIX + uploaded.id } });
      await fs.promises.unlink(filePath).catch(() => undefined);
      moved++;
    }

    let schedule = false;
    try {
      const pdf = await this.pdf.generateAmortizationSchedulePdf(loan.id);
      await this.drive.upload(folderPath, `Tabla de amortizacion ${loan.code} al ${todayInTz()}.pdf`, 'application/pdf', pdf);
      schedule = true;
    } catch (err: any) {
      this.logger.warn(`No se pudo archivar la tabla de amortización de ${loan.code}: ${err?.message || err}`);
    }

    if (missing.length) {
      this.logger.warn(`Expediente de ${loan.code}: ${missing.length} archivo(s) ya no estaban en el servidor (${missing.join(', ')})`);
    }
    this.logger.log(`Expediente de ${loan.code} archivado en Drive: ${moved} documento(s)${schedule ? ' y tabla de amortización' : ''}`);
    return {
      enabled: true,
      folderUrl: this.drive.folderUrl(folderId),
      documentsMoved: moved,
      missingFiles: missing,
      amortizationSchedule: schedule,
    };
  }
}
