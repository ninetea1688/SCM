import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AccountsController } from './accounts/accounts.controller';
import { AccountsService } from './accounts/accounts.service';
import { MetaOauthController } from './accounts/meta-oauth.controller';
import { AuthModule } from './auth/auth.module';
import { JwtGuard } from './auth/jwt.guard';
import { CoreModule } from './common/core.module';
import { pinoParams } from './common/logging';
import { loadConfig } from './config';
import { HealthController } from './health/health.controller';
import { OpsController } from './health/ops.controller';
import { EngageModule } from './inbox/engage.module';
import { MediaController } from './media/media.controller';
import { PdpaController } from './pdpa/pdpa.controller';
import { PdpaService } from './pdpa/pdpa.service';
import { PostsController } from './posts/posts.controller';
import { PostsService } from './posts/posts.service';
import { PublishingModule } from './publishing/publishing.module';
import { bullRoot } from './queue.config';
import { TenantGuard } from './tenancy/tenant.guard';
import { WebhooksController } from './webhooks/webhooks.controller';
import { WorkspacesController } from './workspaces/workspaces.controller';
import { WorkspacesService } from './workspaces/workspaces.service';

/** HTTP API process. The worker process is WorkerModule (worker.module.ts). */
@Module({
  imports: [
    LoggerModule.forRoot(pinoParams(loadConfig())),
    CoreModule,
    AuthModule,
    bullRoot,
    PublishingModule,
    EngageModule,
  ],
  controllers: [
    HealthController,
    OpsController,
    WorkspacesController,
    AccountsController,
    MetaOauthController,
    PostsController,
    MediaController,
    PdpaController,
    WebhooksController,
  ],
  providers: [
    { provide: APP_GUARD, useExisting: JwtGuard },
    TenantGuard,
    WorkspacesService,
    AccountsService,
    PdpaService,
    PostsService,
  ],
})
export class AppModule {}
