-- Carga parcial de créditos en curso: solo nombre, vehículo, condiciones y fechas.
-- Solo DROP NOT NULL (idempotente; instantáneo, sin reescribir tablas). Sin defaults
-- ni rellenos: los datos existentes no cambian y lo que falte queda en NULL.

ALTER TABLE "customers" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "customers" ALTER COLUMN "address" DROP NOT NULL;
ALTER TABLE "customers" ALTER COLUMN "economicActivity" DROP NOT NULL;
ALTER TABLE "customers" ALTER COLUMN "monthlyIncome" DROP NOT NULL;

ALTER TABLE "leads" ALTER COLUMN "phone" DROP NOT NULL;

ALTER TABLE "vehicles" ALTER COLUMN "brand" DROP NOT NULL;
ALTER TABLE "vehicles" ALTER COLUMN "model" DROP NOT NULL;
ALTER TABLE "vehicles" ALTER COLUMN "year" DROP NOT NULL;
ALTER TABLE "vehicles" ALTER COLUMN "type" DROP NOT NULL;
ALTER TABLE "vehicles" ALTER COLUMN "mileageKm" DROP NOT NULL;
ALTER TABLE "vehicles" ALTER COLUMN "color" DROP NOT NULL;
