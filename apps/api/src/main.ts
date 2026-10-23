import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { StorageService } from './media/storage.service';

async function bootstrap() {
  const cfg = loadConfig();
  // rawBody: webhook signatures are computed over the exact bytes (SEC-03).
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({ origin: cfg.WEB_ORIGIN.split(','), credentials: true });
  app.setGlobalPrefix('api', { exclude: ['health', 'webhooks/{*path}'] });
  app.enableShutdownHooks();
  await app
    .get(StorageService)
    .ensureBucket()
    .catch((e) => {
      app.get(Logger).warn(`storage not ready: ${(e as Error).message}`);
    });
  await app.listen(cfg.PORT, '0.0.0.0');
}

void bootstrap();
