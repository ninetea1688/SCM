CREATE TABLE "kpi_goals" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"platform" text DEFAULT 'all' NOT NULL,
	"target" integer NOT NULL,
	"period" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kpi_goals" ADD CONSTRAINT "kpi_goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_goals" ADD CONSTRAINT "kpi_goals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_goals_uq" ON "kpi_goals" USING btree ("workspace_id","metric","platform");--> statement-breakpoint
ALTER TABLE kpi_goals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON kpi_goals
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
