ALTER TABLE "media_assets" ADD COLUMN "publish_key" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "publish_mime_type" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "publish_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "publish_width" integer;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "publish_height" integer;