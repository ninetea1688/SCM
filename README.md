# SCM — Social Content Management

ศูนย์บริหารคอนเทนต์โซเชียลมีเดียสำหรับหน่วยงานภาครัฐ (สปสช.) — วางแผน → สร้าง → อนุมัติ → ตั้งเวลา → เผยแพร่ ไปยัง Facebook, Instagram, LINE OA (และ TikTok/YouTube ในลำดับถัดไป) ในระบบเดียว พร้อม Unified Inbox ตอบแชท/คอมเมนต์ และ Dashboard วิเคราะห์ผล

> Spec: [`prd/prd.md`](prd/prd.md) · ความคืบหน้า: [`docs/STATUS.md`](docs/STATUS.md) · Decisions: [`docs/decisions/`](docs/decisions/) · Deploy: [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md)

## ความสามารถหลัก

### 1. บัญชีและสิทธิ์ (AUTH)

- **Multi-workspace** — ผู้ใช้หนึ่งคนอยู่หลาย workspace ได้ ข้อมูลแยกขาดผ่าน Postgres RLS
- **RBAC 6 บทบาท** — เจ้าของ / แอดมิน / ผู้อนุมัติ / ผู้สร้างคอนเทนต์ / ผู้ตอบแชท / ผู้ดูรายการ พร้อม per-account scope
- **2FA (TOTP)** บังคับสำหรับเจ้าของ/แอดมิน (ปรับได้ผ่าน env)
- เพิกถอนสิทธิ์ทันที + ยกเลิกทุกเซสชัน + รายงานบัญชีที่คนถูกเพิกถอนเคยเชื่อม

### 2. โพสต์และเนื้อหา (POST / APPR)

- โพสต์หนึ่งอัน แตกเป็น **variant รายช่องทาง** แก้ข้อความ/ตัวเลือกเฉพาะแพลตฟอร์ม (เช่น Reel, ชื่อวิดีโอ YouTube, Broadcast/Narrowcast)
- **ตรวจสเปกอัตโนมัติก่อนส่งอนุมัติ** (`validate()`): ความยาว แฮชแท็ก สัดส่วน/ชนิด/ความยาวไฟล์ คำต้องห้ามขององค์กร — มีข้อผิดพลาดภาษาไทยบอกทีละข้อ
- **ป้ายคอนเทนต์ (Taxonomy)**: Pillar / หัวข้อ / กลุ่มเป้าหมาย / รูปแบบ / Hook / CTA / ใช้ AI / แชร์จากพันธมิตร
- **ประวัติทุกเวอร์ชัน + ดูความต่างระดับคำ** ระหว่างเวอร์ชัน
- Workflow อนุมัติ: ส่งตรวจ → อนุมัติ / ส่งกลับ / ปฏิเสธ (ห้ามอนุมัติงานตัวเอง) + ความเห็นภายในทีม + แจ้งเตือนซ้ำเมื่องานค้าง
- **พรีวิวรายแพลตฟอร์ม** ก่อนเผยแพร่ (Facebook feed, IG, LINE bubble, YouTube card)

### 3. ปฏิทิน (CAL)

- มุมมอง **เดือน / สัปดาห์ / วัน / รายการ** + agenda มือถือ — ลากการ์ดย้ายเวลาได้ (atomic reschedule)
- **วันหยุดราชการไทย** + พ.ศ. (Asia/Bangkok) แสดงในทุกมุมมอง
- เตือน **โควตาโพสต์ใกล้ถึงlimit** รายช่องทาง และช่องว่างวันที่ยังไม่มีคอนเทนต์ (Content Gap)
- **ช่วงไว้ทุกข์/เหตุการณ์สำคัญ** — เตือนเมื่อมีคอนเทนต์ตรงช่วงที่กำหนด

### 4. คลังสื่อ (MEDIA)

