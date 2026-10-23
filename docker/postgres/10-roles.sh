#!/bin/sh
# Creates the least-privilege roles used at runtime (ADR-0006).
#   scm_app    — API/worker per-request access; Row-Level Security enforced.
#   scm_system — cross-workspace system jobs (token refresh sweep, retention); BYPASSRLS.
# The superuser/owner ($POSTGRES_USER) is used only for migrations.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE scm_app LOGIN PASSWORD '${SCM_APP_DB_PASSWORD}' NOBYPASSRLS;
CREATE ROLE scm_system LOGIN PASSWORD '${SCM_SYSTEM_DB_PASSWORD}' BYPASSRLS;
GRANT CONNECT ON DATABASE "$POSTGRES_DB" TO scm_app, scm_system;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
SQL
