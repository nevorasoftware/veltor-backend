#!/bin/sh
# Arranque de producción: aplica migraciones pendientes y luego inicia la API.
set -e

echo "[start] Aplicando migraciones de base de datos..."
if ! npx prisma migrate deploy; then
  # P3005: la base ya tenía tablas (creada con `prisma db push`) pero sin historial de migraciones.
  # Se marca la migración inicial como aplicada (línea base) y se reintenta.
  echo "[start] Registrando la migración inicial como línea base y reintentando..."
  npx prisma migrate resolve --applied 20261025000000_init
  npx prisma migrate deploy
fi

echo "[start] Iniciando VELTOR API..."
exec node dist/main.js
