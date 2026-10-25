import { Controller, Post, Get, Patch, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { LeadsService, CreateLeadDto } from './leads.service';
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

  @Patch(':id/status')
  @ApiOperation({ summary: 'Actualizar estado del prospecto y notas de seguimiento' })
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: LeadStatus; internalNotes?: string; assignedToUserId?: string },
  ) {
    return this.leadsService.updateStatus(id, body.status, body.internalNotes, body.assignedToUserId);
  }
}
