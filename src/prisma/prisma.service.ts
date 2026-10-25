import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    try {
      await this.$connect();
    } catch (err) {
      console.warn('Advertencia: No se pudo conectar a PostgreSQL en inicio. La API continuará en modo seguro.');
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
