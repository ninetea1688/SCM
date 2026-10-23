import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type AppConfig, CONFIG } from '../config';

export interface ObjectHead {
  size: number;
  etag: string;
  contentType?: string;
}

/** Download stopped because the object grew past the allowed size (ADR-0008). */
export class ObjectTooLargeError extends Error {}

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
        // SDK default adds a CRC32 of an empty body to presigned PUT URLs, so every browser
        // upload fails with BadDigest. Only send checksums when the operation requires them.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
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
  presignUpload(key: string, mimeType: string): Promise<string> {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key, ContentType: mimeType }),
      { expiresIn: this.cfg.UPLOAD_URL_TTL_SEC },
    );
  }

  /**
   * Short-lived read URL (MEDIA-06). `download` forces `Content-Disposition: attachment` and a
   * fixed content type so a user-supplied file can never render as active content in a browser.
   */
  presignGet(
    key: string,
    opts: { ttlSec?: number; download?: { fileName: string; contentType: string } } = {},
  ): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.cfg.S3_BUCKET,
        Key: key,
        ...(opts.download
          ? {
              ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(opts.download.fileName)}`,
              ResponseContentType: opts.download.contentType,
            }
          : {}),
      }),
      { expiresIn: opts.ttlSec ?? this.cfg.SIGNED_URL_TTL_SEC },
    );
  }

  /**
   * Streams an object to a local file (videos can be GBs — never buffer whole), aborting once
   * more than `maxBytes` arrive. Returns the ETag of the bytes actually downloaded.
   */
  async download(key: string, file: string, maxBytes: number): Promise<string> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
    if ((r.ContentLength ?? 0) > maxBytes) throw new ObjectTooLargeError(key);
    let seen = 0;
    const cap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        seen += chunk.length;
        cb(seen > maxBytes ? new ObjectTooLargeError(key) : null, chunk);
      },
    });
    await pipeline(r.Body as Readable, cap, createWriteStream(file, { mode: 0o600 }));
    return r.ETag ?? '';
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.cfg.S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  /** Upload a local file without buffering it (publishable videos can be large). */
  async putFile(key: string, file: string, contentType: string): Promise<number> {
    const { size } = await stat(file);
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.cfg.S3_BUCKET,
        Key: key,
        Body: createReadStream(file),
        ContentLength: size,
        ContentType: contentType,
      }),
    );
    return size;
  }

  /**
   * Server-side copy that only succeeds if the source still has `etag` — the bytes we validated.
   * Used to move a verified upload to a key no presigned PUT can reach (ADR-0008, TOCTOU).
   */
  async copyIfMatch(src: string, dst: string, etag: string, contentType: string): Promise<void> {
    await this.s3.send(
      new CopyObjectCommand({
        Bucket: this.cfg.S3_BUCKET,
        Key: dst,
        CopySource: `${this.cfg.S3_BUCKET}/${src.split('/').map(encodeURIComponent).join('/')}`,
        CopySourceIfMatch: etag,
        ContentType: contentType,
        MetadataDirective: 'REPLACE',
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
      return { size: r.ContentLength ?? 0, etag: r.ETag ?? '', contentType: r.ContentType };
    } catch {
      return null;
    }
  }
}
