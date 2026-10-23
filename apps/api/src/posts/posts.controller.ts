import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PLATFORMS, VARIANT_STATUSES } from '@scm/domain';
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
import { PostsService } from './posts.service';

const Options = z
  .object({
    igFormat: z.enum(['feed', 'reel', 'story', 'carousel']).optional(),
    fbFormat: z.enum(['feed', 'reel']).optional(),
    ytTitle: z.string().max(200).optional(),
    lineMode: z.enum(['broadcast', 'narrowcast']).optional(),
  })
  .strict();
const VariantIn = z.object({
  socialAccountId: z.uuid(),
  caption: z.string().max(70_000).optional(),
  options: Options.optional(),
  mediaIds: z.array(z.uuid()).max(35).optional(),
});
const CreatePost = z.object({
  title: z.string().min(1).max(300),
  body: z.string().max(70_000).optional(),
  campaignId: z.uuid().optional(),
  variants: z.array(VariantIn).min(1).max(20),
});
const EditVariant = VariantIn.omit({ socialAccountId: true });
const Comment = z.object({ comment: z.string().max(2000).optional() });
const Schedule = z.object({ scheduledAt: z.coerce.date() });
const Calendar = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  platforms: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : undefined))
    .pipe(z.array(z.enum(PLATFORMS)).optional()),
  statuses: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : undefined))
    .pipe(z.array(z.enum(VARIANT_STATUSES)).optional()),
});
const KillSwitch = z.object({ active: z.boolean() });
const Resume = z.object({ variantIds: z.union([z.array(z.uuid()).min(1), z.literal('all')]) });

@Controller()
@UseGuards(TenantGuard)
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Post('posts')
  @RequirePermission('post.edit')
  create(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.posts.create(t, u, parseInput(CreatePost, body));
  }

  @Get('posts/:id')
  @RequirePermission('report.view')
  get(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.posts.get(t, u, id);
  }

  @Get('calendar')
  @RequirePermission('report.view')
  calendar(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Query() q: unknown) {
    return this.posts.calendar(t, u, parseInput(Calendar, q));
  }

  @Get('backlog')
  @RequirePermission('report.view')
  backlog(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser) {
    return this.posts.backlog(t, u);
  }

  @Patch('variants/:id')
  @RequirePermission('post.edit')
  edit(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.posts.editVariant(t, u, id, parseInput(EditVariant, b));
  }

  @Get('variants/:id/validate')
  @RequirePermission('post.edit')
  validate(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.posts.validate(t, u, id);
  }

  @Post('variants/:id/develop')
  @HttpCode(200)
  @RequirePermission('post.edit')
  develop(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.posts.act(t, u, id, 'develop', { permission: 'post.edit' });
  }

  @Post('variants/:id/submit')
  @HttpCode(200)
  @RequirePermission('post.edit')
  submit(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.posts.act(t, u, id, 'submit', { permission: 'post.edit' });
  }

  @Post('variants/:id/approve')
  @HttpCode(200)
  @RequirePermission('post.approve')
  approve(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.posts.act(t, u, id, 'approve', {
      ...parseInput(Comment, b ?? {}),
      permission: 'post.approve',
    });
  }

  @Post('variants/:id/request-changes')
  @HttpCode(200)
  @RequirePermission('post.approve')
  requestChanges(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.posts.act(t, u, id, 'request_changes', {
      ...parseInput(Comment, b ?? {}),
      permission: 'post.approve',
    });
  }

  @Post('variants/:id/reject')
  @HttpCode(200)
  @RequirePermission('post.approve')
  reject(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.posts.act(t, u, id, 'reject', {
      ...parseInput(Comment, b ?? {}),
      permission: 'post.approve',
    });
  }

  @Post('variants/:id/reopen')
  @HttpCode(200)
  @RequirePermission('post.edit')
  reopen(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.posts.act(t, u, id, 'reopen', { permission: 'post.edit' });
  }

  @Post('variants/:id/schedule')
  @HttpCode(200)
  @RequirePermission('post.schedule')
  schedule(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() b: unknown,
  ) {
    return this.posts.act(t, u, id, 'schedule', {
      ...parseInput(Schedule, b),
      permission: 'post.schedule',
    });
  }

  @Post('variants/:id/unschedule')
  @HttpCode(200)
  @RequirePermission('post.schedule')
  unschedule(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.posts.act(t, u, id, 'unschedule', { permission: 'post.schedule' });
  }

  @Post('variants/:id/cancel')
  @HttpCode(200)
  @RequirePermission('post.edit')
  cancel(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.posts.act(t, u, id, 'cancel', { permission: 'post.edit' });
  }

  @Post('variants/:id/revise')
  @HttpCode(200)
  @RequirePermission('post.edit')
  revise(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.posts.act(t, u, id, 'revise', { permission: 'post.edit' });
  }

  @Post('kill-switch')
  @HttpCode(200)
  @RequirePermission('killswitch.toggle')
  killSwitch(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body() b: unknown) {
    return this.posts.setKillSwitch(t, u, parseInput(KillSwitch, b).active);
  }

  @Post('kill-switch/resume')
  @HttpCode(200)
  @RequirePermission('killswitch.toggle')
  resume(@Tenant() t: TenantInfo, @CurrentUser() u: AuthUser, @Body() b: unknown) {
    return this.posts.resume(t, u, parseInput(Resume, b).variantIds);
  }
}
