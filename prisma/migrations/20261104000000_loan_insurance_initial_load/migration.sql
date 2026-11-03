-- Seguro mensual por crédito y pausa de avisos para la carga inicial de créditos en curso.
-- Idempotente y sin pérdida de datos. Los valores existentes quedan intactos:
-- insuranceMonthly = NULL (sin seguro), notificationsPaused = false y scheduledInsurance = 0.
-- ADD COLUMN con un default constante no reescribe la tabla (PostgreSQL 11+): es instantáneo.

-- Nuevo concepto de aplicación de pagos. PostgreSQL 12+ permite ADD VALUE dentro de una
-- transacción; el valor no se usa en esta migración.
ALTER TYPE "AllocationConcept" ADD VALUE IF NOT EXISTS 'INSURANCE';

ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "insuranceMonthly" DECIMAL(12,2);
ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "notificationsPaused" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "amortization_installments" ADD COLUMN IF NOT EXISTS "scheduledInsurance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Correo del cliente opcional (clientes reales cargados sin correo). La unicidad
-- customers_companyId_email_key se mantiene: PostgreSQL permite varios NULL en un
-- índice único, así que solo se exige cuando hay correo. La API debe guardar NULL, no ''.
ALTER TABLE "customers" ALTER COLUMN "email" DROP NOT NULL;
