import { IsString, IsNotEmpty, IsEnum, IsOptional, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseCategoryType, ExpenseStatus } from '@prisma/client';

export class CreateExpenseDto {
  @ApiProperty({ description: 'Concepto o descripción del gasto', example: 'Llantas de reemplazo para inventario' })
  @IsString()
  @IsNotEmpty()
  concept!: string;

  @ApiProperty({ enum: ExpenseCategoryType, description: 'Tipo de gasto: PRODUCT o SERVICE', example: 'PRODUCT' })
  @IsEnum(ExpenseCategoryType)
  categoryType!: ExpenseCategoryType;

  @ApiPropertyOptional({ description: 'Subcategoría del gasto', example: 'Repuestos' })
  @IsString()
  @IsOptional()
  subcategory?: string;

  @ApiPropertyOptional({ description: 'Cantidad de unidades adquiridas', example: 4, default: 1 })
  @IsNumber()
  @IsOptional()
  @Min(0.01)
  quantity?: number;

  @ApiProperty({ description: 'Precio unitario en USD', example: 75.0 })
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiPropertyOptional({ description: 'Monto total en USD (si se omite se calcula quantity * unitPrice)', example: 300.0 })
  @IsNumber()
  @IsOptional()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ description: 'Fecha del gasto (ISO string o YYYY-MM-DD)', example: '2026-10-27' })
  @IsString()
  @IsOptional()
  expenseDate?: string;

  @ApiPropertyOptional({ description: 'Proveedor o beneficiario', example: 'Llantas y Servicios de El Salvador S.A.' })
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiPropertyOptional({ description: 'Número de factura o comprobante fiscal', example: 'CCF-2026-8819' })
  @IsString()
  @IsOptional()
  invoiceNumber?: string;

  @ApiPropertyOptional({ description: 'Método de pago utilizado', example: 'TRANSFER' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiPropertyOptional({ enum: ExpenseStatus, description: 'Estado del gasto', example: 'PAID', default: 'PAID' })
  @IsEnum(ExpenseStatus)
  @IsOptional()
  status?: ExpenseStatus;

  @ApiPropertyOptional({ description: 'Notas u observaciones contables' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateExpenseDto {
  @ApiPropertyOptional({ description: 'Concepto o descripción del gasto' })
  @IsString()
  @IsOptional()
  concept?: string;

  @ApiPropertyOptional({ enum: ExpenseCategoryType, description: 'Tipo de gasto: PRODUCT o SERVICE' })
  @IsEnum(ExpenseCategoryType)
  @IsOptional()
  categoryType?: ExpenseCategoryType;

  @ApiPropertyOptional({ description: 'Subcategoría del gasto' })
  @IsString()
  @IsOptional()
  subcategory?: string;

  @ApiPropertyOptional({ description: 'Cantidad' })
  @IsNumber()
  @IsOptional()
  @Min(0.01)
  quantity?: number;

  @ApiPropertyOptional({ description: 'Precio unitario' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({ description: 'Monto total' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ description: 'Fecha del gasto' })
  @IsString()
  @IsOptional()
  expenseDate?: string;

  @ApiPropertyOptional({ description: 'Proveedor' })
  @IsString()
  @IsOptional()
  provider?: string;

  @ApiPropertyOptional({ description: 'Número de factura o comprobante fiscal' })
  @IsString()
  @IsOptional()
  invoiceNumber?: string;

  @ApiPropertyOptional({ description: 'Método de pago' })
  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @ApiPropertyOptional({ enum: ExpenseStatus, description: 'Estado del gasto' })
  @IsEnum(ExpenseStatus)
  @IsOptional()
  status?: ExpenseStatus;

  @ApiPropertyOptional({ description: 'Notas u observaciones' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class QueryExpenseDto {
  @ApiPropertyOptional({ enum: ExpenseCategoryType, description: 'Filtrar por PRODUCT o SERVICE' })
  @IsEnum(ExpenseCategoryType)
  @IsOptional()
  categoryType?: ExpenseCategoryType;

  @ApiPropertyOptional({ enum: ExpenseStatus, description: 'Filtrar por PAID, PENDING, CANCELLED' })
  @IsEnum(ExpenseStatus)
  @IsOptional()
  status?: ExpenseStatus;

  @ApiPropertyOptional({ description: 'Buscar por concepto, proveedor o factura' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ description: 'Fecha inicio YYYY-MM-DD' })
  @IsString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Fecha fin YYYY-MM-DD' })
  @IsString()
  @IsOptional()
  endDate?: string;
}
