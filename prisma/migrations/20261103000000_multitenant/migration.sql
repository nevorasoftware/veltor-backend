-- =============================================================================
-- VELTOR multiempresa (2026-11-03)
-- Escrita a mano: es idempotente (se puede volver a ejecutar sin efectos) y no
-- borra filas. Todo lo existente queda en la empresa por defecto 'veltor'.
-- Ver docs/MULTITENANT-CONTRATO.md, secciones "Modelo de datos" y "Migración".
--
-- Producción:
--  * Todo corre en UNA transacción (BEGIN ... COMMIT). Si algo falla, Postgres
--    revierte todo, incluido el respaldo, y la base queda como estaba.
--  * Antes de tocar nada se bloquean todas las tablas de negocio (ACCESS
--    EXCLUSIVE, en un orden fijo) para que el respaldo sea exacto y no haya
--    interbloqueos a mitad de camino. lock_timeout evita esperar sin límite
--    detrás de una transacción larga de la versión anterior de la API.
--  * Paso 0: respaldo en el esquema backup_20261103 (solo si no existe).
--    Reversión de emergencia: docs/ROLLBACK-20261103-multitenant.sql
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '20s';

LOCK TABLE
    "users", "customers", "customer_documents", "vehicles", "vehicle_images", "vehicle_status_history",
    "leads", "financing_products", "financing_applications", "credit_evaluations", "credit_approvals",
    "loans", "loan_contract_versions", "amortization_installments", "payment_transactions",
    "payment_allocations", "payment_reversals", "account_statements", "collection_cases",
    "collection_activities", "notification_logs", "audit_logs", "system_settings", "expenses"
IN ACCESS EXCLUSIVE MODE;

-- 0. Respaldo previo (solo la primera vez) -------------------------------------
-- Copia de cada tabla de public (excepto el historial de Prisma) más un
-- manifiesto con los conteos, para comparar después del despliegue.
DO $$
DECLARE
    r RECORD;
    n BIGINT;
BEGIN
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'backup_20261103') THEN
        RAISE NOTICE 'backup_20261103 ya existe: no se vuelve a respaldar.';
        RETURN;
    END IF;

    CREATE SCHEMA "backup_20261103";
    CREATE TABLE "backup_20261103"."_manifest" (
        "table_name" TEXT PRIMARY KEY,
        "row_count"  BIGINT NOT NULL,
        "taken_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    FOR r IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
        ORDER BY tablename
    LOOP
        EXECUTE format('CREATE TABLE "backup_20261103".%I AS TABLE public.%I', r.tablename, r.tablename);
        EXECUTE format('SELECT count(*) FROM "backup_20261103".%I', r.tablename) INTO n;
        INSERT INTO "backup_20261103"."_manifest" ("table_name", "row_count") VALUES (r.tablename, n);
    END LOOP;
END $$;

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

-- A lo sumo una empresa por defecto. Índice parcial: Prisma no lo representa
-- en el schema, pero `migrate diff` no lo marca como drift.
CREATE UNIQUE INDEX IF NOT EXISTS "companies_single_default_key" ON "companies"("isDefault") WHERE "isDefault";

-- 2. companyId en los modelos de negocio (NOT NULL) ---------------------------
-- Orden por tabla: columna nullable -> relleno con la empresa por defecto ->
-- default de red de seguridad -> NOT NULL -> índice -> FK.
DO $$
DECLARE
    t TEXT;
    def_id TEXT;
BEGIN
    SELECT "id" INTO def_id FROM "companies" WHERE "slug" = 'veltor';
    IF def_id IS NULL THEN
        RAISE EXCEPTION 'multitenant: no existe la empresa por defecto veltor';
    END IF;

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
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = t || '_companyId_fkey' AND conrelid = format('public.%I', t)::regclass
        ) THEN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
                t, t || '_companyId_fkey'
            );
        END IF;
    END LOOP;

    -- 3. Usuarios y auditoría (companyId nullable) ----------------------------
    -- ON DELETE RESTRICT: con SET NULL, al borrar una empresa sus usuarios
    -- quedarían con companyId NULL, que es la marca del superadmin. El borrado
    -- de una empresa lo hace la API en orden (DELETE /platform/companies/:id).
    FOREACH t IN ARRAY ARRAY['users', 'audit_logs'] LOOP
        EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "companyId" TEXT', t);
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("companyId")', t || '_companyId_idx', t);
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = t || '_companyId_fkey' AND conrelid = format('public.%I', t)::regclass
        ) THEN
            EXECUTE format(
                'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
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
-- Verificación previa: si hubiera duplicados (p. ej. una base creada con
-- `db push` sin alguna unicidad global), se aborta con un mensaje claro en vez
-- de fallar al crear el índice. Todo queda revertido.
DO $$
DECLARE
    c RECORD;
    dup BIGINT;
BEGIN
    FOR c IN SELECT * FROM (VALUES
        ('customers', 'code'), ('customers', 'dui'), ('customers', 'nit'), ('customers', 'email'),
        ('vehicles', 'code'), ('leads', 'code'), ('financing_products', 'code'),
        ('financing_applications', 'code'), ('loans', 'code'), ('payment_transactions', 'code'),
        ('system_settings', 'key'), ('expenses', 'code')
    ) AS v(tbl, col) LOOP
        EXECUTE format(
            'SELECT count(*) FROM (SELECT 1 FROM %I WHERE %I IS NOT NULL GROUP BY "companyId", %I HAVING count(*) > 1) d',
            c.tbl, c.col, c.col
        ) INTO dup;
        IF dup > 0 THEN
            RAISE EXCEPTION 'multitenant: % valores duplicados en %.% impiden la unicidad por empresa', dup, c.tbl, c.col;
        END IF;
    END LOOP;
END $$;

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

-- 5. Comprobación final: ninguna fila de negocio sin empresa -------------------
DO $$
DECLARE
    t TEXT;
    n BIGINT;
BEGIN
    FOREACH t IN ARRAY ARRAY['audit_logs'] LOOP
        EXECUTE format('SELECT count(*) FROM %I WHERE "companyId" IS NULL', t) INTO n;
        IF n > 0 THEN
            RAISE EXCEPTION 'multitenant: % filas de % quedaron sin empresa', n, t;
        END IF;
    END LOOP;
    SELECT count(*) INTO n FROM "users"
    WHERE "companyId" IS NULL AND lower("email") <> 'softwarenevora@gmail.com';
    IF n > 0 THEN
        RAISE EXCEPTION 'multitenant: % usuarios quedaron sin empresa', n;
    END IF;
END $$;

COMMIT;
