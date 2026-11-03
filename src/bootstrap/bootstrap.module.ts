import { Module } from '@nestjs/common';
import { BootstrapService } from './bootstrap.service';
import { CompaniesModule } from '../companies/companies.module';

@Module({
  imports: [CompaniesModule],
  providers: [BootstrapService],
})
export class BootstrapModule {}
