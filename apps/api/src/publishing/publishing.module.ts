import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { StorageService } from '../media/storage.service';
import { NotificationService } from '../notifications/notification.service';
import { AdapterRegistry } from './adapters/registry';
import { PublishRunner } from './publish-runner.service';
import { PUBLISH_QUEUE, PublishQueue } from './queue';

@Module({
  imports: [BullModule.registerQueue({ name: PUBLISH_QUEUE })],
  providers: [PublishQueue, PublishRunner, AdapterRegistry, StorageService, NotificationService],
  exports: [PublishQueue, PublishRunner, AdapterRegistry, StorageService, NotificationService],
})
export class PublishingModule {}
