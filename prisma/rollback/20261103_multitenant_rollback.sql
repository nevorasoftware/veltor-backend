-- =============================================================================
-- REVERSIÓN DE EMERGENCIA de la migración 20261103000000_multitenant
-- =============================================================================
-- SOLO PARA EMERGENCIAS. Restaura el esquema y los datos anteriores a la
-- migración multiempresa desde el respaldo backup_20261103 que crea esa misma
-- migración. Copia versionada: backend/prisma/rollback/20261103_multitenant_rollback.sql
--
-- CONSECUENCIAS (leer antes de ejecutar)
--  * Los datos vuelven EXACTAMENTE al momento de la migración. Lo creado o
--    modificado después (pagos, clientes, empresas nuevas, logos, usuarios...)
--    deja de estar en public. No se pierde: antes de restaurar, el estado actual
--    se copia al esquema backup_20261103_post para recuperarlo a mano.
--  * Se elimina la tabla companies y la columna companyId de todas las tablas.
--  * Se borra el registro de la migración en _prisma_migrations.
--
-- PROCEDIMIENTO
--  1. Detener la API en Railway (o dejarla sin réplicas) para que nadie escriba.
--  2. Ejecutar este script completo con psql contra la BD de producción:
--       psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ROLLBACK-20261103-multitenant.sql
--     Es una sola transacción: si algo falla, no cambia nada.
--  3. Desplegar en Railway el backend ANTERIOR a la multiempresa (commit 0260ebe)
--     y el frontend correspondiente. Si se vuelve a desplegar la versión
--     multiempresa, la migración se aplicará de nuevo (respaldará lo que haya
--     en ese momento solo si backup_20261103 no existe; ver el paso 5).
--  4. Verificar con los conteos de backup_20261103._manifest (ver el final).
--  5. Cuando todo esté verificado, renombrar o borrar a mano los esquemas de
--     respaldo (DROP SCHEMA backup_20261103 CASCADE; ...) antes de reintentar
--     la migración multiempresa.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '20s';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'backup_20261103') THEN
        RAISE EXCEPTION 'No existe el esquema backup_20261103: no hay respaldo desde el cual restaurar.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'backup_20261103_post') THEN
        RAISE EXCEPTION 'Ya existe backup_20261103_post (¿reversión previa?). Revíselo y renómbrelo antes de continuar.';
    END IF;
END $$;

-- 1. Guardar el estado actual (posterior a la migración) -----------------------
DO $$
DECLARE r RECORD;
BEGIN
    CREATE SCHEMA "backup_20261103_post";
    FOR r IN SELECT tablename FROM pg_tables
             WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' LOOP
        EXECUTE format('CREATE TABLE "backup_20261103_post".%I AS TABLE public.%I', r.tablename, r.tablename);
    END LOOP;
END $$;

-- 2. Quitar la estructura multiempresa ------------------------------------------
DROP INDEX IF EXISTS "customers_companyId_code_key";
DROP INDEX IF EXISTS "customers_companyId_dui_key";
DROP INDEX IF EXISTS "customers_companyId_nit_key";
DROP INDEX IF EXISTS "customers_companyId_email_key";
DROP INDEX IF EXISTS "vehicles_companyId_code_key";
DROP INDEX IF EXISTS "leads_companyId_code_key";
DROP INDEX IF EXISTS "financing_products_companyId_code_key";
DROP INDEX IF EXISTS "financing_applications_companyId_code_key";
DROP INDEX IF EXISTS "loans_companyId_code_key";
DROP INDEX IF EXISTS "payment_transactions_companyId_code_key";
DROP INDEX IF EXISTS "system_settings_companyId_key_key";
DROP INDEX IF EXISTS "expenses_companyId_code_key";

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'users', 'customers', 'customer_documents', 'vehicles', 'vehicle_images', 'vehicle_status_history',
        'leads', 'financing_products', 'financing_applications', 'credit_evaluations', 'credit_approvals',
        'loans', 'loan_contract_versions', 'amortization_installments', 'payment_transactions',
        'payment_allocations', 'payment_reversals', 'account_statements', 'collection_cases',
        'collection_activities', 'notification_logs', 'audit_logs', 'system_settings', 'expenses'
    ] LOOP
        -- DROP COLUMN elimina también su índice y su FK
        EXECUTE format('ALTER TABLE %I DROP COLUMN IF EXISTS "companyId"', t);
    END LOOP;
