-- ADR-0006: tenant isolation in the database (PRD AUTH-01 AC).
-- Runtime roles are created with passwords by docker/postgres/10-roles.sh; this guard keeps
-- the migration runnable on databases provisioned some other way.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scm_app') THEN
    CREATE ROLE scm_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scm_system') THEN
    CREATE ROLE scm_system NOLOGIN BYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO scm_app, scm_system;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO scm_app, scm_system;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO scm_app, scm_system;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scm_app, scm_system;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO scm_app, scm_system;
--> statement-breakpoint
CREATE FUNCTION app_workspace_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'social_accounts','media_assets','campaigns','posts','post_variants','variant_media',
    'variant_versions','approvals','publish_jobs','publish_attempts','quota_usage','notifications'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id())',
      t);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON workspaces
  USING (
    id = app_workspace_id()
    OR id IN (SELECT m.workspace_id FROM memberships m WHERE m.user_id = app_user_id() AND m.revoked_at IS NULL)
  )
  WITH CHECK (id = app_workspace_id());
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON memberships
  USING (workspace_id = app_workspace_id() OR user_id = app_user_id())
  WITH CHECK (workspace_id = app_workspace_id());
--> statement-breakpoint
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_read ON audit_logs FOR SELECT USING (workspace_id = app_workspace_id());
--> statement-breakpoint
CREATE POLICY tenant_insert ON audit_logs FOR INSERT
  WITH CHECK (workspace_id IS NULL OR workspace_id = app_workspace_id());
--> statement-breakpoint
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_read ON events FOR SELECT USING (workspace_id = app_workspace_id());
--> statement-breakpoint
CREATE POLICY tenant_insert ON events FOR INSERT
  WITH CHECK (workspace_id IS NULL OR workspace_id = app_workspace_id());
--> statement-breakpoint
-- OPS-01: audit log is append-only for every role, including the owner.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM scm_app, scm_system;
--> statement-breakpoint
CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();
