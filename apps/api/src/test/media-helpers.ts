/** Upload helpers shared by media e2e tests: the same steps the browser performs. */
import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import { expect } from 'vitest';
import { MediaProcessor } from '../media/media-processor.service';
import type { World } from './harness';

export interface TestAsset {
  id: string;
  status: string;
  storageKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  thumbnailKey: string | null;
  previewKey: string | null;
  publishKey: string | null;
  publishMimeType: string | null;
  publishWidth: number | null;
  publishHeight: number | null;
  processingError: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  publishUrl: string | null;
  originalUrl: string | null;
}

export function mediaHelpers(app: () => INestApplication, world: () => World) {
  const get = async (id: string) =>
    (await world().as('editor').http('get', `/media/${id}`).expect(200)).body as TestAsset;

  /** presign → PUT bytes → complete. `declared` lets tests lie about the size. */
  async function uploadOnly(
    body: Buffer,
    mimeType: string,
    fileName: string,
    declared = body.length,
    extras: { folder?: string; tags?: string[] } = {},
  ) {
    const start = await world()
      .as('editor')
      .http('post', '/media/uploads')
      .send({ fileName, mimeType, sizeBytes: declared, ...extras })
      .expect(201);
    const put = await fetch(start.body.uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': mimeType },
      body,
    });
    expect(put.ok).toBe(true);
    const done = await world()
      .as('editor')
      .http('post', `/media/${start.body.asset.id}/complete`)
      .expect(201);
    return { asset: done.body as TestAsset, uploadUrl: start.body.uploadUrl as string };
  }

  /** Upload, then run what the worker would run. */
  async function upload(
    body: Buffer,
    mimeType: string,
    fileName: string,
    extras: { folder?: string; tags?: string[] } = {},
  ): Promise<TestAsset> {
    const { asset } = await uploadOnly(body, mimeType, fileName, undefined, extras);
    expect(asset.status).toBe('processing');
    await app()
      .get(MediaProcessor)
      .process({ mediaAssetId: asset.id, workspaceId: world().workspaceId });
    return get(asset.id);
  }

  return { get, uploadOnly, upload };
}

export const solidImage = (width: number, height: number, format: 'png' | 'jpeg' = 'png') =>
  sharp({ create: { width, height, channels: 3, background: '#0b6e4f' } })
    .toFormat(format)
    .toBuffer();
