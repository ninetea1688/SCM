/** APPR-03: internal post discussion routes. */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { type Db } from '@scm/db';
import {
  type AuthUser,
  CurrentUser,
  RequirePermission,
  Tenant,
  type TenantInfo,
} from '../auth/auth.types';
import { APP_DB } from '../common/db-tokens';
import { parseInput } from '../common/zod';
import { TenantGuard } from '../tenancy/tenant.guard';
import { InternalCommentInput, PostDiscussionService } from './post-discussion.service';

@Controller('posts')
@UseGuards(TenantGuard)
export class PostDiscussionController {
  constructor(
    private readonly discussion: PostDiscussionService,
    @Inject(APP_DB) readonly _db: Db,
  ) {}

  @Get(':id/comments')
  @RequirePermission('report.view')
  list(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.discussion.list(t, u, id);
  }

  @Post(':id/comments')
  @HttpCode(200)
  @RequirePermission('post.edit')
  add(
    @Tenant() t: TenantInfo,
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() b: unknown,
  ) {
    return this.discussion.add(t, u, id, parseInput(InternalCommentInput, b).text);
  }
}
