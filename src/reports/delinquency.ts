import Decimal from 'decimal.js';
import type { InstallmentView } from '../finance/engine';

/** Fila del reporte de mora por crédito (montos como string con 2 decimales) */
export interface DelinquentLoan {
  loanId: string;
  code: string;
  customerId: string;
  customerName: string;
  vehicleTitle: string;
  overdueInstallments: number;
  oldestDueDate: string;
  /** Días de atraso de la cuota vencida más antigua */
  daysOverdue: number;
  graceDays: number;
  /** Vencido, pero todavía dentro de los días de gracia (aún sin mora) */
  inGrace: boolean;
  overduePrincipalInterest: string;
  overdueInsurance: string;
  lateFees: string;
  totalDue: string;
}

const fmt = (d: Decimal) => d.toFixed(2);
const pending = (a: string, b: string) => Decimal.max(new Decimal(a).minus(b), 0);

/**
 * Resume las cuotas vencidas e impagas de un crédito a la fecha del snapshot. Devuelve null si no tiene
 * ninguna. Función pura (sin BD) para poder probarla de forma aislada.
 */
export function summarizeOverdue(
  installments: InstallmentView[],
  graceDays: number,
): Omit<DelinquentLoan, 'loanId' | 'code' | 'customerId' | 'customerName' | 'vehicleTitle'> | null {
  const overdue = installments.filter((i) => i.status === 'OVERDUE');
  if (!overdue.length) return null;
  let principalInterest = new Decimal(0);
  let insurance = new Decimal(0);
  let late = new Decimal(0);
  for (const i of overdue) {
    principalInterest = principalInterest.plus(pending(i.payment, new Decimal(i.paidPrincipal).plus(i.paidInterest).toString()));
    insurance = insurance.plus(pending(i.insurance, i.paidInsurance));
    late = late.plus(pending(i.lateInterestAccrued, i.paidLateInterest));
  }
  const oldest = overdue.reduce((a, b) => (a.dueDate <= b.dueDate ? a : b));
  return {
    overdueInstallments: overdue.length,
    oldestDueDate: oldest.dueDate,
    daysOverdue: oldest.daysOverdue,
    graceDays,
    inGrace: oldest.daysOverdue <= graceDays,
    overduePrincipalInterest: fmt(principalInterest),
    overdueInsurance: fmt(insurance),
    lateFees: fmt(late),
    totalDue: fmt(principalInterest.plus(insurance).plus(late)),
  };
}

/** Totales del reporte */
export function delinquencyTotals(rows: DelinquentLoan[]) {
  const sum = (k: keyof DelinquentLoan) => fmt(rows.reduce((acc, r) => acc.plus(r[k] as string), new Decimal(0)));
  return {
    loansWithOverdue: rows.length,
    loansDelinquent: rows.filter((r) => !r.inGrace).length,
    loansInGrace: rows.filter((r) => r.inGrace).length,
    overdueInstallments: rows.reduce((acc, r) => acc + r.overdueInstallments, 0),
    overduePrincipalInterest: sum('overduePrincipalInterest'),
    overdueInsurance: sum('overdueInsurance'),
    lateFees: sum('lateFees'),
    totalDue: sum('totalDue'),
  };
}
