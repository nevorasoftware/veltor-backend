# VELTOR — Backend & Motor Financiero

> **Financiamiento inteligente. Movilidad a tu alcance.**  
> Sistema de gestión y financiamiento digital de vehículos desarrollado y respaldado por **Nevora Software**.

---

## 1. Identidad del Producto

- **Nombre comercial:** VELTOR
- **Empresa desarrolladora:** Nevora Software
- **Mercado objetivo:** El Salvador
- **Moneda:** Dólares de los Estados Unidos (USD)
- **Zona horaria:** `America/El_Salvador` (UTC-6)
- **Repositorio oficial:** `https://github.com/nevorasoftware/veltor-backend.git`

---

## 2. Arquitectura y Tecnologías

- **Framework:** NestJS 11 + TypeScript
- **ORM & Base de Datos:** Prisma ORM + PostgreSQL
- **Aritmética Financiera:** `decimal.js` (40 dígitos de precisión, sin redondeos binarios flotantes)
- **Documentación de API:** Swagger / OpenAPI disponible en `/docs`
- **Generación de Reportes:** `pdfkit` (Tablas de amortización y estados de cuenta oficiales)
- **Seguridad:** Argon2, JWT con refresh tokens, RBAC granular con 9 roles, Helmet y Throttler
- **Contenedores y Despliegue:** Dockerfile multi-etapa optimizado para Railway

---

## 3. Módulos Implementados

| Módulo | Endpoint Base | Descripción |
|---|---|---|
| **Motor Financiero** | `/api/v1/finance` | Replay ledger determinista, abonos a capital (`REDUCE_TERM` / `REDUCE_INSTALLMENT`), cancelaciones anticipadas (`PAYOFF`), reversiones de pago |
| **Simulador de Crédito** | `/api/v1/simulator` | Cálculo de cuota nivelada francesa y tabla de amortización preliminar |
| **Catálogo de Vehículos** | `/api/v1/vehicles` | CRUD de flota, galería de fotos, filtros por marca/precio/tipo y trazabilidad de estados |
| **Captación de Prospectos** | `/api/v1/leads` | Formulario público de leads sin requerir registro previo, con consentimiento de privacidad |
| **Clientes y Expedientes** | `/api/v1/customers` | Gestión integral de clientes con validación salvadoreña (DUI/NIT) y scoring crediticio |
| **Expedientes Documentales** | `/api/v1/customers/:id/documents` | Carga de DUI, comprobantes de ingresos y recibos de servicios, con flujo de aprobación/rechazo |
| **Reportes y PDFs** | `/api/v1/finance/loans/:id/*.pdf` | Emisión y streaming de Estado de Cuenta y Tabla de Amortización con marca VELTOR |
| **Métricas de Cartera** | `/api/v1/reports` | Métricas de colocación, recaudación del mes, mora y estado de inventario |
| **Salud del Sistema** | `/api/v1/health` | Health check para orquestadores en la nube y Railway |

---

## 4. Pruebas Financieras Automatizadas (17/17 Aprobadas)

El motor financiero incluye una suite de pruebas unitarias exhaustivas ejecutadas con `npm run test:unit`:

1. **Tasa de interés cero:** cuota exacta `P / n`, cero intereses devengados.
2. **Prima igual al precio:** capital inicial cero, crédito liquidado sin deuda.
3. **Plazos y tasas variados:** amortizaciones a 12, 24, 48 y 60 meses con cierre en $0.00.
4. **Primera cuota irregular:** devengo exacto de días transcurridos reales.
5. **Pago exacto al vencimiento:** aplicación sin mora a interés y capital.
6. **Pago con mora:** devengo según tasa moratoria y periodo de gracia.
7. **Pago parcial:** cobertura prioritaria de mora e intereses, saldo restante a capital.
8. **Pago duplicado:** aplicación secuencial a cuotas futuras o excedente.
9. **Abono extraordinario:** reprogramación inmediata del capital insoluto.
10. **Abono con reducción de plazo (`REDUCE_TERM`):** cuota nivelada similar, menos periodos restantes.
11. **Abono con reducción de cuota (`REDUCE_INSTALLMENT`):** mismo plazo, cuota mensual menor.
12. **Cancelación total anticipada (`PAYOFF`):** cotización exacta y liquidación total.
13. **Reversión de pago:** reconstrucción íntegra de saldos desde los eventos contables no revertidos.
14. **Reestructuración autorizada:** capitalización de vencidos y nueva tabla contractual.
15. **Ajuste de redondeo en última cuota:** saldo residual exacto a $0.00.
16. **Movimientos entre vencimientos:** reconocimiento de intereses devengados.
17. **Operaciones concurrentes:** idempotencia y ordenamiento secuencial estricto.

---

## 5. Puesta en Marcha Local

### Prerrequisitos
- Node.js 20+
- PostgreSQL (puedes usar el `docker-compose.yml` en la raíz del proyecto)

### Pasos
```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env

# 3. Ejecutar pruebas unitarias financieras
npm run test:unit

# 4. Generar cliente de Prisma y aplicar migraciones
npm run prisma:generate
npm run prisma:migrate:dev

# 5. Cargar datos de prueba (usuarios demo, vehículos y créditos)
npm run prisma:seed

# 6. Iniciar servidor en modo desarrollo
npm run start:dev
```

La API estará disponible en `http://localhost:4000/api/v1` y la documentación interactiva Swagger en `http://localhost:4000/docs`.

---

## 6. Despliegue en Railway

El proyecto incluye `Dockerfile` y `railway.json`. Para desplegar:
1. Conectar el repositorio de GitHub `nevorasoftware/veltor-backend`.
2. Agregar un servicio de base de datos **PostgreSQL** en Railway.
3. Configurar la variable de entorno `DATABASE_URL` conectada al PostgreSQL de Railway.
4. Definir las variables `JWT_SECRET`, `JWT_REFRESH_SECRET` y `FRONTEND_URL`.
5. Railway compilará automáticamente la imagen y ejecutará las migraciones al iniciar el contenedor.

---

*VELTOR — Una solución tecnológica de Nevora Software*
