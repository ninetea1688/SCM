import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { Logger } from 'nestjs-pino';
import { loadConfig } from './config';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const cfg = loadConfig();
  // OPS-02: worker errors are tracked too (transcodes, publish runs).
  if (cfg.SENTRY_DSN) Sentry.init({ dsn: cfg.SENTRY_DSN, environment: cfg.NODE_ENV });
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('worker started');
}

void bootstrap();
