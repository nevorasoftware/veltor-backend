import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VehicleStatus, LoanStatus, LeadStatus, CustomerStatus } from '@prisma/client';
import { todayInTz } from '../finance/engine';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardMetrics() {
    // Inicio del mes en la zona horaria del negocio (effectiveDate es una fecha sin hora)
    const firstDayMonth = new Date(`${todayInTz().slice(0, 7)}-01`);

    const [
      availableVehicles,
      reservedVehicles,
      soldVehicles,
      pendingLeads,
      activeCustomers,
      activeLoans,
      portfolioAgg,
      monthPaymentsAgg,
    ] = await Promise.all([
      this.prisma.vehicle.count({ where: { status: VehicleStatus.AVAILABLE, isPublished: true } }),
      this.prisma.vehicle.count({ where: { status: VehicleStatus.RESERVED } }),
      this.prisma.vehicle.count({ where: { status: VehicleStatus.SOLD } }),
      this.prisma.lead.count({ where: { status: LeadStatus.NEW } }),
      this.prisma.customer.count({ where: { status: CustomerStatus.ACTIVE } }),
      this.prisma.loan.count({ where: { status: LoanStatus.ACTIVE } }),
      this.prisma.loan.aggregate({
        where: { status: LoanStatus.ACTIVE },
        _sum: { currentPrincipalBalance: true },
      }),
      this.prisma.paymentTransaction.aggregate({
        where: {
          isReversed: false,
          effectiveDate: { gte: firstDayMonth },
        },
        _sum: { amountApplied: true },
      }),
    ]);

    const activePortfolio = portfolioAgg._sum.currentPrincipalBalance?.toNumber() || 0;
    const monthCollections = monthPaymentsAgg._sum.amountApplied?.toNumber() || 0;

    return {
      vehicles: {
        available: availableVehicles,
        reserved: reservedVehicles,
        sold: soldVehicles,
        total: availableVehicles + reservedVehicles + soldVehicles,
      },
      commercial: {
        pendingLeads,
        activeCustomers,
      },
      financial: {
        activeLoans,
        activePortfolio: activePortfolio.toFixed(2),
        monthCollections: monthCollections.toFixed(2),
        currency: 'USD',
      },
    };
  }

  async getLoansSummary() {
    return this.prisma.loan.findMany({
      include: {
        customer: { select: { id: true, code: true, fullName: true, dui: true, phone: true } },
        vehicle: { select: { id: true, code: true, brand: true, model: true, year: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
