ALTER TABLE "media_assets" ADD COLUMN "crops" jsonb;--> statement-breakpoint
ALTER TABLE "media_assets" ADD COLUMN "consent_on_file" boolean DEFAULT false NOT NULL;