import { Controller, ForbiddenException, Get, NotFoundException, Param, Request } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceService } from '../finance/finance.service';

@ApiTags('Portal del Cliente')
@ApiBearerAuth()
@Roles(UserRole.CUSTOMER)
@Controller('portal')
export class PortalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeService: FinanceService,
  ) {}

  private customerIdOf(req: any): string {
    const customerId = req.user?.customerId;
    if (!customerId) throw new ForbiddenException('Su usuario no está vinculado a un expediente de cliente.');
    return customerId;
  }

  @Get('me')
  @ApiOperation({ summary: 'Datos del cliente autenticado y listado de sus créditos' })
  async me(@Request() req: any) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: this.customerIdOf(req) },
      select: {
        id: true,
        code: true,
        fullName: true,
        dui: true,
        email: true,
        phone: true,
        loans: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            code: true,
            status: true,
            originalPrincipal: true,
            currentPrincipalBalance: true,
            monthlyRate: true,
            termCount: true,
            disbursementDate: true,
            vehicle: { select: { brand: true, model: true, year: true, color: true } },
          },
        },
      },
    });
    if (!customer) throw new NotFoundException('Expediente de cliente no encontrado');
    return customer;
  }

  @Get('loans/:id')
  @ApiOperation({ summary: 'Estado de cuenta, tabla de amortización e historial de un crédito propio' })
  async loan(@Param('id') id: string, @Request() req: any) {
    const { loan, snapshot } = await this.financeService.getLoanLedgerSnapshot(id, undefined, {
      customerId: this.customerIdOf(req),
    });
    return {
      loan: {
        id: loan.id,
        code: loan.code,
        status: loan.status,
        vehiclePrice: loan.vehiclePrice,
        downPayment: loan.downPayment,
        originalPrincipal: loan.originalPrincipal,
        monthlyRate: loan.monthlyRate,
        termCount: loan.termCount,
        disbursementDate: loan.disbursementDate,
        firstDueDate: loan.firstDueDate,
        paymentDay: loan.paymentDay,
        graceDays: loan.graceDays,
        lateFeeType: loan.lateFeeType,
        lateFeeAmount: loan.lateFeeAmount,
        vehicle: { brand: loan.vehicle.brand, model: loan.vehicle.model, year: loan.vehicle.year, color: loan.vehicle.color },
      },
      payments: loan.payments.map((p) => ({
        id: p.id,
        code: p.code,
        effectiveDate: p.effectiveDate,
        amountReceived: p.amountReceived,
        kind: p.kind,
        paymentMethod: p.paymentMethod,
        allocations: p.allocations.map((a) => ({ concept: a.concept, amount: a.amount, installmentNumber: a.installmentNumber })),
      })),
      snapshot: {
        status: snapshot.status,
        principalBalance: snapshot.principalBalance,
        monthlyRate: snapshot.monthlyRate,
        totals: snapshot.totals,
        installments: snapshot.current.installments,
      },
    };
  }
}
