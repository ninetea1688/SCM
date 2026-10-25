/** INBOX-01..06: chat desk, comment desk, saved replies, analytics — per post × platform. */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  type AuthUser,
  CurrentUser,
  RequirePermission,
  Tenant,
  type TenantInfo,
} from '../auth/auth.types';
import { parseInput } from '../common/zod';
import { TenantGuard } from '../tenancy/tenant.guard';
import { AnalyticsService } from './analytics.service';
import { CommentsService } from './comments.service';
import { InboxService } from './inbox.service';
import { SavedRepliesService, SavedReplyInput } from './saved-replies.service';

const Reply = z.object({ text: z.string().min(1).max(5000) });
const Status = z.object({ status: z.enum(['open', 'claimed', 'closed']) });
const Hide = z.object({ reason: z.string().max(300).optional() });
const ListQuery = z.object({
  status: z.enum(['open', 'claimed', 'closed', 'pending', 'replied', 'hidden']).optional(),
  platform: z.string().max(20).optional(),
  postId: z.string().uuid().optional(),
});

@Controller()
@UseGuards(TenantGuard)
export class EngageController {
  constructor(
    private readonly inbox: InboxService,
    private readonly commentDesk: CommentsService,
    private readonly metrics: AnalyticsService,
    private readonly saved: SavedRepliesService,
  ) {}

  @Get('inbox/conversations')
  @RequirePermission('inbox.reply')
  conversations(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Query() q: unknown) {
    return this.inbox.conversations(t, u, parseInput(ListQuery, q));
  }

  /** CRM-01: contact profile + history stats. */
  @Get('inbox/conversations/:id/profile')
  @RequirePermission('inbox.reply')
  profile(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inbox.profile(t, u, id);
  }

  @Get('inbox/conversations/:id/messages')
  @RequirePermission('inbox.reply')
  messages(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inbox.messages(t, u, id);
  }

  /** Answering claims the thread (INBOX-02). */
  @Post('inbox/conversations/:id/reply')
  @HttpCode(200)
  @RequirePermission('inbox.reply')
  reply(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.inbox.reply(t, u, id, parseInput(Reply, b).text);
  }

  @Post('inbox/conversations/:id/status')
  @HttpCode(200)
  @RequirePermission('inbox.reply')
  setStatus(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.inbox.setStatus(t, u, id, parseInput(Status, b).status);
  }

  /** INBOX-09: supervisor approves a pending sensitive reply → it goes out now. */
  @Post('inbox/messages/:id/approve')
  @HttpCode(200)
  @RequirePermission('inbox.reply')
  approveMessage(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inbox.reviewMessage(t, u, id, 'approved');
  }

  /** INBOX-09: supervisor rejects → back to the agent for redrafting. */
  @Post('inbox/messages/:id/reject')
  @HttpCode(200)
  @RequirePermission('inbox.reply')
  rejectMessage(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.inbox.reviewMessage(t, u, id, 'rejected');
  }

  /** INBOX-06: internal note — stored on the thread, never sent to the customer. */
  @Post('inbox/conversations/:id/note')
  @HttpCode(200)
  @RequirePermission('inbox.reply')
  addNote(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.inbox.addNote(t, u, id, parseInput(Reply, b).text);
  }

  /** INBOX-05: standard answers for the reply composer. */
  @Get('saved-replies')
  @RequirePermission('inbox.reply')
  savedReplies(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser) {
    return this.saved.list(t, u);
  }

  @Post('saved-replies')
  @HttpCode(200)
  @RequirePermission('inbox.reply')
  createSavedReply(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body() b: unknown) {
    return this.saved.create(t, u, parseInput(SavedReplyInput, b));
  }

  @Patch('saved-replies/:id')
  @HttpCode(200)
  @RequirePermission('inbox.reply')
  updateSavedReply(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.saved.update(t, u, id, parseInput(SavedReplyInput, b));
  }

  @Delete('saved-replies/:id')
  @HttpCode(200)
  @RequirePermission('inbox.reply')
  deleteSavedReply(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.saved.remove(t, u, id);
  }

  @Get('comments')
  @RequirePermission('inbox.reply')
  comments(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Query() q: unknown) {
    return this.commentDesk.list(t, u, parseInput(ListQuery, q));
  }

  @Post('comments/:id/reply')
  @HttpCode(200)
  @RequirePermission('inbox.reply')
  replyComment(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.commentDesk.reply(t, u, id, parseInput(Reply, b).text);
  }

  @Post('comments/:id/hide')
  @HttpCode(200)
  @RequirePermission('inbox.reply')
  hideComment(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.commentDesk.hide(t, u, id, parseInput(Hide, b).reason);
  }

  /** MOD-03: staff un-hide — back to the open desk. */
  @Post('comments/:id/unhide')
  @HttpCode(200)
  @RequirePermission('inbox.reply')
  unhideComment(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.commentDesk.unhide(t, u, id);
  }

  @Get('analytics/posts')
  @RequirePermission('report.view')
  analytics(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Query() q: unknown) {
    const { platform } = parseInput(z.object({ platform: z.string().max(20).optional() }), q);
    return this.metrics.overview(t, u, { platform });
  }

  /** ANA-05: 8-layer dashboard aggregates (layers with data sources today). */
  @Get('analytics/summary')
  @RequirePermission('report.view')
  summary(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser) {
    return this.metrics.dashboard(t, u);
  }

  /** ANA-06: KPI targets. */
  @Get('analytics/goals')
  @RequirePermission('report.view')
  getGoals(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser) {
    return this.metrics.goals(t, u);
  }

  @Put('analytics/goals')
  @HttpCode(200)
  @RequirePermission('workspace.policy')
  setGoals(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body() b: unknown) {
    return this.metrics.setGoals(t, u, parseInput(AnalyticsService.GoalInput, b).goals);
  }

  /** Manual collect for demos/tests; the worker timer is the production path. */
  @Post('analytics/collect')
  @HttpCode(200)
  @RequirePermission('report.view')
  collect() {
    return this.metrics.collect();
  }
}
