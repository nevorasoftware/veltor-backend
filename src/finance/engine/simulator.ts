import { D, ZERO, money, fmt, sumDec, RoundingMode } from './decimal';
import { DateStr, cmp } from './dates';
import { AmortizationMethod, DayCountBasis, PaymentFrequency, PERIODS_PER_YEAR, generateSchedule, periodicRate } from './schedule';

export interface SimulationInput {
  vehiclePrice: string;
  downPayment: string;
  financedFees: string; // gastos/comisiones autorizados a financiar
  upfrontFees: string; // cargos pagados al contado (no se financian)
  monthlyRate: string;
  termCount: number;
  startDate: DateStr;
  firstDueDate: DateStr;
  method: AmortizationMethod;
  dayCount: DayCountBasis;
  frequency: PaymentFrequency;
  rounding: RoundingMode;
}

export interface SimulationResult {
  vehiclePrice: string;
  downPayment: string;
  financedFees: string;
  upfrontFees: string;
  principal: string;
  monthlyRate: string;
  nominalAnnualRate: string;
  effectiveAnnualRate: string;
  termCount: number;
  frequency: PaymentFrequency;
  installment: string;
  totalInterest: string;
  totalPayments: string;
  totalCost: string;
  firstDueDate: DateStr;
  schedule: Array<{
    number: number;
    dueDate: DateStr;
    openingBalance: string;
    principal: string;
    interest: string;
    payment: string;
    closingBalance: string;
  }>;
  disclaimer: string;
}

export class SimulationError extends Error {}

export const SIMULATION_DISCLAIMER =
  'Cálculo estimado con fines informativos. No constituye una oferta de crédito; está sujeto a evaluación, aprobación y condiciones contractuales.';

export function simulate(input: SimulationInput): SimulationResult {
  const price = D(input.vehiclePrice);
  const down = D(input.downPayment);
  const financedFees = D(input.financedFees || '0');
  const upfrontFees = D(input.upfrontFees || '0');
  const rate = D(input.monthlyRate);

  if (price.lte(0)) throw new SimulationError('El precio del vehículo debe ser mayor que cero');
  if (down.lt(0)) throw new SimulationError('La prima no puede ser negativa');
  if (down.gt(price)) throw new SimulationError('La prima no puede ser superior al precio del vehículo');
  if (financedFees.lt(0) || upfrontFees.lt(0)) throw new SimulationError('Los cargos no pueden ser negativos');
  if (rate.lt(0)) throw new SimulationError('La tasa no puede ser negativa');
  if (rate.gt(1)) throw new SimulationError('La tasa mensual debe expresarse en decimal (ej. 0.015)');
  if (!Number.isInteger(input.termCount) || input.termCount < 1 || input.termCount > 600) {
    throw new SimulationError('El plazo debe ser un número entero de cuotas entre 1 y 600');
  }
  if (cmp(input.firstDueDate, input.startDate) <= 0) {
    throw new SimulationError('La primera cuota debe vencer después de la fecha de inicio');
  }

  const principal = price.minus(down).plus(financedFees);
  const r = periodicRate({ monthlyRate: rate, frequency: input.frequency });
  const ppy = PERIODS_PER_YEAR[input.frequency];
  const nominal = rate.times(12);
  const effective = D(1).plus(r).pow(ppy).minus(1);

  const gen = principal.gt(0)
    ? generateSchedule({
        principal,
        monthlyRate: rate,
        dayCount: input.dayCount,
        frequency: input.frequency,
        rounding: input.rounding,
        method: input.method,
        startDate: input.startDate,
        startNumber: 1,
        anchorDate: input.firstDueDate,
        anchorNumber: 1,
        count: input.termCount,
      })
    : { installments: [], levelPayment: ZERO, levelPrincipal: ZERO };

  const totalInterest = sumDec(gen.installments.map((i) => i.interest));
  const totalPayments = sumDec(gen.installments.map((i) => i.payment));
  const installment = gen.installments.length
    ? input.method === 'FRENCH'
      ? gen.levelPayment!
      : gen.installments[0].payment
    : ZERO;

  return {
    vehiclePrice: fmt(price),
    downPayment: fmt(down),
    financedFees: fmt(financedFees),
    upfrontFees: fmt(upfrontFees),
    principal: fmt(principal),
    monthlyRate: rate.toString(),
    nominalAnnualRate: nominal.toDecimalPlaces(6).toString(),
    effectiveAnnualRate: effective.toDecimalPlaces(6).toString(),
    termCount: input.termCount,
    frequency: input.frequency,
    installment: fmt(money(installment)),
    totalInterest: fmt(totalInterest),
    totalPayments: fmt(totalPayments),
    totalCost: fmt(down.plus(upfrontFees).plus(totalPayments)),
    firstDueDate: input.firstDueDate,
    schedule: gen.installments.map((i) => ({
      number: i.number,
      dueDate: i.dueDate,
      openingBalance: fmt(i.openingBalance),
      principal: fmt(i.principal),
      interest: fmt(i.interest),
      payment: fmt(i.payment),
      closingBalance: fmt(i.closingBalance),
    })),
    disclaimer: SIMULATION_DISCLAIMER,
  };
}
