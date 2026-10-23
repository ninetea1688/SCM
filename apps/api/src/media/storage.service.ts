import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type AppConfig, CONFIG } from '../config';

/** S3-compatible storage (SeaweedFS in dev, SeaweedFS or R2 in prod). MEDIA-01, MEDIA-06. */
@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  /** Signs URLs with the public host; signature covers the host, so it needs its own client. */
  private readonly signer: S3Client;
  private readonly log = new Logger(StorageService.name);

  constructor(@Inject(CONFIG) private readonly cfg: AppConfig) {
    const client = (endpoint: string) =>
      new S3Client({
        endpoint,
        region: cfg.S3_REGION,
        forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
        credentials: { accessKeyId: cfg.S3_ACCESS_KEY, secretAccessKey: cfg.S3_SECRET_KEY },
      });
    this.s3 = client(cfg.S3_ENDPOINT);
    this.signer = client(cfg.S3_PUBLIC_ENDPOINT ?? cfg.S3_ENDPOINT);
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.cfg.S3_BUCKET }));
    } catch {
      await this.s3.send(new CreateBucketCommand({ Bucket: this.cfg.S3_BUCKET }));
      this.log.log(`created bucket ${this.cfg.S3_BUCKET}`);
    }
  }

  /** Direct browser → storage upload; the API never proxies file bytes (MEDIA-01). */
  presignUpload(key: string, mimeType: string, ttlSec = 900): Promise<string> {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key, ContentType: mimeType }),
      { expiresIn: ttlSec },
    );
  }

  /** Short-lived read URL for platforms to fetch media (MEDIA-06). */
  presignGet(key: string, ttlSec = this.cfg.SIGNED_URL_TTL_SEC): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }),
      {
        expiresIn: ttlSec,
      },
    );
  }

  async head(key: string): Promise<{ size: number; contentType?: string } | null> {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
      return { size: r.ContentLength ?? 0, contentType: r.ContentType };
    } catch {
      return null;
    }
  }
}
