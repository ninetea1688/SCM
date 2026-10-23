import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { NotificationService } from '../notifications/notification.service';
import { AdapterRegistry } from './adapters/registry';
import { PublishRunner } from './publish-runner.service';
import { PUBLISH_QUEUE, PublishQueue } from './queue';

@Module({
  imports: [BullModule.registerQueue({ name: PUBLISH_QUEUE }), MediaModule],
  providers: [PublishQueue, PublishRunner, AdapterRegistry, NotificationService],
  exports: [PublishQueue, PublishRunner, AdapterRegistry, NotificationService, MediaModule],
})
export class PublishingModule {}
