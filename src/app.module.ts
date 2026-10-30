import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { DomainEventsModule } from './common/domain-events';
import { MailModule } from './mail/mail.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { LeadsModule } from './leads/leads.module';
import { FinanceModule } from './finance/finance.module';
import { CustomersModule } from './customers/customers.module';
import { ReportsModule } from './reports/reports.module';
import { DocumentsModule } from './documents/documents.module';
import { PdfModule } from './pdf/pdf.module';
import { SettingsModule } from './settings/settings.module';
import { ExpensesModule } from './expenses/expenses.module';
import { PortalModule } from './portal/portal.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { StorageModule } from './storage/storage.module';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL || 60) * 1000,
        limit: Number(process.env.THROTTLE_LIMIT || 300),
      },
    ]),
    ScheduleModule.forRoot(),
    PrismaModule,
    DomainEventsModule,
    StorageModule,
    MailModule,
    AuthModule,
    VehiclesModule,
    LeadsModule,
    FinanceModule,
    CustomersModule,
    ReportsModule,
    DocumentsModule,
    PdfModule,
    SettingsModule,
    ExpensesModule,
    PortalModule,
    NotificationsModule,
    BootstrapModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
