ALTER TABLE "media_assets" ADD COLUMN "thumbnail_key" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "preview_key" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "processing_error" text;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "processed_at" timestamp with time zone;