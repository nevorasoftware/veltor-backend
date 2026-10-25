# ------------------------------------------------------------------------------
# VELTOR Backend — Dockerfile Multistage de Producción
# Desarrollado por Nevora Software
# ------------------------------------------------------------------------------

# Etapa 1: Construcción
FROM node:22-alpine AS builder

WORKDIR /app

# Instalar dependencias necesarias para compilar y prisma
RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

# Generar cliente de Prisma y compilar NestJS
RUN npx prisma generate
RUN npm run build

# Etapa 2: Imagen de Ejecución
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production
ENV PORT=4000

# Copiar dependencias de producción y binarios compilados
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --only=production
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

# Crear directorio para documentos y expedientes
RUN mkdir -p uploads/documents && chown -R node:node /app

USER node

EXPOSE 4000

# Script de arranque con soporte para migraciones en la nube
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
