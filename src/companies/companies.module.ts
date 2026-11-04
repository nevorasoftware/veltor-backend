import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompanyController, PlatformCompaniesController, PublicCompanyController } from './companies.controller';
import { PwaController } from './pwa.controller';

@Module({
  controllers: [PlatformCompaniesController, CompanyController, PublicCompanyController, PwaController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
