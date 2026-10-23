# ADR-0008 — Media upload safety and processing lifecycle

**Context.** MEDIA-01/03 accept files from staff browsers and process them server-side
(sharp, ffmpeg). Reviews of the first MEDIA-03 cut found: upload size not enforced, ffmpeg run on
hostile input without protocol limits, any client MIME accepted (SVG/HTML = stored XSS), the
uploaded object could be overwritten after validation (TOCTOU), and an asset could stay in
`processing` forever if the queue hand-off was lost.

**Decision.**
- **Lifecycle:** `uploading → processing → ready | failed`. Only `ready` media can be attached to
  a post (`media_not_ready`). `failed` is terminal; the user re-uploads (no re-process button yet).
- **Allowlist:** `MEDIA_TYPES` in `@scm/domain` (jpeg, png, webp, heic, mp4, mov, webm, pdf).
  No SVG/HTML/XML. The storage key extension comes from the type, never from the file name.
- **Verify, don't trust:** the decoder must report the declared format (`formatMatches`);
  PDFs must start with `%PDF-`; dimensions/duration come from the probe; declared size must equal
  the stored size (`complete` rejects and deletes otherwise).
- **Bounded processing:** download capped at `MEDIA_MAX_BYTES`; sharp `limitInputPixels`
  (`MEDIA_MAX_INPUT_PIXELS`), concurrency 1, no cache, one decode per file; ffmpeg/ffprobe with
  `-protocol_whitelist file`, bounded probe, video size cap, timeouts; per-workspace in-flight cap.
- **No TOCTOU:** uploads land in `ws/<id>/uploads/`; after validation the exact bytes are copied
  (`CopySourceIfMatch` = validated ETag) to `ws/<id>/media/`, which no presigned PUT targets, and
  the upload object is deleted. Platforms publish from the `media/` key.
- **Originals** are only signed on single-item reads and always as `attachment` with the verified
  content type. Renditions are WebP and safe to render.
- **No stuck states:** enqueue after commit; `complete` on a `processing` asset re-enqueues
  (job id dedupes); the worker's final BullMQ attempt marks `failed`; `MediaSweeper` re-queues
  assets stuck longer than `MEDIA_STUCK_AFTER_MIN` up to `MAX_REQUEUES` times, then fails them.
- **Previews per kind:** image → WebP thumb + preview; video → poster still from ~1 s (a playable
  proxy belongs with MEDIA-04 transcoding); document → none yet.

**Consequences.** Storage keys of ready assets change once (uploads → media). Orphaned uploads and
renditions of failed/abandoned assets still need cleanup (MEDIA-08, PDPA retention). Production
should additionally give the worker a size-limited temp volume and no access to internal hosts.
