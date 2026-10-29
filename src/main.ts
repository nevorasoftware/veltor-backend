import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Railway publica la API detrás de un proxy: necesario para que el rate limiting use la IP real
  app.set('trust proxy', 1);

  // Límite de carga para expedientes documentales y fotos de alta resolución (hasta 50MB)
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));

  // Seguridad: Cabeceras HTTP con Helmet
  app.use(
    helmet({
      contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // CORS abierto: la API se autentica con Bearer token (no cookies), así que no hay riesgo de CSRF.
  app.enableCors({ origin: true });

  // Prefijo global de API
  const apiPrefix = process.env.API_PREFIX || 'api/v1';
  app.setGlobalPrefix(apiPrefix);

  // Validación global estricta con DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Documentación Swagger / OpenAPI
  const config = new DocumentBuilder()
    .setTitle('VELTOR — API de Financiamiento de Vehículos')
    .setDescription(
      'Plataforma integral de gestión y financiamiento vehicular. Desarrollado y respaldado por Nevora Software.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addTag('Simulador Financiero', 'Motor de cálculo y proyecciones de financiamiento')
    .addTag('Catálogo de Vehículos', 'Publicación y consulta de inventario vehicular')
    .addTag('Prospectos (Leads)', 'Captación pública de solicitudes sin registro')
    .addTag('Finanzas y Pagos', 'Créditos, amortizaciones, abonos y reversiones')
    .addTag('Gestión de Clientes', 'Expedientes de clientes y solicitudes')
    .addTag('Reportes e Indicadores Financieros', 'Métricas del dashboard y cartera')
    .addTag('Autenticación y Sesiones', 'Seguridad, tokens JWT y control de acceso')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT || 8080;
  await app.listen(port, '0.0.0.0');
  console.log(`=======================================================`);
  console.log(`  VELTOR Backend — Desarrollado por Nevora Software   `);
  console.log(`  Servidor escuchando en: http://localhost:${port}/${apiPrefix}`);
  console.log(`  Documentación Swagger:  http://localhost:${port}/docs`);
  console.log(`=======================================================`);
}

bootstrap();
