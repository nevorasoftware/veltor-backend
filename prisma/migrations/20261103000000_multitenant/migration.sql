-- =============================================================================
-- VELTOR multiempresa (2026-11-03)
-- Escrita a mano: es idempotente (se puede volver a ejecutar sin efectos) y no
-- borra filas. Todo lo existente queda en la empresa por defecto 'veltor'.
-- Ver docs/MULTITENANT-CONTRATO.md, secciones "Modelo de datos" y "Migración".
-- =============================================================================

BEGIN;

-- 1. Empresas ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "companies" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "tagline" TEXT,
    "logoData" BYTEA,
    "logoMime" TEXT,
    "logoUpdatedAt" TIMESTAMP(3),
    "primaryColor" TEXT NOT NULL DEFAULT '#0f172a',
    "secondaryColor" TEXT NOT NULL DEFAULT '#1e293b',
    "accentColor" TEXT NOT NULL DEFAULT '#38bdf8',
    "domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "contactHours" TEXT,
    "paymentsEmail" TEXT,
    "paymentsWhatsapp" TEXT,
    "bankAccounts" JSONB NOT NULL DEFAULT '[]',
    "bankAccountHolder" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'es-SV',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'America/El_Salvador',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "companies_slug_key" ON "companies"("slug");
CREATE INDEX IF NOT EXISTS "companies_domains_idx" ON "companies" USING GIN ("domains");

-- Empresa por defecto: recibe todos los datos existentes
INSERT INTO "companies" ("id", "slug", "name", "isDefault", "isActive", "updatedAt")
SELECT gen_random_uuid()::text, 'veltor', 'VELTOR', true, true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "companies" WHERE "slug" = 'veltor');

UPDATE "companies" SET "isDefault" = true
WHERE "slug" = 'veltor' AND NOT EXISTS (SELECT 1 FROM "companies" WHERE "isDefault");

-- 2. companyId en los modelos de negocio (NOT NULL) ---------------------------
-- Orden por tabla: columna nullable -> relleno con la empresa por defecto ->
-- default de red de seguridad -> NOT NULL -> índice -> FK.
DO $$
DECLARE
    t TEXT;
    def_id TEXT;
BEGIN
    SELECT "id" INTO def_id FROM "companies" WHERE "slug" = 'veltor';

    FOREACH t IN ARRAY ARRAY[
        'customers', 'customer_documents', 'vehicles', 'vehicle_images', 'vehicle_status_history',
        'leads', 'financing_products', 'financing_applications', 'credit_evaluations', 'credit_approvals',
        'loans', 'loan_contract_versions', 'amortization_installments', 'payment_transactions',
        'payment_allocations', 'payment_reversals', 'account_statements', 'collection_cases',
        'collection_activities', 'notification_logs', 'system_settings', 'expenses'
    ] LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "companyId" TEXT', t);
        EXECUTE format('UPDATE %I SET "companyId" = %L WHERE "companyId" IS NULL', t, def_id);
        -- Sin contexto de empresa la variable no existe, el default es NULL y la inserción falla (nunca cae en otra empresa)
        EXECUTE format('ALTER TABLE %I ALTER COLUMN "companyId" SET DEFAULT current_setting(''app.company_id''::text, true)', t);
        EXECUTE format('ALTER TABLE %I ALTER COLUMN "companyId" SET NOT NULL', t);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("companyId")', t || '_companyId_idx', t);
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_companyId_fkey') THEN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
                t, t || '_companyId_fkey'
            );
        END IF;
    END LOOP;

    -- 3. Usuarios y auditoría (companyId nullable) ----------------------------
    FOREACH t IN ARRAY ARRAY['users', 'audit_logs'] LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "companyId" TEXT', t);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("companyId")', t || '_companyId_idx', t);
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_companyId_fkey') THEN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE',
                t, t || '_companyId_fkey'
            );
        END IF;
    END LOOP;

    UPDATE "audit_logs" SET "companyId" = def_id WHERE "companyId" IS NULL;

    -- El único superadministrador de plataforma es softwarenevora@gmail.com;
    -- cualquier otro SUPERADMIN pasa a ADMIN de la empresa por defecto.
    UPDATE "users" SET "role" = 'ADMIN'
    WHERE "role" = 'SUPERADMIN' AND lower("email") <> 'softwarenevora@gmail.com';

    UPDATE "users" SET "companyId" = def_id
    WHERE "companyId" IS NULL AND lower("email") <> 'softwarenevora@gmail.com';

    UPDATE "users" SET "role" = 'SUPERADMIN', "companyId" = NULL
    WHERE lower("email") = 'softwarenevora@gmail.com';
END $$;

-- 4. Unicidades por empresa ----------------------------------------------------
DROP INDEX IF EXISTS "customers_code_key";
DROP INDEX IF EXISTS "customers_dui_key";
DROP INDEX IF EXISTS "customers_nit_key";
DROP INDEX IF EXISTS "customers_email_key";
DROP INDEX IF EXISTS "vehicles_code_key";
DROP INDEX IF EXISTS "leads_code_key";
DROP INDEX IF EXISTS "financing_products_code_key";
DROP INDEX IF EXISTS "financing_applications_code_key";
DROP INDEX IF EXISTS "loans_code_key";
DROP INDEX IF EXISTS "payment_transactions_code_key";
DROP INDEX IF EXISTS "system_settings_key_key";
DROP INDEX IF EXISTS "expenses_code_key";

CREATE UNIQUE INDEX IF NOT EXISTS "customers_companyId_code_key" ON "customers"("companyId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "customers_companyId_dui_key" ON "customers"("companyId", "dui");
CREATE UNIQUE INDEX IF NOT EXISTS "customers_companyId_nit_key" ON "customers"("companyId", "nit");
CREATE UNIQUE INDEX IF NOT EXISTS "customers_companyId_email_key" ON "customers"("companyId", "email");
CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_companyId_code_key" ON "vehicles"("companyId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "leads_companyId_code_key" ON "leads"("companyId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "financing_products_companyId_code_key" ON "financing_products"("companyId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "financing_applications_companyId_code_key" ON "financing_applications"("companyId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "loans_companyId_code_key" ON "loans"("companyId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_companyId_code_key" ON "payment_transactions"("companyId", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "system_settings_companyId_key_key" ON "system_settings"("companyId", "key");
CREATE UNIQUE INDEX IF NOT EXISTS "expenses_companyId_code_key" ON "expenses"("companyId", "code");

COMMIT;
