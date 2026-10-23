/**
 * MEDIA-02 AC: search, folder/tag filters, orientation and duration filters, and
 * the facets endpoint feeding the filter UI. Needs `pnpm dev:infra`.
 */
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, createWorld, type World } from '../test/harness';
import { mediaHelpers, solidImage } from '../test/media-helpers';

let app: INestApplication;
let w: World;
let helpers: ReturnType<typeof mediaHelpers>;

interface Row {
  id: string;
  originalName: string;
  width: number | null;
  height: number | null;
  folder: string;
  tags: string[];
}

const list = async (query = '') =>
  (
    await w
      .as('editor')
      .http('get', `/media${query ? `?${query}` : ''}`)
      .expect(200)
  ).body as Row[];

beforeAll(async () => {
  app = await bootApp();
  w = await createWorld(app, 'media-filters');
  helpers = mediaHelpers(
    () => app,
    () => w,
  );

  // upload() also runs the processor, so width/height exist for the aspect filter.
  await helpers.upload(await solidImage(800, 400), 'image/png', 'banner-summer.png', {
    folder: '/แคมเปญ',
    tags: ['ประกาศ', 'ฤดูร้อน'],
  });
  await helpers.upload(await solidImage(400, 800), 'image/png', 'reel-tips.png', {
    folder: '/แคมเปญ',
    tags: ['คลิปสั้น'],
  });
  await helpers.upload(await solidImage(600, 600), 'image/png', 'avatar-officer.png', {
    folder: '/',
    tags: ['ประกาศ'],
  });
});

afterAll(async () => {
  await app.close();
});

describe('MEDIA-02 filters', () => {
  it('searches by file name (case-insensitive substring)', async () => {
    const rows = await list('q=BANNER');
    expect(rows.map((r) => r.originalName)).toEqual(['banner-summer.png']);
  });

  it('filters by orientation bucket', async () => {
    expect((await list('aspect=landscape')).map((r) => r.originalName)).toEqual([
      'banner-summer.png',
    ]);
    expect((await list('aspect=portrait')).map((r) => r.originalName)).toEqual(['reel-tips.png']);
    expect((await list('aspect=square')).map((r) => r.originalName)).toEqual([
      'avatar-officer.png',
    ]);
  });

  it('filters by folder and by tag', async () => {
    const inFolder = await list('folder=/แคมเปญ');
    expect(inFolder).toHaveLength(2);
    const tagged = await list('tag=ประกาศ');
    expect(tagged).toHaveLength(2);
    expect(await list('folder=/&tag=คลิปสั้น')).toHaveLength(0);
  });

  it('a duration filter excludes items without duration (images)', async () => {
    expect(await list('maxDurationSec=30')).toEqual([]);
  });

  it('facets returns folders and tag counts for the filter UI', async () => {
    const facets = (await w.as('editor').http('get', '/media/facets').expect(200)).body as {
      folders: string[];
      tags: { tag: string; count: number }[];
    };
    expect(facets.folders.sort()).toEqual(['/', '/แคมเปญ']);
    const counts = Object.fromEntries(facets.tags.map((t) => [t.tag, t.count]));
    expect(counts.ประกาศ).toBe(2);
    expect(counts.คลิปสั้น).toBe(1);
    expect(counts.ฤดูร้อน).toBe(1);
  });
});
