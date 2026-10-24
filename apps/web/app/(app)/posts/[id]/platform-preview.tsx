'use client';

/**
 * POST-03: simulated per-platform preview. Renders the caption (+ first media's
 * preview rendition) inside a simplified mock of each platform's feed UI. It is a
 * styled approximation for approval confidence — not a platform embed.
 */
import type { Platform, VariantDraft } from '@scm/domain';
import { useEffect, useState } from 'react';
import { bff, describeError } from '@/lib/client';

interface MediaView {
  previewUrl: string | null;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

const BRAND_TH: Record<Platform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  line: 'LINE OA',
};

function Media({ url, alt, ratio }: { url: string | null; alt: string; ratio?: string }) {
  if (!url) return null;
  return (
    // biome-ignore lint/performance/noImgElement: signed rendition URL from our storage
    <img src={url} alt={alt} className={`w-full object-cover ${ratio ?? ''}`} />
  );
}

export function PlatformPreview({
  platform,
  caption,
  mediaIds,
  accountName,
  options,
}: {
  platform: Platform;
  caption: string;
  mediaIds: string[];
  accountName: string;
  options?: VariantDraft['options'];
}) {
  const [media, setMedia] = useState<MediaView | null>(null);
  const firstMedia = mediaIds[0];

  useEffect(() => {
    if (!firstMedia) return;
    let alive = true;
    bff<MediaView>(`/media/${firstMedia}`)
      .then((m) => alive && setMedia(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [firstMedia]);

  const error = <p className="text-sm text-muted">ยังไม่รองรับพรีวิวสำหรับช่องทางนี้</p>;
  const img = media?.previewUrl ?? media?.thumbnailUrl ?? null;

  let frame: React.ReactNode;
  if (platform === 'facebook') {
    frame = (
      <div className="rounded-lg bg-white p-3 text-[13px] text-[#050505] shadow-sm">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-full bg-[#005da8] font-bold text-white">
            {accountName.slice(0, 1)}
          </span>
          <span>
            <span className="block font-semibold">{accountName}</span>
            <span className="block text-xs text-[#65676b]">กำลังจะโพสต์ · ทุกคน</span>
          </span>
        </div>
        <p className="mt-2 whitespace-pre-wrap">{caption}</p>
        {img && <Media url={img} alt="สื่อโพสต์" />}
        <div className="mt-2 flex justify-between border-t border-[#e4e6eb] pt-1.5 text-xs text-[#65676b]">
          <span>👍 ถูกใจ</span>
          <span>💬 ความคิดเห็น</span>
          <span>↪ แชร์</span>
        </div>
      </div>
    );
  } else if (platform === 'instagram') {
    frame = (
      <div className="mx-auto max-w-72 rounded-lg bg-white text-[13px] text-[#262626] shadow-sm">
        <div className="flex items-center gap-2 p-2.5">
          <span className="grid size-7 place-items-center rounded-full bg-[#d6249f] text-xs font-bold text-white">
            {accountName.slice(0, 1)}
          </span>
          <span className="font-semibold">{accountName}</span>
        </div>
        {img && <Media url={img} alt="สื่อโพสต์" ratio="aspect-square" />}
        <p className="px-2.5 py-2">
          <span className="font-semibold">{accountName}</span> {caption}
        </p>
      </div>
    );
  } else if (platform === 'line') {
    frame = (
      <div className="rounded-lg bg-[#e5e5e5] p-3">
        <p className="mb-1 text-[11px] text-[#8c8c8c]">{accountName}</p>
        <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-[#06c755] px-3 py-2 text-[13px] whitespace-pre-wrap text-white">
          {caption}
        </div>
        {img && (
          <div className="ml-auto mt-2 max-w-[85%] overflow-hidden rounded-2xl">
            <Media url={img} alt="สื่อโพสต์" />
          </div>
        )}
      </div>
    );
  } else if (platform === 'youtube') {
    frame = (
      <div className="rounded-lg bg-white p-3 text-[13px] text-[#0f0f0f] shadow-sm">
        {img && <Media url={img} alt="ภาพปกวิดีโอ" ratio="aspect-video" />}
        <p className="mt-2 font-semibold">{options?.ytTitle || '(ยังไม่ตั้งชื่อวิดีโอ)'}</p>
        <p className="mt-0.5 text-xs text-[#606060]">{accountName}</p>
        <p className="mt-2 whitespace-pre-wrap text-xs">{caption}</p>
      </div>
    );
  } else {
    frame = error;
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted">พรีวิว {BRAND_TH[platform]} — การแสดงผลจริงขึ้นกับแพลตฟอร์ม</p>
      {frame}
    </div>
  );
}
