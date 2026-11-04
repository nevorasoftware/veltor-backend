import { Module } from '@nestjs/common';
import { OnboardingController, PublicRegistrationController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  controllers: [OnboardingController, PublicRegistrationController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
