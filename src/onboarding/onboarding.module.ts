import { Module } from '@nestjs/common';
import { OnboardingController, PublicRegistrationController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [DocumentsModule],
  controllers: [OnboardingController, PublicRegistrationController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
