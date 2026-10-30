import { Global, Module } from '@nestjs/common';
import { GoogleDriveService } from './google-drive.service';
import { StorageController } from './storage.controller';

@Global()
@Module({
  controllers: [StorageController],
  providers: [GoogleDriveService],
  exports: [GoogleDriveService],
})
export class StorageModule {}
