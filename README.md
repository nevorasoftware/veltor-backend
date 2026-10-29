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
- **Seguridad:** Argon2, JWT, RBAC granular con 9 roles, Helmet y Throttler
- **Contenedores y Despliegue:** Dockerfile multi-etapa optimizado para Railway

---

## 3. Módulos Implementados

| Módulo | Endpoint Base | Descripción |
|---|---|---|
| **Motor Financiero** | `/api/v1/finance` | Replay ledger determinista, abonos a capital (`REDUCE_TERM` / `REDUCE_INSTALLMENT`), cancelaciones anticipadas (`PAYOFF`), reversiones de pago |
| **Simulador de Crédito** | `/api/v1/simulator` | Cálculo de cuota nivelada francesa y tabla de amortización preliminar |
| **Catálogo de Vehículos** | `/api/v1/vehicles` | CRUD de flota, galería de fotos, filtros por marca/precio/tipo y trazabilidad de estados |
| **Portal del Cliente** | `/api/v1/portal` | Créditos, tabla de amortización e historial de pagos del cliente autenticado |
| **Control de Gastos** | `/api/v1/expenses` | Registro y contabilización de gastos por productos y servicios |
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

## 5. Seguridad y Roles

- Todos los endpoints requieren token JWT salvo los públicos: `POST /auth/login`, `GET /vehicles`, `GET /vehicles/:id`, `POST /leads`, `POST /simulator/calculate`, `GET /settings/public` y `GET /health`.
- Los endpoints sin `@Roles` son de uso interno (cualquier rol de personal, nunca `CUSTOMER`).
- El portal del cliente (`/portal/*`) y los PDFs de sus créditos solo exponen datos del cliente autenticado.
- Registrar pagos: `ADMIN`, `CASHIER`, `COLLECTIONS_AGENT`. Revertir pagos: `ADMIN`, `APPROVAL_OFFICER`. `SUPERADMIN` puede todo.

## 6. Datos Iniciales

La base de datos arranca **vacía**: no hay vehículos, clientes ni créditos de demostración. Al iniciar, la API solo crea:

1. Un superadministrador (`BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`) si no existe ningún usuario de personal. Si no se define contraseña, se genera una temporal y se imprime en los logs. Se exige cambiarla al primer ingreso.
2. El producto financiero por defecto (variables `PRODUCT_*`) si no hay uno activo.

El acceso de un cliente al portal se habilita desde el panel (botón **Acceso al portal** en el crédito), que genera una contraseña temporal.

## 7. Puesta en Marcha Local

```bash
docker compose up -d          # PostgreSQL local (opcional)
npm install
cp .env.example .env          # completar JWT_SECRET y BOOTSTRAP_ADMIN_EMAIL
npm run prisma:migrate:dev
npm run start:dev
npm run test:unit             # pruebas del motor financiero
npm run db:reset              # borra TODOS los datos y reaplica migraciones
```

## 8. Despliegue en Railway

El contenedor ejecuta `scripts/start.sh`, que aplica `prisma migrate deploy` antes de iniciar la API.
Variables requeridas: `DATABASE_URL`, `JWT_SECRET`, `BOOTSTRAP_ADMIN_EMAIL` (y opcionalmente `BOOTSTRAP_ADMIN_PASSWORD`).

> Los documentos de clientes se guardan en disco (`uploads/documents`). En Railway el disco del contenedor es efímero: monte un **Volume** en `/app/uploads` para conservarlos entre despliegues.

---

*VELTOR — Una solución tecnológica de Nevora Software*
