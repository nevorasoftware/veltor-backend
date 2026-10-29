import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { PortalController } from './portal.controller';

@Module({
  imports: [FinanceModule],
  controllers: [PortalController],
})
export class PortalModule {}
