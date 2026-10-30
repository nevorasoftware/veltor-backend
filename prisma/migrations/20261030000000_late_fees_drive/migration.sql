-- Mora parametrizable por crédito, día de pago y almacenamiento en Google Drive.
DO $$ BEGIN
  CREATE TYPE "LateFeeType" AS ENUM ('NONE', 'PER_DAY', 'PER_INSTALLMENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "lateFeeType" "LateFeeType" NOT NULL DEFAULT 'NONE';
ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "lateFeeAmount" DECIMAL(12,2);
ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "paymentDay" INTEGER;
ALTER TABLE "loans" ADD COLUMN IF NOT EXISTS "driveFolderId" TEXT;

ALTER TABLE "vehicle_images" ADD COLUMN IF NOT EXISTS "driveFileId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_images_driveFileId_key" ON "vehicle_images"("driveFileId");
