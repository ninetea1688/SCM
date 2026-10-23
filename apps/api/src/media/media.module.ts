import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MediaProcessor } from './media-processor.service';
import { MEDIA_QUEUE, MediaQueue } from './media-queue';
import { StorageService } from './storage.service';

@Module({
  imports: [BullModule.registerQueue({ name: MEDIA_QUEUE })],
  providers: [StorageService, MediaQueue, MediaProcessor],
  exports: [StorageService, MediaQueue, MediaProcessor],
})
export class MediaModule {}
