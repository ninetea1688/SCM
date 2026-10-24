/** Unified Inbox + comments desk + engagement snapshots (INBOX-01/02, ANA-01 skeleton). */
import { Module } from '@nestjs/common';
import { PublishingModule } from '../publishing/publishing.module';
import { AnalyticsService } from './analytics.service';
import { CommentsService } from './comments.service';
import { EngageController } from './engage.controller';
import { InboxService } from './inbox.service';

@Module({
  imports: [PublishingModule],
  controllers: [EngageController],
  providers: [InboxService, CommentsService, AnalyticsService],
  exports: [InboxService, CommentsService, AnalyticsService],
})
export class EngageModule {}
