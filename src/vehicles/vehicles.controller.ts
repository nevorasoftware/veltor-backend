import { Controller, Get, Post, Put, Patch, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { VehiclesService } from './vehicles.service';
import { ChangeVehicleStatusDto, CreateVehicleDto, UpdateVehicleDto, VehicleFilterDto } from './vehicle.dto';
import { Public } from '../auth/public.decorator';

@ApiTags('Catálogo de Vehículos')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Consultar catálogo público de vehículos disponibles' })
  async getPublicCatalog(@Query() query: VehicleFilterDto) {
    return this.vehiclesService.findAllPublic(query);
  }

  @Get('admin/all')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar todos los vehículos para gestión administrativa' })
  async getAllAdmin() {
    return this.vehiclesService.findAllAdmin();
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Consultar ficha detallada y galería de un vehículo publicado' })
  async getDetail(@Param('id') id: string) {
    return this.vehiclesService.findPublished(id);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Crear nuevo vehículo en inventario' })
  async createVehicle(@Body() body: CreateVehicleDto) {
    return this.vehiclesService.create(body);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Actualizar datos de un vehículo' })
  async updateVehicle(@Param('id') id: string, @Body() body: UpdateVehicleDto) {
    return this.vehiclesService.update(id, body);
  }

  @Patch(':id/status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cambiar estado de disponibilidad del vehículo' })
  async changeStatus(@Param('id') id: string, @Body() body: ChangeVehicleStatusDto, @Request() req: any) {
    return this.vehiclesService.changeStatus(id, body.status, body.reason, req.user?.id);
  }
}
