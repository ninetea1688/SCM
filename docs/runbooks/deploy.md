# Deploy (production, Docker Compose)

Prereqs on the host: Docker Engine + Compose v2, DNS A records for `DOMAIN` and `MEDIA_DOMAIN`,
ports 80/443 open.

```bash
git clone <repo> scm && cd scm
cp .env.example .env.prod            # fill every secret: openssl rand -base64 32
cp docker/seaweedfs/s3.prod.json.example docker/seaweedfs/s3.prod.json   # same secret as S3_SECRET_KEY
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm api node dist/cli/seed.js \
  admin@org.go.th '<strong-password>' 'ผู้ดูแล' 'ชื่อ Workspace'
```

`migrate` runs automatically before `api`/`worker` start (service_completed_successfully).

**Upgrade:** `git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`.
Migrations are forward-only; take a backup first (`docker compose ... exec backup /backup.sh` runs one now).

**Rollback:** redeploy the previous image tag (`SCM_VERSION=<tag>`). If a migration must be undone,
restore the pre-upgrade backup (runbooks/backup-restore.md) — never hand-edit applied migrations.

**Scale workers:** `docker compose -f docker-compose.prod.yml up -d --scale worker=3`.

**Checklist before going live:** `PUBLISHER_MODE=live`, Meta App in Live mode, data-deletion URL
= `https://DOMAIN/webhooks/meta/data-deletion`, LINE webhook URL from the account connect response,
`LINE_NOTIFY_*` set (PUB AC: failure alerts within 1 minute), backups copied off-host.
