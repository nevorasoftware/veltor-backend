import { Module } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CompanyController, PlatformCompaniesController, PublicCompanyController } from './companies.controller';

@Module({
  controllers: [PlatformCompaniesController, CompanyController, PublicCompanyController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
