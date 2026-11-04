-- Invitaciones de registro de clientes (enlace personal por WhatsApp). Solo crea una tabla nueva:
-- no altera tablas en uso. Idempotente.
CREATE TABLE IF NOT EXISTS "customer_invites" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT current_setting('app.company_id'::text, true),
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "sentTo" TEXT,
    "sendStatus" TEXT NOT NULL DEFAULT 'NOT_SENT',
    "sendError" TEXT,
    "messageId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_invites_tokenHash_key" ON "customer_invites"("tokenHash");
CREATE INDEX IF NOT EXISTS "customer_invites_companyId_idx" ON "customer_invites"("companyId");
CREATE INDEX IF NOT EXISTS "customer_invites_customerId_idx" ON "customer_invites"("customerId");

DO $$ BEGIN
  ALTER TABLE "customer_invites" ADD CONSTRAINT "customer_invites_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "customer_invites" ADD CONSTRAINT "customer_invites_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
