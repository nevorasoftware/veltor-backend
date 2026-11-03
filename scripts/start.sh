#!/bin/sh
# Arranque de producción: aplica migraciones pendientes y luego inicia la API.
# No siembra datos: solo `prisma migrate deploy` (nunca `db seed`, `db push` ni `migrate reset`).
set -e

# Migraciones transaccionales e idempotentes: si una falló, Postgres la revirtió
# entera y es seguro marcarla como revertida y reintentarla una vez
# (p. ej. tras un lock_timeout por una transacción larga de la versión anterior).
RETRYABLE="20261103000000_multitenant 20261104000000_loan_insurance_initial_load 20261105000000_partial_initial_load"

deploy() {
  status=0
  npx prisma migrate deploy > /tmp/migrate.log 2>&1 || status=$?
  cat /tmp/migrate.log
  return $status
}

echo "[start] Aplicando migraciones de base de datos..."
if ! deploy; then
  if grep -q "P3005" /tmp/migrate.log; then
    # P3005: la base ya tenía tablas (creada con `prisma db push`) pero sin historial de migraciones.
    # Se marca la migración inicial como aplicada (línea base) y se reintenta.
    echo "[start] Registrando la migración inicial como línea base y reintentando..."
    npx prisma migrate resolve --applied 20261025000000_init
    deploy
  elif grep -q "P3009" /tmp/migrate.log && failed=$(for m in $RETRYABLE; do grep -q "$m" /tmp/migrate.log && echo "$m" && break; done) && [ -n "$failed" ]; then
    echo "[start] $failed falló antes (transacción revertida). Se marca como revertida y se reintenta una vez..."
    npx prisma migrate resolve --rolled-back "$failed"
    deploy
  else
    echo "[start] ERROR: las migraciones fallaron; la API no se inicia." >&2
    exit 1
  fi
fi

echo "[start] Iniciando VELTOR API..."
exec node dist/main.js
