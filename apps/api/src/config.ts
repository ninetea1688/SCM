import { z } from 'zod';

/** All runtime configuration. Validated once at boot; the process exits on bad config. */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().default('postgres://scm_app:scm_app@localhost:5433/scm'),
  DATABASE_SYSTEM_URL: z.string().default('postgres://scm_system:scm_system@localhost:5433/scm'),
  REDIS_URL: z.string().default('redis://localhost:6380'),

  JWT_SECRET: z.string().min(32).default('dev-only-jwt-secret-change-me-0123456789'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().default(15 * 60),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().default(14 * 24 * 3600),
  /** CONN-04: base64 32-byte key(s) "id:key,id:key"; first is used for new writes. */
  TOKEN_ENC_KEYS: z.string().default('k1:ZGV2LW9ubHktMzItYnl0ZS1rZXktY2hhbmdlLW1lISE='),

  S3_ENDPOINT: z.string().default('http://localhost:8333'),
  /** Host used inside signed URLs — must be reachable by browsers and platforms. */
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('scm-media'),
  S3_ACCESS_KEY: z.string().default('scm'),
  S3_SECRET_KEY: z.string().default('scm-s3-secret'),
  S3_FORCE_PATH_STYLE: z.stringbool().default(true),
  /** MEDIA-06: platforms fetch media from these; keep short. */
  SIGNED_URL_TTL_SEC: z.coerce.number().default(3600),

  /** `fake` publishes to an in-memory sandbox; `live` calls the real platform APIs. */
  PUBLISHER_MODE: z.enum(['fake', 'live']).default('fake'),
  META_GRAPH_VERSION: z.string().default('v24.0'),
  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  /** CONN AC: warn when a token expires within this many days. */
  TOKEN_EXPIRY_WARN_DAYS: z.coerce.number().default(7),
  /** NOTI-01: internal LINE OA for staff alerts (separate from the customer OA). */
  LINE_NOTIFY_CHANNEL_TOKEN: z.string().default(''),
  LINE_NOTIFY_GROUP_ID: z.string().default(''),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type AppConfig = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === 'production') {
    for (const key of ['JWT_SECRET', 'TOKEN_ENC_KEYS', 'S3_SECRET_KEY'] as const) {
      if (cfg[key] === Env.shape[key].parse(undefined)) {
        throw new Error(`${key} must be set explicitly in production`);
      }
    }
  }
  return cfg;
}

export const CONFIG = Symbol('CONFIG');
