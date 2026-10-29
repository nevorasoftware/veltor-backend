import { Controller, Get, Post, Body, Param, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { FinanceService } from './finance.service';
import { PaymentKind, PaymentMethod, UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { PrepaymentPolicy } from './engine';
import { IsEnum, IsNotEmpty, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';

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

  @Post('payments/:id/reverse')
  @ApiOperation({ summary: 'Reversión autorizada de un pago y reconstrucción de saldos' })
  @Roles(UserRole.ADMIN, UserRole.APPROVAL_OFFICER)
  async reversePayment(@Param('id') id: string, @Body() dto: ReversePaymentDto, @Request() req: any) {
    return this.financeService.reversePayment(id, req.user.id, dto.reason);
  }
}
