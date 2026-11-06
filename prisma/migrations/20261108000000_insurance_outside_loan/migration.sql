-- El seguro deja de formar parte del crédito: no se aplica al capital ni a la cuota.
-- Se pide al registrar cada pago (payment_transactions."insuranceAmount") y se informa en el comprobante,
-- la tabla de amortización y los PDF como dato aparte.
-- Sin pérdida de información. Prisma la ejecuta una sola vez (no re-ejecutar a mano: volvería a descontar el seguro).

-- Respaldo de los montos originales antes del cambio (rollback: restaurar amountReceived/amountApplied desde aquí)
CREATE SCHEMA IF NOT EXISTS "backup_20261106";
CREATE TABLE IF NOT EXISTS "backup_20261106"."payment_amounts" AS
  SELECT "id", "amountReceived", "amountApplied" FROM "payment_transactions";

ALTER TABLE "payment_transactions" ADD COLUMN IF NOT EXISTS "insuranceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Pagos existentes: lo que el motor aplicó a seguro pasa a "insuranceAmount" y se descuenta del monto
-- aplicado al crédito. Como el seguro se cobraba antes que el interés y el capital, quitarlo del monto
-- y del concepto deja igual la aplicación a mora, interés y capital (el saldo de capital no cambia).
WITH ins AS (
  SELECT "paymentId", SUM("amount") AS total
  FROM "payment_allocations"
  WHERE "concept" = 'INSURANCE'
  GROUP BY "paymentId"
)
UPDATE "payment_transactions" p
SET "insuranceAmount" = p."insuranceAmount" + ins.total,
    "amountReceived"  = p."amountReceived" - ins.total,
    "amountApplied"   = GREATEST(p."amountApplied" - ins.total, 0)
FROM ins
WHERE ins."paymentId" = p."id";

-- Las asignaciones INSURANCE se conservan como detalle informativo (cuota a la que corresponde el seguro):
-- ya no suman al monto aplicado al crédito.

-- La cuota ya no incluye seguro.
UPDATE "amortization_installments" SET "scheduledInsurance" = 0 WHERE "scheduledInsurance" <> 0;