END $$;

DROP TABLE IF EXISTS "companies";

-- 3. Restaurar los datos desde backup_20261103 ---------------------------------
-- Se vacían las tablas y se reinsertan de padres a hijos (las FK siguen activas).
TRUNCATE TABLE
    "users", "customers", "customer_documents", "vehicles", "vehicle_images", "vehicle_status_history",
    "leads", "financing_products", "financing_applications", "credit_evaluations", "credit_approvals",
    "loans", "loan_contract_versions", "amortization_installments", "payment_transactions",
    "payment_allocations", "payment_reversals", "account_statements", "collection_cases",
    "collection_activities", "notification_logs", "audit_logs", "system_settings", "expenses";

DO $$
DECLARE
    t TEXT;
    cols TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'customers', 'users', 'vehicles', 'vehicle_images', 'vehicle_status_history', 'leads',
        'financing_products', 'financing_applications', 'credit_evaluations', 'credit_approvals',
        'loans', 'loan_contract_versions', 'amortization_installments', 'payment_transactions',
        'payment_allocations', 'payment_reversals', 'account_statements', 'collection_cases',
        'collection_activities', 'customer_documents', 'notification_logs', 'audit_logs',
        'system_settings', 'expenses'
    ] LOOP
        IF to_regclass(format('"backup_20261103".%I', t)) IS NULL THEN
            RAISE EXCEPTION 'Falta la tabla de respaldo backup_20261103.%', t;
        END IF;
        -- Lista explícita de columnas (las del respaldo), sin depender del orden físico
        SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
        FROM information_schema.columns
        WHERE table_schema = 'backup_20261103' AND table_name = t;
        EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM "backup_20261103".%I', t, cols, cols, t);
    END LOOP;
END $$;

-- 4. Unicidades globales originales -------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "customers_code_key" ON "customers"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "customers_dui_key" ON "customers"("dui");
CREATE UNIQUE INDEX IF NOT EXISTS "customers_nit_key" ON "customers"("nit");
CREATE UNIQUE INDEX IF NOT EXISTS "customers_email_key" ON "customers"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_code_key" ON "vehicles"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "leads_code_key" ON "leads"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "financing_products_code_key" ON "financing_products"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "financing_applications_code_key" ON "financing_applications"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "loans_code_key" ON "loans"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_transactions_code_key" ON "payment_transactions"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "system_settings_key_key" ON "system_settings"("key");
CREATE UNIQUE INDEX IF NOT EXISTS "expenses_code_key" ON "expenses"("code");

-- 5. Historial de Prisma --------------------------------------------------------
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261103000000_multitenant';

-- 6. Verificación: los conteos deben coincidir con el manifiesto ---------------
DO $$
DECLARE
    r RECORD;
    n BIGINT;
BEGIN
    FOR r IN SELECT "table_name", "row_count" FROM "backup_20261103"."_manifest" LOOP
        IF to_regclass(format('public.%I', r.table_name)) IS NULL THEN
            CONTINUE;
        END IF;
        EXECUTE format('SELECT count(*) FROM public.%I', r.table_name) INTO n;
        IF n <> r.row_count THEN
            RAISE EXCEPTION 'Conteo distinto en %: respaldo %, restaurado %', r.table_name, r.row_count, n;
        END IF;
    END LOOP;
END $$;

COMMIT;

-- Después de COMMIT, para revisar:
-- SELECT * FROM "backup_20261103"."_manifest" ORDER BY 1;
