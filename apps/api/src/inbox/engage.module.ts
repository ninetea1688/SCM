/** Unified Inbox + comments desk + engagement snapshots (INBOX-01..06, ANA-01 first cut). */
import { Module } from '@nestjs/common';
import { PublishingModule } from '../publishing/publishing.module';
import { AnalyticsService } from './analytics.service';
import { CommentsService } from './comments.service';
import { EngageController } from './engage.controller';
import { InboxService } from './inbox.service';
import { SavedRepliesService } from './saved-replies.service';

@Module({
  imports: [PublishingModule],
  controllers: [EngageController],
  providers: [InboxService, CommentsService, AnalyticsService, SavedRepliesService],
  exports: [InboxService, CommentsService, AnalyticsService, SavedRepliesService],
})
export class EngageModule {}
