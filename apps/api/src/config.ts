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
  /** BullMQ key prefix. Tests use their own so a running dev worker never steals test jobs. */
  QUEUE_PREFIX: z.string().default('scm'),

  JWT_SECRET: z.string().min(32).default('dev-only-jwt-secret-change-me-0123456789'),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().default(15 * 60),
  REFRESH_TOKEN_TTL_SEC: z.coerce.number().default(14 * 24 * 3600),
  /** CONN-04: base64 32-byte key(s) "id:key,id:key"; first is used for new writes. */
  TOKEN_ENC_KEYS: z.string().default('k1:ZGV2LW9ubHktMzItYnl0ZS1rZXktY2hhbmdlLW1lISE='),
  /**
   * AUTH-04: enforce 2FA for owner/admin. Default: on in production, off in dev/test
   * (Azure AD/SSO will take over this step later — SEC-02). Set explicitly to override.
   */
  AUTH_ENFORCE_MFA: z.stringbool().optional(),

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

  /** Presigned PUT lifetime for browser uploads (MEDIA-01). */
  UPLOAD_URL_TTL_SEC: z.coerce.number().int().positive().default(900),
  /** Lifetime of thumbnail/preview/original URLs handed to the web UI. */
  PREVIEW_URL_TTL_SEC: z.coerce.number().int().positive().default(900),

  /** MEDIA-03 / ADR-0008 processing limits and rendition settings. */
  MEDIA_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(4 * 1024 ** 3),
  MEDIA_MAX_INPUT_PIXELS: z.coerce.number().int().positive().default(50_000_000),
  MEDIA_MAX_VIDEO_DIMENSION: z.coerce.number().int().positive().default(8192),
  MEDIA_THUMB_PX: z.coerce.number().int().positive().default(320),
  MEDIA_PREVIEW_PX: z.coerce.number().int().positive().default(1280),
  MEDIA_WEBP_QUALITY: z.coerce.number().int().min(1).max(100).default(80),
  MEDIA_PROCESS_TIMEOUT_SEC: z.coerce.number().positive().default(120),
  MEDIA_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  MEDIA_JOB_ATTEMPTS: z.coerce.number().int().positive().default(3),
  /** Fair use: uploads in flight (uploading + processing) per workspace. */
  MEDIA_MAX_INFLIGHT_PER_WORKSPACE: z.coerce.number().int().positive().default(50),
  /** Sweeper: re-enqueue after this long in `processing`; give up after 4× this. */
  MEDIA_STUCK_AFTER_MIN: z.coerce.number().positive().default(15),
  /** MEDIA-04 / ADR-0009 publishable renditions. */
  MEDIA_PUBLISH_IMAGE_MAX_PX: z.coerce.number().int().positive().default(4096),
  MEDIA_PUBLISH_JPEG_QUALITY: z.coerce.number().int().min(1).max(100).default(90),
  MEDIA_PUBLISH_VIDEO_MAX_PX: z.coerce.number().int().positive().default(1920),
  MEDIA_TRANSCODE_TIMEOUT_SEC: z.coerce.number().positive().default(1800),
  /** Worker refreshes `processing_started_at` this often so long transcodes aren't "stuck". */
  MEDIA_HEARTBEAT_SEC: z.coerce.number().positive().default(60),
  HEIF_DEC_PATH: z.string().default('heif-dec'),
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),

  /** `fake` publishes to an in-memory sandbox; `live` calls the real platform APIs. */
  PUBLISHER_MODE: z.enum(['fake', 'live']).default('fake'),
  META_GRAPH_VERSION: z.string().default('v24.0'),
  /** ADR-0004 prepare(): how long before the slot the pre-stage wake-up fires. */
  PUBLISH_PREPARE_LEAD_SEC: z.coerce.number().int().positive().default(300),
  /** Instagram container status polling while a video processes (PUB-02). */
  IG_CONTAINER_POLL_INTERVAL_SEC: z.coerce.number().positive().default(5),
  IG_CONTAINER_POLL_MAX: z.coerce.number().int().positive().default(12),
  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  /** CONN AC: warn when a token expires within this many days. */
  TOKEN_EXPIRY_WARN_DAYS: z.coerce.number().default(7),
  /** NOTI-01: internal LINE OA for staff alerts (separate from the customer OA). */
  LINE_NOTIFY_CHANNEL_TOKEN: z.string().default(''),
  LINE_NOTIFY_GROUP_ID: z.string().default(''),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type AppConfig = Omit<z.infer<typeof Env>, 'AUTH_ENFORCE_MFA'> & {
  AUTH_ENFORCE_MFA: boolean;
};

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
  return { ...cfg, AUTH_ENFORCE_MFA: cfg.AUTH_ENFORCE_MFA ?? cfg.NODE_ENV === 'production' };
}

export const CONFIG = Symbol('CONFIG');
