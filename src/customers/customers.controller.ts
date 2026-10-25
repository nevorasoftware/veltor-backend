import { Controller, Get, Post, Put, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { CustomersService, CreateCustomerDto } from './customers.service';
import { CustomerStatus } from '@prisma/client';

@ApiTags('Gestión de Clientes')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'Listar y filtrar clientes con paginación' })
  async findAll(@Query() query: { search?: string; status?: CustomerStatus; page?: number; limit?: number }) {
    return this.customersService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar expediente de cliente completo con documentos y créditos' })
  async findOne(@Param('id') id: string) {
    return this.customersService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear nuevo cliente' })
  async create(@Body() dto: CreateCustomerDto) {
    return this.customersService.create(dto);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar información del cliente' })
  async update(@Param('id') id: string, @Body() dto: Partial<CreateCustomerDto>) {
    return this.customersService.update(id, dto);
  }
}
