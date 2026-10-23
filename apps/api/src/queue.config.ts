import { BullModule } from '@nestjs/bullmq';
import { type AppConfig, CONFIG } from './config';

export const bullRoot = BullModule.forRootAsync({
  inject: [CONFIG],
  useFactory: (cfg: AppConfig) => {
    const url = new URL(cfg.REDIS_URL);
    return {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
        password: url.password || undefined,
        db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
      },
      prefix: 'scm',
    };
  },
});
