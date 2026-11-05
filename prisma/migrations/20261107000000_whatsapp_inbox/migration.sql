-- Bandeja de WhatsApp: mensajes de los clientes al número de la plataforma y respuestas.
-- Solo crea una tabla nueva: no altera tablas en uso. Idempotente.
CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT current_setting('app.company_id'::text, true),
    "customerId" TEXT,
    "phone" TEXT NOT NULL,
    "profileName" TEXT,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "mediaId" TEXT,
    "mediaMime" TEXT,
    "mediaName" TEXT,
    "documentId" TEXT,
    "waMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "readAt" TIMESTAMP(3),
    "sentById" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_messages_waMessageId_key" ON "whatsapp_messages"("waMessageId");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_companyId_phone_timestamp_idx" ON "whatsapp_messages"("companyId", "phone", "timestamp");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_companyId_direction_readAt_idx" ON "whatsapp_messages"("companyId", "direction", "readAt");

DO $$ BEGIN
  ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
