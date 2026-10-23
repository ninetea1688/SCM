# Test fixtures

- `tiled-1600x1200.heic` — HEIC with a 12-tile HEVC grid, like iPhone photos (generated on macOS:
  `sips -s format heic smptebars.jpg --out tiled-1600x1200.heic`). Decoding must stitch the grid:
  a decoder that returns 512×512 is reading a single tile (MEDIA-04, ADR-0009).
