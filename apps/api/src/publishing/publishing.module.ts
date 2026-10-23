import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AccountHealthService } from '../accounts/account-health.service';
import { MediaModule } from '../media/media.module';
import { NotificationService } from '../notifications/notification.service';
import { AdapterRegistry } from './adapters/registry';
import { PublishRunner } from './publish-runner.service';
import { PUBLISH_QUEUE, PublishQueue } from './queue';

@Module({
  imports: [BullModule.registerQueue({ name: PUBLISH_QUEUE }), MediaModule],
  providers: [
    PublishQueue,
    PublishRunner,
    AdapterRegistry,
    NotificationService,
    AccountHealthService,
  ],
  exports: [
    PublishQueue,
    PublishRunner,
    AdapterRegistry,
    NotificationService,
    AccountHealthService,
    MediaModule,
  ],
})
export class PublishingModule {}
