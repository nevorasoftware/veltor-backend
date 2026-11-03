/** Texto para un vehículo con datos incompletos (carga parcial): nunca se inventan marca, modelo ni año. */
export const VEHICLE_TBD = 'Por definir';

/** "Marca Modelo Año" con lo que haya; sin ningún dato, "Por definir". */
export function vehicleName(v?: { brand?: string | null; model?: string | null; year?: number | null } | null): string {
  if (!v) return VEHICLE_TBD;
  const parts = [v.brand, v.model, v.year ?? null].filter((x) => x !== null && x !== undefined && String(x).trim() !== '');
  return parts.length ? parts.join(' ') : VEHICLE_TBD;
}

/** Texto opcional: null/vacío → "—" para mostrar en PDF y correos */
export const orDash = (v?: string | null) => (v && String(v).trim() ? String(v) : '—');
