/**
 * Generación de códigos correlativos legibles: PREFIX-AAAA-000001.
 * Se calcula a partir del último código existente del año; ante una colisión
 * (alta concurrencia) el `unique` de la base de datos rechaza y el llamador reintenta.
 */
export async function nextSequentialCode(
  findLast: (prefix: string) => Promise<{ code: string } | null>,
  prefix: string,
  digits = 6,
): Promise<string> {
  const year = new Date().getFullYear();
  const base = `${prefix}-${year}-`;
  const last = await findLast(base);
  const lastNum = last ? parseInt(last.code.slice(base.length), 10) : 0;
  const next = (Number.isFinite(lastNum) ? lastNum : 0) + 1;
  return `${base}${String(next).padStart(digits, '0')}`;
}

/** Reintenta una creación si falla por código duplicado (P2002 de Prisma). */
export async function withUniqueRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}
