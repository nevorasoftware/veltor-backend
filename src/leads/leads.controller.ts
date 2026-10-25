import { Controller, Post, Get, Patch, Put, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LeadsService, CreateLeadDto, UpdateLeadDto, ConvertLeadToLoanDto } from './leads.service';
import { LeadStatus } from '@prisma/client';

@ApiTags('Prospectos (Leads)')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @ApiOperation({ summary: 'Captación pública de prospectos sin requerir registro' })
  @ApiResponse({ status: 201, description: 'Prospecto registrado exitosamente en el sistema' })
  async create(@Body() dto: CreateLeadDto) {
    return this.leadsService.createPublicLead(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listado administrativo de prospectos' })
  async findAll(@Query('status') status?: LeadStatus) {
    return this.leadsService.findAll(status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar detalle de un prospecto' })
  async findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Editar datos completos y estado de seguimiento del prospecto' })
  async update(@Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.updateLead(id, dto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Actualizar estado del prospecto y notas de seguimiento' })
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: LeadStatus; internalNotes?: string; assignedToUserId?: string },
  ) {
    return this.leadsService.updateStatus(id, body.status, body.internalNotes, body.assignedToUserId);
  }

  @Post(':id/convert-to-loan')
  @ApiOperation({
    summary: 'Formalizar prospecto a Crédito Activo requiriendo los 4 documentos obligatorios del cliente',
  })
  async convertToLoan(@Param('id') id: string, @Body() dto: ConvertLeadToLoanDto) {
    return this.leadsService.convertLeadToLoan(id, dto);
  }
}
