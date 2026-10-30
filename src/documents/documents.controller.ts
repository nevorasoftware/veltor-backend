import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Res,
  Request,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { Response } from 'express';
import { DocumentsService } from './documents.service';
import { MAX_DOCUMENT_BYTES } from './documents.constants';
import { DocumentCategory, DocumentStatus, UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UploadDocumentBodyDto {
  @IsEnum(DocumentCategory)
  @IsNotEmpty()
  category!: DocumentCategory;

  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  issueDate?: string;

  @IsString()
  @IsOptional()
  expiryDate?: string;
}

export class UpdateStatusBodyDto {
  @IsEnum(DocumentStatus)
  @IsNotEmpty()
  status!: DocumentStatus;

  @IsString()
  @IsOptional()
  rejectionReason?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

@ApiTags('Expedientes y Documentos')
@Controller()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('customers/:customerId/documents')
  @ApiOperation({ summary: 'Subir documento a expediente de cliente (DUI, NIT, boleta de pago, etc.)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_BYTES },
    }),
  )
  async uploadDocument(
    @Param('customerId') customerId: string,
    @Body() body: UploadDocumentBodyDto,
    @UploadedFile() file: Express.Multer.File,
    @Request() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('Se requiere adjuntar un archivo (campo "file")');
    }

    const uploadedById = req.user?.id || undefined;

    return this.documentsService.uploadCustomerDocument(
      {
        customerId,
        category: body.category,
        title: body.title || `${body.category}`,
        notes: body.notes,
        issueDate: body.issueDate,
        expiryDate: body.expiryDate,
        uploadedById,
      },
      file,
    );
  }

  @Get('customers/:customerId/documents')
  @ApiOperation({ summary: 'Listar todos los documentos cargados en el expediente de un cliente' })
  async getCustomerDocuments(@Param('customerId') customerId: string) {
    return this.documentsService.getCustomerDocuments(customerId);
  }

  @Get('documents/:id/download')
  @ApiOperation({ summary: 'Descargar o previsualizar archivo adjunto del expediente' })
  async downloadDocument(@Param('id') id: string, @Res() res: Response) {
    const { stream, document } = await this.documentsService.getDocumentFile(id);

    res.set({
      'Content-Type': document.mimeType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
      'Content-Length': document.fileSizeBytes,
    });

    stream.pipe(res);
  }

  @Post('finance/loans/:id/drive/archive')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Archivar en Google Drive el expediente y la tabla de amortización de un crédito' })
  async archiveLoan(@Param('id') id: string) {
    return this.documentsService.archiveLoanToDrive(id);
  }

  @Patch('documents/:id/status')
  @ApiOperation({ summary: 'Aprobar o rechazar documento por parte de oficial o analista de crédito' })
  async updateStatus(@Param('id') id: string, @Body() body: UpdateStatusBodyDto) {
    return this.documentsService.updateStatus(id, body);
  }

  @Delete('documents/:id')
  @ApiOperation({ summary: 'Eliminar documento del expediente' })
  async deleteDocument(@Param('id') id: string) {
    return this.documentsService.deleteDocument(id);
  }
}