- **อัปโหลดตรงเข้า Storage ด้วย Presigned URL** (SeaweedFS S3-compatible) รองรับไฟล์ใหญ่
- โฟลเดอร์ / แท็ก / ค้นหา / กรองชนิด-สัดส่วน-ความยาว
- **สร้าง Thumbnail + Preview อัตโนมัติ** — รูปเป็น WebP, วิดีโอดึง poster frame
- **แปลงไฟล์อัตโนมัติ** FFmpeg/Sharp: HEIC→JPEG, HEVC→H.264/AAC faststart, ลบ GPS/EXIF, ย่อเกินขีด
- **ตัดภาพหลายสัดส่วน** 1:1 / 4:5 / 9:16 / 16:9 สำหรับแต่ละแพลตฟอร์ม
- **ข้อมูลสิทธิ์การใช้สื่อ** แหล่งที่มา / ใบอนุญาต / วันหมดสิทธิ์ / ความยินยอม — หมดสิทธิ์ = แนบโพสต์ไม่ได้
- **ล้างไฟล์ค้าง/ไม่ใช้** ตามนโยบาย (PDPA retention)

### 5. เผยแพร่ (PUB)

- **Scheduler ของระบบเอง** (BullMQ delayed jobs) — ตั้งเวลาล่วงหน้า พร้อม pre-stage (IG container)
- **Adapters**: Facebook Pages, Instagram (feed/carousel/reel), LINE OA broadcast — เพิ่มแพลตฟอร์มใหม่ = adapter ไฟล์เดียว
- **At-most-once**: idempotency key + reconcile กรณีผลลัพธ์ไม่ชัดเจน — **ไม่โพสต์ซ้ำเด็ดขาด**
- Retry แบบจำแนก (retryable/permanent/unknown) + **Kill Switch** พักทั้ง workspace ในคลิกเดียว
- **โควตาต่อบัญชี** บังคับ ณ เวลาตั้งเวลา + อ่านโควตาจริงจากแพลตฟอร์ม

### 6. ศูนย์ตอบแชทและคอมเมนต์ (INBOX / MOD)

- **รวมข้อความส่วนตัว (LINE OA วันนี้, Messenger/IG เร็ว ๆ นี้) และคอมเมนต์จาก webhook** เข้า desk เดียว
- **กระจายงานอัตโนมัติ** round-robin, สถานะ เปิด/รับเรื่อง/ปิด, "กำลังตอบโดย…"
- **SLA ต่อบทสนทนา** พร้อมแจ้งเตือนซ้ำเมื่อเกินกำหนด
- **Saved Replies** (เรียกด้วย `/shortcut`) + **โน้ตภายใน** ที่ลูกค้ามองไม่เห็น
- **ตอบอัตโนมัตินอกเวลาทำการ** (เวลาทำการปรับได้) + **หน้าต่างเวลาตอบได้** รายช่องทาง
- **เรื่องอ่อนไหว**: ผู้ตอบแชทร่างได้แต่ต้องให้หัวหน้าอนุมัติก่อนส่ง
- **คอมเมนต์บนโพสต์**: จัดประเภทอัตโนมัติ (คำต้องห้ามซ่อนทันที, ก้ำกึ่งเข้าคิวให้คนตัดสิน) ตอบ/ซ่อน/เปิดใหม่ ได้จากในระบบ
- **โปรไฟล์ผู้ติดต่อ** พร้อมสถิติประวัติบทสนทนา

### 7. วิเคราะห์ (ANA)

- **Dashboard 8 ชั้นตามหัวข้อ 13.1** — ผลงานคอนเทนต์, การสนทนา, Workflow, ระบบ, ต้นทุน (ชั้นที่รอ integration ระบุชัด)
- **เป้า KPI รายตัวชี้วัด × ช่องทาง** เทียบค่าจริง
- ผลต่อ **โพสต์ × แพลตฟอร์ม** (เข้าถึง/ถูกใจ/คอมเมนต์/แชร์/อัตรามีส่วนร่วม) + **ส่งออก CSV**

### 8. แจ้งเตือน / CRM / ระบบ (NOTI / CRM / OPS)

