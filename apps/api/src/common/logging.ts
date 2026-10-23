import type { Params } from 'nestjs-pino';
import type { AppConfig } from '../config';

/** Structured JSON logs (OPS-02); secrets are censored at the logger, too. */
export function pinoParams(cfg: AppConfig): Params {
  return {
    pinoHttp: {
      level: cfg.LOG_LEVEL,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-line-signature"]',
          '*.accessToken',
          '*.refreshToken',
          '*.password',
        ],
        censor: '[REDACTED]',
      },
      transport:
        cfg.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true } }
          : undefined,
      autoLogging: { ignore: (req) => req.url === '/health' },
    },
  };
}
