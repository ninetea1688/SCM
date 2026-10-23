---
paths:
  - "apps/web/**"
---
# apps/web rules

- Thai UI (`lang="th"`), dates via `formatThaiDateTime` / `th-TH-u-ca-buddhist`, timezone Asia/Bangkok.
  Use the `/thai-ux` skill for copy and layout conventions.
- Data: server components call `load()` (handles 401 refresh + workspace redirects); client components
  call `bff()`. Never call the API from the browser directly, never expose tokens to JS.
- Colours/sizes only via tokens in `app/globals.css` (`bg-brand`, `text-danger`, …). No raw hex,
  no em-dash in UI copy, no native `<select>` (user-level UX gates flag these).
- Accessibility (NFR-10): labelled inputs, visible focus, `role="alert"` for errors, keyboard reachable.
- Every page must work at 390px width. Check by screenshot before claiming a UI change is done.
- The server enforces every rule; UI only hides actions (`allowedEvents()`), never trusts itself.
