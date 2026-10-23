'use client';

/** MEDIA-01: files go straight from the browser to storage via a presigned URL. */
import { ACCEPTED_MIME_TYPES } from '@scm/domain';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { bff, describeError } from '@/lib/client';

/** Same allowlist the API enforces (ADR-0008). */
const ACCEPT = ACCEPTED_MIME_TYPES.join(',');

export function Uploader() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function uploadAll(files: FileList) {
    setError(null);
    let done = 0;
    for (const file of Array.from(files)) {
      setProgress(`กำลังอัปโหลด ${done + 1}/${files.length}: ${file.name}`);
      try {
        const start = await bff<{ asset: { id: string }; uploadUrl: string }>(
          '/media/uploads',
          'POST',
          {
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          },
        );
        const put = await fetch(start.uploadUrl, {
          method: 'PUT',
          headers: { 'content-type': file.type },
          body: file,
        });
        if (!put.ok) throw { message: `อัปโหลด ${file.name} ไม่สำเร็จ กรุณาลองใหม่` };
        await bff(`/media/${start.asset.id}/complete`, 'POST');
        done++;
      } catch (e) {
        setError(describeError(e));
      }
    }
    setProgress(null);
    if (input.current) input.current.value = '';
    router.refresh();
  }

  return (
    <div className="text-right">
      <label className="inline-flex cursor-pointer items-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-brand-ink has-[:disabled]:opacity-60">
        {progress ? 'กำลังอัปโหลด…' : 'อัปโหลดไฟล์'}
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          disabled={!!progress}
          className="sr-only"
          onChange={(e) => e.target.files?.length && void uploadAll(e.target.files)}
        />
      </label>
      <p role="status" className="mt-1 min-h-5 text-xs text-muted">
        {progress}
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** While anything is processing, re-fetch the list every few seconds. */
export function AutoRefresh({ everyMs = 3000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
