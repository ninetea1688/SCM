CREATE TABLE "inbox_rotation" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_replies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"shortcut" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sla_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "sla_escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD COLUMN "is_internal_note" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_rotation" ADD CONSTRAINT "inbox_rotation_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_replies" ADD CONSTRAINT "saved_replies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_replies_shortcut_uq" ON "saved_replies" USING btree ("workspace_id","shortcut");--> statement-breakpoint
CREATE INDEX "saved_replies_ws_idx" ON "saved_replies" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE saved_replies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON saved_replies
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
--> statement-breakpoint
ALTER TABLE inbox_rotation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON inbox_rotation
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
