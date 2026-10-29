-- Módulo de gastos: la tabla existía en el schema pero nunca se creó por migración.
-- Idempotente por si la base fue sincronizada antes con `prisma db push`.

DO $$ BEGIN
  CREATE TYPE "ExpenseCategoryType" AS ENUM ('PRODUCT', 'SERVICE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ExpenseStatus" AS ENUM ('PAID', 'PENDING', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "expenses" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "categoryType" "ExpenseCategoryType" NOT NULL,
    "subcategory" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1.00,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "expenseDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT,
    "invoiceNumber" TEXT,
    "paymentMethod" TEXT,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'PAID',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "expenses_code_key" ON "expenses"("code");
CREATE INDEX IF NOT EXISTS "expenses_categoryType_idx" ON "expenses"("categoryType");
CREATE INDEX IF NOT EXISTS "expenses_expenseDate_idx" ON "expenses"("expenseDate");
CREATE INDEX IF NOT EXISTS "expenses_status_idx" ON "expenses"("status");
