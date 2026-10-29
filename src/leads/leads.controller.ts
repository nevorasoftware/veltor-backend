import { Controller, Post, Get, Patch, Put, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { LeadsService, CreateLeadDto, UpdateLeadDto, UpdateLeadStatusDto, ConvertLeadToLoanDto } from './leads.service';
import { LeadStatus } from '@prisma/client';
import { Public } from '../auth/public.decorator';

@ApiTags('Prospectos (Leads)')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  @ApiOperation({ summary: 'Captación pública de prospectos sin requerir registro' })
  @ApiResponse({ status: 201, description: 'Prospecto registrado exitosamente en el sistema' })
  async create(@Body() dto: CreateLeadDto) {
    return this.leadsService.createPublicLead(dto);
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listado administrativo de prospectos' })
  async findAll(@Query('status') status?: LeadStatus) {
    return this.leadsService.findAll(status);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Consultar detalle de un prospecto' })
  async findOne(@Param('id') id: string) {
    return this.leadsService.findOne(id);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Editar datos completos y estado de seguimiento del prospecto' })
  async update(@Param('id') id: string, @Body() dto: UpdateLeadDto) {
    return this.leadsService.updateLead(id, dto);
  }

  @Patch(':id/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar estado del prospecto y notas de seguimiento' })
  async updateStatus(@Param('id') id: string, @Body() body: UpdateLeadStatusDto) {
    return this.leadsService.updateLead(id, body);
  }

  @Post(':id/convert-to-loan')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Formalizar prospecto a Crédito Activo requiriendo los 5 documentos obligatorios del cliente',
  })
  async convertToLoan(@Param('id') id: string, @Body() dto: ConvertLeadToLoanDto) {
    return this.leadsService.convertLeadToLoan(id, dto);
  }
}
