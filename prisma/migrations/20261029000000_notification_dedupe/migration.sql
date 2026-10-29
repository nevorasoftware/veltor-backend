-- Notificaciones por correo: clave de deduplicación y vínculo opcional al crédito.
ALTER TABLE "notification_logs" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
ALTER TABLE "notification_logs" ADD COLUMN IF NOT EXISTS "loanId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "notification_logs_dedupeKey_key" ON "notification_logs"("dedupeKey");
CREATE INDEX IF NOT EXISTS "notification_logs_loanId_idx" ON "notification_logs"("loanId");
