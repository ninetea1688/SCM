# ผลตรวจ PRD v1.0 (23 ต.ค. 2569)

เอกสารนี้บันทึกประเด็นที่พบใน `prd/prd.md` และสถานะการแก้ไข **PRD เป็นของเจ้าของเอกสาร: ห้ามแก้ไฟล์ PRD โดยตรง**
ข้อเสนอให้แก้อยู่ใน ADR เพื่อรอเจ้าของเอกสารยืนยันแล้วจึงนำไปปรับ PRD

## ขัดกันเอง (ต้องแก้ก่อน P1)

| # | ประเด็น | การจัดการ |
| --- | --- | --- |
| 1 | PUB อยู่ P1 แต่ APPR อยู่ P2 ทำให้โพสต์ได้โดยไม่มีผู้อนุมัติ (ขัด G2 และ AC ของ APPR-01) | ADR-0002: ย้ายการอนุมัติ 1 ระดับมา P1 |
| 2 | `validate()` (POST-04) อยู่ P2 แต่ P1 ยิงโพสต์จริงแล้ว | ADR-0002: ย้ายมา P1 |
| 3 | แก้เนื้อหาหลังอนุมัติ: diagram ไป Draft แต่ AC ไป "รอตรวจ" | ADR-0003: ไป `in_review` |
| 4 | APPROVAL ผูกกับ POST แต่สถานะอยู่ที่ VARIANT | ADR-0003: ผูกกับ (variant, version) |
| 5 | CRISIS-03 (P2) ต้องใช้บอท (P4); INBOX-05 (P2) ต้องใช้ KB (P4) | ต้องตัดสิน: ใน P2 ให้ทำ Saved Replies แบบกรอกเอง แล้วเปลี่ยนไปดึงจาก KB ใน P4 |
| 6 | "หัวหน้า" ไม่ใช่บทบาท; Topic Owner/System Admin ไม่อยู่ในตารางสิทธิ์ | ADR-0005 |
| 7 | ฝั่งคอนเทนต์ไม่มีการแยกหน้าที่ผู้เขียน/ผู้อนุมัติ (แต่ KB-04 มี) | ADR-0003: ห้ามอนุมัติงานตัวเอง ยกเว้นนโยบาย Owner และต้องบันทึก |

## ความเสี่ยงเชิงเทคนิค

- AC "Kill network แล้วไม่โพสต์ซ้ำ" ใช้ Idempotency Key ฝั่งเราอย่างเดียวไม่พอ → ADR-0004 (unknown + reconcile)
- NFR-02 "ภายใน 1 นาที" ใช้กับวิดีโอไม่ได้ถ้าไม่ pre-stage → `prepare()` ใน ADR-0004
- State machine ขาด reject/cancel/unschedule/reschedule → ADR-0003
- Event Log กับ Audit Log ไม่ได้นิยามความสัมพันธ์ → ADR-0007
- Data model ขาด: Topic, SLA Policy, Business Hours, Holiday Calendar, Team/Supervisor, API Key, Webhook Subscription, Assignment History (เพิ่มในเฟสที่ใช้)
- AC ยังขาดในโมดูล MEDIA, CAL, ANA, MON

## ขอบเขต

P1 มี Must ~40 ข้อ สำหรับทีม 2–3 คนใน 6–8 สัปดาห์ถือว่าตึง แนะนำเรียงตาม `docs/STATUS.md` → "Next up"

## ประเด็นหัวข้อ 17 ที่ตัดสินแล้ว

- ภาษา Backend / ที่ Deploy → ADR-0001 (TypeScript, Docker Compose บนเครื่องเดียว)
- ที่เหลือยังรอเจ้าของเอกสาร (องค์กรเดียวหรือ SaaS, บริการตัวกลาง, งบ AI, ฯลฯ)
