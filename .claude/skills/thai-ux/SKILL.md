---
name: thai-ux
description: Conventions for SCM web UI and Thai copy — wording, dates (พ.ศ.), status names, error messages, layout and accessibility. Use when building or reviewing any screen or user-facing text in apps/web or Thai messages in packages/domain.
---

# Thai UX conventions for SCM

**Voice.** Polite, short, government-appropriate; no slang, no emoji, no em-dash. Address the user
neutrally (no ครับ/ค่ะ in UI labels). Buttons are verbs: "ส่งตรวจ", "อนุมัติ", "ตั้งเวลาโพสต์".

**Vocabulary (use these exact terms):** โพสต์, ช่องทาง (platform), บัญชีโซเชียล, ร่าง, รอตรวจ,
อนุมัติแล้ว, ตั้งเวลาแล้ว, สำเร็จ, ล้มเหลว, ผู้อนุมัติ, Workspace, Kill Switch. Status labels come from
`VARIANT_STATUS_LABEL_TH`, roles from `ROLE_LABEL_TH`, platforms from `PLATFORM_LABEL_TH`. Never
re-type them in components.

**Dates/numbers.** `formatThaiDateTime()` → "23 ต.ค. 2569 (2026) 14:05 น."; months via
`th-TH-u-ca-buddhist`; always Asia/Bangkok. Numbers with `toLocaleString('th-TH')`.
Inputs of type datetime-local are in the browser's zone — convert with `toISOString()`.

**Errors.** Say what happened and what to do: "บัญชีหลุดการเชื่อมต่อ กรุณาเชื่อมต่อใหม่แล้วตั้งเวลาอีกครั้ง".
API returns stable `code`; map in `lib/client.ts` `CODE_TH`. Validation issues show `messageTh`
next to the field. Errors use `role="alert"`.

**Layout.** Tokens only (`app/globals.css`); platform colour = dot + label (colour is never the only
signal). Works at 390px: tables scroll horizontally, calendars become agendas. Destructive or
mass actions (Kill Switch, LINE broadcast) need an explicit confirm showing the impact
(e.g. number of recipients and quota for PUB-08).

**Accessibility (NFR-10).** Every input labelled; focus visible; keyboard reachable; no autofocus;
native radio/checkbox semantics instead of ARIA roles on buttons; alt text for images (POST-08).

**Check.** Screenshot desktop + 390px before calling UI work done; for bigger screens ask the
user-level `design-critic` agent for a critique.
