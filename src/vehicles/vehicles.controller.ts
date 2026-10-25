import { Controller, Get, Post, Put, Patch, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { VehiclesService, VehicleFilterDto } from './vehicles.service';
import { VehicleStatus, VehicleTransmission, VehicleFuel } from '@prisma/client';

@ApiTags('Catálogo de Vehículos')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Get()
  @ApiOperation({ summary: 'Consultar catálogo público de vehículos disponibles' })
  async getPublicCatalog(@Query() query: VehicleFilterDto) {
    return this.vehiclesService.findAllPublic(query);
  }

  @Get('admin/all')
  @ApiOperation({ summary: 'Listar todos los vehículos para gestión administrativa' })
  async getAllAdmin() {
    return this.vehiclesService.findAllAdmin();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar ficha detallada y galería de un vehículo' })
  async getDetail(@Param('id') id: string) {
    return this.vehiclesService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear nuevo vehículo en inventario' })
  async createVehicle(@Body() body: any) {
    return this.vehiclesService.create(body);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar datos de un vehículo' })
  async updateVehicle(@Param('id') id: string, @Body() body: any) {
    return this.vehiclesService.update(id, body);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cambiar estado de disponibilidad del vehículo' })
  async changeStatus(
    @Param('id') id: string,
    @Body() body: { status: VehicleStatus; reason?: string },
    @Request() req: any,
  ) {
    const userId = req.user?.id;
    return this.vehiclesService.changeStatus(id, body.status, body.reason, userId);
  }
}
