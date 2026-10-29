import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpCode, HttpStatus, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto, UpdateExpenseDto, QueryExpenseDto } from './dto/expense.dto';

@ApiTags('Control de Gastos y Contabilidad')
@ApiBearerAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Obtener contabilización y resumen consolidado de gastos por productos y servicios' })
  @ApiResponse({ status: 200, description: 'Resumen contable calculado exitosamente' })
  async getSummary() {
    return this.expensesService.getSummary();
  }

  @Get()
  @ApiOperation({ summary: 'Listar gastos con filtros por tipo (producto/servicio), estado y fecha' })
  async findAll(@Query() query: QueryExpenseDto) {
    return this.expensesService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar detalle de un gasto específico' })
  async findOne(@Param('id') id: string) {
    return this.expensesService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar un nuevo gasto (producto o servicio) en la contabilidad' })
  async create(@Body() dto: CreateExpenseDto, @Request() req: any) {
    return this.expensesService.create(dto, req.user.id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar información o estado de un gasto' })
  async update(@Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.expensesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un registro de gasto' })
  async remove(@Param('id') id: string) {
    return this.expensesService.remove(id);
  }
}
