import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { WhatsappInboxController, WhatsappWebhookController } from './whatsapp-inbox.controller';
import { WhatsappInboxService } from './whatsapp-inbox.service';

@Module({
  imports: [DocumentsModule],
  controllers: [WhatsappWebhookController, WhatsappInboxController],
  providers: [WhatsappInboxService],
})
export class WhatsappInboxModule {}
