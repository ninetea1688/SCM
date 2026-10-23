# ADR-0009 — Publishable media renditions (MEDIA-04)

**Context.** PRD MEDIA-04 asks for automatic conversion ("HEIC→JPG, video→MP4 H.264") without
acceptance criteria. Platforms differ: Instagram accepts JPEG only, iPhones produce HEIC and HEVC
`.mov`, and raw camera files carry EXIF/GPS metadata that should not be published (PDPA). sharp's
prebuilt libvips cannot decode HEIC (no HEVC decoder), and ffmpeg's CLI reads a single 512px tile
of an iPhone HEIC grid instead of the stitched image.

**Decision.**
- Keep the verified **original untouched** (archive, re-edit) and write one **publish rendition**
  next to it: `<key>.publish.jpg` or `<key>.publish.mp4` (`publish_*` columns). Publishing
  (`PublishRunner`) and `validate()` use the rendition; the UI shows it as `publishUrl`.
- **Images → JPEG for every type** (one format every platform accepts): EXIF rotation baked in,
  transparency flattened onto white, all metadata stripped, downscaled only above
  `MEDIA_PUBLISH_IMAGE_MAX_PX` (4096), quality `MEDIA_PUBLISH_JPEG_QUALITY` (90, mozjpeg).
- **HEIC/HEIF → libheif `heif-dec`** to PNG first (stitches tile grids); the decode is the format
  check. Needs `libheif-tools` in the image and `brew install libheif` on dev machines.
- **Video → H.264/AAC MP4, `+faststart`, metadata stripped (`-map_metadata -1`).** If the source
  is already H.264 yuv420p with AAC/no audio in MP4/MOV and within `MEDIA_PUBLISH_VIDEO_MAX_PX`
  (1920 long side), it is **remuxed** (`-c copy`); otherwise **transcoded** (libx264 veryfast,
  CRF 23, high profile, AAC 128k stereo, scaled to fit, never upscaled). The decision (`planVideo`)
  is recorded in the `media.processed` event.
- Long transcodes: `MEDIA_TRANSCODE_TIMEOUT_SEC` (1800) and a heartbeat on
  `processing_started_at` every `MEDIA_HEARTBEAT_SEC` so MediaSweeper does not re-queue running work.

**Consequences.** Storage roughly doubles for converted media (original + rendition). PNG sources
lose transparency in the published copy (the original keeps it). Platform-specific variants
(e.g. IG 4:5 crops, MEDIA-05) and per-platform bitrate caps are future work; verify current
platform video specs with `/verify-platform-limits` before tightening encoder settings.
