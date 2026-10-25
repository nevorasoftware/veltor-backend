# veltor-backend

VELTOR — API y Motor Financiero de Financiamiento de Vehículos.
Desarrollado y respaldado por **Nevora Software**.

## Identidad del Producto
- **Producto:** VELTOR
- **Empresa desarrolladora:** Nevora Software
- **Frase de marca:** Financiamiento inteligente. Movilidad a tu alcance.
- **Mercado inicial:** El Salvador (USD, America/El_Salvador)

## Tecnologías
- Node.js + NestJS + TypeScript
- Prisma ORM + PostgreSQL
- Motor financiero con aritmética decimal de precisión controlada (`decimal.js`)
- Swagger / OpenAPI
- Autenticación JWT con refresh tokens y control de roles (RBAC)
- Despliegue listo para Railway

## Scripts Principales
```bash
# Instalar dependencias
npm install

# Pruebas unitarias del motor financiero
npm run test:unit

# Generar cliente de Prisma
npm run prisma:generate

# Migraciones
npm run prisma:migrate:dev

# Semilla de datos
npm run prisma:seed

# Servidor de desarrollo
npm run start:dev
```
