import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { FinanceController } from './finance.controller';
import { SimulatorController } from './simulator.controller';

@Module({
  controllers: [FinanceController, SimulatorController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