- **แจ้งเตือน In-app + ทีม LINE + อีเมล** (publish failed, บัญชีหลุด, รออนุมัติ, โทเคนใกล้หมด, SLA, ระบบผิดปกติ)
- **ผู้ใช้ตั้งค่าเองได้** รายประเภท × รายช่องทาง (opt-out model)
- **PDPA**: ผู้ใช้ขอดู/แก้/ลบข้อมูลตัวเองได้ + Meta data-deletion callback
- **Immutable audit log** + event log ทุกการกระทำ
- Prometheus `/metrics`, `/health`, `/status`, Sentry (เปิดด้วย DSN)
- Backup อัตโนมัติรายวัน (encrypted, retention ตั้งได้)

## ความปลอดภัย (ทำมาตั้งแต่ต้น)

- **Tenant isolation ด้วย Postgres RLS** — ทุกตาราง tenant data อ่านเขียนผ่าน policy เท่านั้น
- **Access/Refresh tokens เข้ารหัส AES-256-GCM** (หมุน key ได้) — ไม่มี token ออกถึง browser (BFF pattern)
- Secrets ไม่เคยลง log — payload ทุกอย่างที่เข้า Publish/Audit log ผ่าน `redact()`
- Webhook ทุกเส้น**ตรวจลายเซ็น** (LINE HMAC, Meta X-Hub-Signature-256, signed_request)
- ไฟล์อัปโหลด: allowlist ชนิดไฟล์, ตรวจ format จริง, ขนาด/พิกเซลจำกัด, กัน TOCTOU

## เทคโนโลยี

| ชั้น | ใช้ |
| --- | --- |
| API | NestJS 11 + Drizzle ORM + Zod (ESM) |
| ฐานข้อมูล | PostgreSQL 18 (RLS) + Redis 8 / BullMQ |
| หน้าเว็บ | Next.js 16 App Router + Tailwind CSS 4 (ไทยทั้งหมด, BFF ซ่อน token) |
| สื่อ | SeaweedFS (S3 API) + Sharp + FFmpeg |
| ปฏิบัติการ | Docker Compose + Caddy (HTTPS อัตโนมัติ) + pino + prom-client + Mailpit (dev) |

```
apps/api      NestJS — HTTP + worker (BullMQ) ใน image เดียว
apps/web      Next.js — UI ไทย + BFF
packages/db   Drizzle schema, SQL migrations, RLS, withTenant()
packages/domain  กฎล้วน: state machine, validate(), RBAC, redact, ปฏิทินไทย
docker/       Dockerfiles, Caddyfile, Postgres roles, backup
```

## เริ่มต้นใช้งาน (Development)

ต้องมี Node 24, pnpm 10, Docker, ffmpeg (+libx264) และ heif-dec

```bash
pnpm install
pnpm dev:infra                # Postgres :5433, Redis :6380, SeaweedFS :8333, Mailpit :8025
pnpm build:packages
DATABASE_OWNER_URL=postgres://scm:scm@localhost:5433/scm pnpm db:migrate
node apps/api/dist/cli/seed.js admin@scm.local '<รหัสผ่าน12+>' 'ผู้ดูแล' 'ชื่อ Workspace'
pnpm dev:api & pnpm dev:worker & pnpm dev:web   # API :4000, Web :3000
```

**ทดสอบทั้งหมด** (ต้องเปิด `pnpm dev:infra` ก่อน — ต่อ Postgres/Redis/SeaweedFS จริง):

```bash
pnpm verify                   # lint + typecheck + e2e ทุกโมดูล
```

## ขึ้น Production / Staging

ใช้ Docker Compose ชุดเดียวกันทั้งสองแวดล้อม — ดู runbook ฉบับเต็มพร้อม smoke checklist ที่ [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md)

```bash
cp .env.example .env.prod     # ตั้ง secrets ทุกตัว (openssl rand -hex 32)
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

## ข้อตกลงการพัฒนา

- อ้างอิง requirement ID ในโค้ด/เทส/commit (เช่น `PUB-03`, `APPR-04`, ADR-0004)
- **ห้ามแก้ `prd/prd.md`** — ข้อตกลงที่เปลี่ยนไปเข้า ADR ใหม่
- ทุกการเปลี่ยน status ของ variant ต้องผ่าน `transitionVariant()` ใน `@scm/domain`
- ก่อนบอกว่าเสร็จ: `pnpm verify` เขียว + UI ต้องเปิดดูด้วยตาจริง
