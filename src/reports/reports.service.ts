import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VehicleStatus, LoanStatus, LeadStatus, CustomerStatus } from '@prisma/client';
import { todayInTz } from '../finance/engine';
import { FinanceService } from '../finance/finance.service';
import { TenantContext } from '../tenant/tenant-context';
import { VEHICLE_TBD, vehicleName } from '../common/labels';
import { DelinquentLoan, delinquencyTotals, summarizeOverdue } from './delinquency';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
  ) {}

  /**
   * Resumen de mora a la fecha de HOY en la zona horaria de la empresa, calculado con el ledger (incluye la mora
   * devengada a hoy y el seguro vencido). inGrace marca los créditos vencidos que aún están dentro de la gracia.
   */
  async getDelinquency() {
    const company = TenantContext.company();
    const timezone = company?.timezone || 'America/El_Salvador';
    const asOf = todayInTz(timezone);
    const rows: DelinquentLoan[] = [];
    for (const { loan, snapshot } of await this.finance.activeLoanSnapshots(asOf)) {
      const summary = summarizeOverdue(snapshot.current.installments, loan.graceDays);
      if (!summary) continue;
      rows.push({
        loanId: loan.id,
        code: loan.code,
        customerId: loan.customer.id,
        customerName: loan.customer.fullName,
        vehicleTitle: loan.vehicle.brand && loan.vehicle.model ? vehicleName(loan.vehicle) : VEHICLE_TBD,
        ...summary,
      });
    }
    rows.sort((a, b) => b.daysOverdue - a.daysOverdue || a.code.localeCompare(b.code));
    return { asOf, timezone, currency: company?.currency || 'USD', totals: delinquencyTotals(rows), loans: rows };
  }

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

  /**
   * Cartera para la lista del panel. Cada crédito trae además su situación a hoy (zona horaria de la empresa):
   * overdueInstallments, daysOverdue (cuota vencida más antigua), inGrace y totalDue (capital+interés+seguro+mora
   * vencidos). Los créditos no activos o al día traen 0.
   */
  async getLoansSummary() {
    const asOf = todayInTz(TenantContext.company()?.timezone || 'America/El_Salvador');
    const [loans, snapshots] = await Promise.all([
      this.prisma.loan.findMany({
        include: {
          customer: { select: { id: true, code: true, fullName: true, dui: true, phone: true, email: true } },
          vehicle: { select: { id: true, code: true, brand: true, model: true, year: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.finance.activeLoanSnapshots(asOf),
    ]);
    const overdue = new Map(snapshots.map(({ loan, snapshot }) => [loan.id, summarizeOverdue(snapshot.current.installments, loan.graceDays)]));
    return loans.map((loan) => {
      const s = overdue.get(loan.id);
      return {
        ...loan,
        overdueInstallments: s?.overdueInstallments ?? 0,
        daysOverdue: s?.daysOverdue ?? 0,
        inGrace: s?.inGrace ?? false,
        totalDue: s?.totalDue ?? '0.00',
      };
    });
  }
}
