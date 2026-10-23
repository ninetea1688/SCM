import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CoreModule } from './common/core.module';
import { pinoParams } from './common/logging';
import { loadConfig } from './config';
import { MediaJobProcessor } from './media/media.processor';
import { MediaSweeper } from './media/media-sweeper.service';
import { PublishProcessor } from './publishing/publish.processor';
import { PublishingModule } from './publishing/publishing.module';
import { SweeperService } from './publishing/sweeper.service';
import { bullRoot } from './queue.config';

/** Worker process: queue consumers and periodic system jobs. No HTTP routes. */
@Module({
  imports: [LoggerModule.forRoot(pinoParams(loadConfig())), CoreModule, bullRoot, PublishingModule],
  providers: [PublishProcessor, MediaJobProcessor, SweeperService, MediaSweeper],
})
export class WorkerModule {}
