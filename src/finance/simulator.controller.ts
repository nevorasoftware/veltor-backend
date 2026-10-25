import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IsNumber, IsString, IsEnum, IsOptional, Min, Max } from 'class-validator';
import { AmortizationMethod, DayCountBasis, PaymentFrequency, simulate, SimulationResult } from './engine';

export class SimulateLoanDto {
  @IsString()
  vehiclePrice!: string;

  @IsString()
  downPayment!: string;

  @IsString()
  @IsOptional()
  financedFees?: string;

  @IsString()
  @IsOptional()
  upfrontFees?: string;

  @IsString()
  monthlyRate!: string;

  @IsNumber()
  @Min(1)
  @Max(600)
  termCount!: number;

  @IsString()
  startDate!: string;

  @IsString()
  firstDueDate!: string;

  @IsEnum(['FRENCH', 'CONSTANT_PRINCIPAL'])
  @IsOptional()
  method?: AmortizationMethod;

  @IsEnum(['D30_360', 'ACT_360', 'ACT_365'])
  @IsOptional()
  dayCount?: DayCountBasis;

  @IsEnum(['MONTHLY', 'BIWEEKLY', 'WEEKLY'])
  @IsOptional()
  frequency?: PaymentFrequency;
}

@ApiTags('Simulador Financiero')
@Controller('simulator')
export class SimulatorController {
  @Post('calculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Simular financiamiento con el motor de cálculo VELTOR' })
  @ApiResponse({ status: 200, description: 'Proyección financiera calculada exitosamente' })
  calculate(@Body() dto: SimulateLoanDto): SimulationResult {
    return simulate({
      vehiclePrice: dto.vehiclePrice,
      downPayment: dto.downPayment,
      financedFees: dto.financedFees || '0.00',
      upfrontFees: dto.upfrontFees || '0.00',
      monthlyRate: dto.monthlyRate,
      termCount: dto.termCount,
      startDate: dto.startDate,
      firstDueDate: dto.firstDueDate,
      method: dto.method || 'FRENCH',
      dayCount: dto.dayCount || 'D30_360',
      frequency: dto.frequency || 'MONTHLY',
      rounding: 'HALF_UP',
    });
  }
}
