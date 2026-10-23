CREATE TABLE "pdpa_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"detail" text,
	"status" text DEFAULT 'received' NOT NULL,
	"handled_by" uuid,
	"handled_note" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdpa_requests" ADD CONSTRAINT "pdpa_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdpa_requests" ADD CONSTRAINT "pdpa_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdpa_requests" ADD CONSTRAINT "pdpa_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pdpa_requests_ws_idx" ON "pdpa_requests" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE pdpa_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON pdpa_requests
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
