-- Limpieza única de los datos de demostración cargados por el seed anterior
-- (usuarios demo, vehículos, clientes, créditos, pagos, prospectos, gastos y parámetros).
-- Prisma ejecuta cada migración una sola vez; el superadministrador y el producto
-- financiero se recrean al arrancar desde las variables BOOTSTRAP_ADMIN_* / PRODUCT_*.
TRUNCATE TABLE
  "payment_allocations",
  "payment_reversals",
  "payment_transactions",
  "amortization_installments",
  "loan_contract_versions",
  "account_statements",
  "collection_activities",
  "collection_cases",
  "credit_evaluations",
  "credit_approvals",
  "loans",
  "financing_applications",
  "customer_documents",
  "leads",
  "vehicle_status_history",
  "vehicle_images",
  "vehicles",
  "audit_logs",
  "notification_logs",
  "users",
  "customers",
  "financing_products",
  "system_settings",
  "expenses"
CASCADE;
