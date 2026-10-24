ALTER TABLE "inbox_messages" ADD COLUMN "is_auto_reply" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "status" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;