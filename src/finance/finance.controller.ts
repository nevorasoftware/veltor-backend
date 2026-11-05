import { Controller, Get, Post, Patch, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import { PaymentKind, PaymentMethod, UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { PrepaymentPolicy } from './engine';
import { IsBoolean, IsEnum, IsIn, IsInt, IsNotEmpty, IsNumber, IsNumberString, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

/** Rehacer crédito / actualizar condiciones. Lo que no se envía se conserva. */
export class RestateLoanDto {
  @IsString()
  @IsNotEmpty({ message: 'Indique el motivo del cambio.' })
  @MaxLength(1000)
  reason!: string;

  @IsOptional() @IsNumber() @Min(0.01)
  vehiclePrice?: number;

  @IsOptional() @IsNumber() @Min(0.01)
  principal?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(200)
  annualRate?: number;

  @IsOptional() @IsInt() @Min(1) @Max(600)
  termMonths?: number;

  @IsOptional() @IsString()
  firstPaymentDate?: string;

  @IsOptional() @IsString()
  disbursementDate?: string;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0)
  insuranceMonthly?: number | null;

  @IsOptional() @IsIn(['KEEP', 'REVERSE_ALL'])
  payments?: 'KEEP' | 'REVERSE_ALL';

  @IsOptional() @IsInt() @Min(0)
  markPaidThrough?: number;

  @IsOptional() @IsBoolean()
  dryRun?: boolean;
}

export class RegisterPaymentDto {
  @IsString()
  @IsNotEmpty()
  loanId!: string;

  @IsNumberString()
  amount!: string;

  @IsString()
  @IsNotEmpty()
  effectiveDate!: string;

  @IsEnum(['INSTALLMENT', 'PRINCIPAL_PREPAYMENT', 'PAYOFF'])
  kind!: PaymentKind;

  @IsEnum(['REDUCE_TERM', 'REDUCE_INSTALLMENT'])
  @IsOptional()
  policy?: PrepaymentPolicy;

  @IsEnum(['CASH', 'BANK_TRANSFER', 'BANK_DEPOSIT', 'CHECK', 'OTHER'])
  paymentMethod!: PaymentMethod;

  @IsString()
  @IsOptional()
  referenceNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;

  /** Carga de pagos históricos: no envía el correo de "pago registrado" (ni al cliente ni a los ADMIN) */
  @IsBoolean()
  @IsOptional()
  initialLoad?: boolean;
}

export class LoanNotificationsDto {
  @IsBoolean()
  paused!: boolean;
}

export class ReversePaymentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

@ApiTags('Finanzas y Pagos')
@ApiBearerAuth()
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('loans/:id/ledger')
  @ApiOperation({ summary: 'Obtener snapshot reproducible y versiones de amortización de un crédito' })
  async getLedger(@Param('id') id: string, @Query('asOfDate') asOfDate?: string) {
    return this.financeService.getLoanLedgerSnapshot(id, asOfDate);
  }

  @Get('loans/:id/payoff-quote')
  @ApiOperation({ summary: 'Calcular cotización exacta de cancelación total anticipada a una fecha' })
  async getPayoffQuote(@Param('id') id: string, @Query('targetDate') targetDate?: string) {
    return this.financeService.getPayoffQuote(id, targetDate);
  }

  @Post('payments')
  @ApiOperation({ summary: 'Registrar pago ordinario, abono extraordinario a capital o cancelación' })
  @Roles(UserRole.ADMIN, UserRole.CASHIER, UserRole.COLLECTIONS_AGENT)
  async registerPayment(@Body() dto: RegisterPaymentDto, @Request() req: any) {
    return this.financeService.registerPayment({
      ...dto,
      registeredById: req.user.id,
    });
  }

  @Patch('loans/:id/notifications')
  @ApiOperation({ summary: 'Pausar o reanudar los avisos de cobranza y correos al cliente de un crédito (carga inicial)' })
  @Roles(UserRole.ADMIN)
  async setNotifications(@Param('id') id: string, @Body() dto: LoanNotificationsDto) {
    return this.financeService.setNotificationsPaused(id, dto.paused);
  }

  @Post('loans/:id/restate')
  @ApiOperation({ summary: 'Rehacer crédito / actualizar condiciones (monto, tasa, plazo, fechas, seguro) y regenerar su plan; dryRun para previsualizar' })
  @Roles(UserRole.ADMIN)
  async restateLoan(@Param('id') id: string, @Body() dto: RestateLoanDto, @Request() req: any) {
    return this.financeService.restateLoan(id, dto, req.user.id);
  }

  @Post('payments/:id/reverse')
  @ApiOperation({ summary: 'Reversión autorizada de un pago y reconstrucción de saldos' })
  @Roles(UserRole.ADMIN, UserRole.APPROVAL_OFFICER)
  async reversePayment(@Param('id') id: string, @Body() dto: ReversePaymentDto, @Request() req: any) {
    return this.financeService.reversePayment(id, req.user.id, dto.reason);
  }
}
