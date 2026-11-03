-- Tasa mensual de créditos con 10 decimales: 40 % anual / 12 = 0.0333... no cabe en
-- DECIMAL(6,4) y la cuota sale mal (360.51 en vez de 360.70).
-- DECIMAL(6,4) -> DECIMAL(12,10): misma parte entera (2 dígitos), más decimales.
-- Ningún valor existente cambia (0.0300 pasa a 0.0300000000). Idempotente: solo
-- altera la columna si todavía no tiene escala 10. Reescribe la tabla (es pequeña).
-- Productos, solicitudes y aprobaciones se quedan en DECIMAL(6,4).
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['loans', 'loan_contract_versions'] LOOP
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = t AND column_name = 'monthlyRate'
              AND (numeric_precision <> 12 OR numeric_scale <> 10)
        ) THEN
            EXECUTE format('ALTER TABLE %I ALTER COLUMN "monthlyRate" TYPE DECIMAL(12,10)', t);
        END IF;
    END LOOP;
END $$;
