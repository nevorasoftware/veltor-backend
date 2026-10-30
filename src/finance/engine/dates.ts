/**
 * Utilidades de fechas "solo día" (YYYY-MM-DD) en UTC.
 * El motor financiero trabaja con fechas calendario sin hora para evitar
 * desfases por zona horaria. La zona de negocio (America/El_Salvador) se
 * aplica únicamente al convertir "hoy" a fecha calendario (ver todayInBusinessTz).
 */
export type DateStr = string;

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parse(d: DateStr): { y: number; m: number; day: number } {
  const match = RE.exec(d);
  if (!match) throw new Error(`Fecha inválida: ${d}`);
  return { y: Number(match[1]), m: Number(match[2]), day: Number(match[3]) };
}

export function make(y: number, m: number, day: number): DateStr {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isValidDate(d: string): boolean {
  if (!RE.test(d)) return false;
  const { y, m, day } = parse(d);
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
}

function toUtc(d: DateStr): number {
  const { y, m, day } = parse(d);
  return Date.UTC(y, m - 1, day);
}

function fromUtc(ms: number): DateStr {
  const dt = new Date(ms);
  return make(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Suma meses manteniendo el día ancla y limitándolo al fin de mes. */
export function addMonths(d: DateStr, months: number, anchorDay?: number): DateStr {
  const { y, m, day } = parse(d);
  const target = anchorDay ?? day;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return make(ny, nm, Math.min(target, daysInMonth(ny, nm)));
}

export function addDays(d: DateStr, days: number): DateStr {
  return fromUtc(toUtc(d) + days * 86_400_000);
}

export function diffDaysActual(from: DateStr, to: DateStr): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** Convención 30E/360 (europea). */
export function diffDays30E360(from: DateStr, to: DateStr): number {
  const a = parse(from);
  const b = parse(to);
  const d1 = Math.min(a.day, 30);
  const d2 = Math.min(b.day, 30);
  return (b.y - a.y) * 360 + (b.m - a.m) * 30 + (d2 - d1);
}

export function cmp(a: DateStr, b: DateStr): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxDate(a: DateStr, b: DateStr): DateStr {
  return a > b ? a : b;
}

/** Fecha calendario actual en la zona horaria de negocio. */
export function todayInTz(timeZone = 'America/El_Salvador', now = new Date()): DateStr {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts; // en-CA => YYYY-MM-DD
}

export function toDateStr(d: Date): DateStr {
  return fromUtc(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function toJsDate(d: DateStr): Date {
  return new Date(toUtc(d));
}

/** Plazo mínimo (días) entre el desembolso y la primera cuota cuando se fija un día de pago. */
export const MIN_FIRST_PERIOD_DAYS = 15;

/**
 * Primera fecha de vencimiento para cuotas que vencen el día `paymentDay` de cada mes:
 * la ocurrencia más cercana a un mes después del desembolso, con al menos 15 días de plazo.
 * Ej.: desembolso 29/10 y día 10 → 10/12; desembolso 15/10 y día 10 → 10/11.
 */
export function firstDueDateForDay(disbursement: DateStr, paymentDay: number): DateStr {
  const target = addMonths(disbursement, 1);
  const { y, m } = parse(target);
  const candidates = [-1, 0, 1].map((offset) => addMonths(make(y, m, 1), offset, paymentDay));
  const valid = candidates.filter((c) => diffDaysActual(disbursement, c) >= MIN_FIRST_PERIOD_DAYS);
  return valid.reduce((best, c) =>
    Math.abs(diffDaysActual(target, c)) < Math.abs(diffDaysActual(target, best)) ? c : best,
  );
}
