import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { PdfModule } from '../pdf/pdf.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [FinanceModule, PdfModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
