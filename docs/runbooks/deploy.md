# Deploy (production, Docker Compose)

Prereqs on the host: Docker Engine + Compose v2, DNS A records for `DOMAIN` and `MEDIA_DOMAIN`,
ports 80/443 open.

```bash
git clone <repo> scm && cd scm
cp .env.example .env.prod            # fill every secret (generator note below)
cp docker/seaweedfs/s3.prod.json.example docker/seaweedfs/s3.prod.json   # same secret as S3_SECRET_KEY
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod run --rm migrate node dist/cli/seed.js \
  admin@org.go.th '<strong-password>' 'ผู้ดูแล' 'ชื่อ Workspace'
```

**Generating secrets:** `POSTGRES_PASSWORD`, `SCM_APP_DB_PASSWORD`, `SCM_SYSTEM_DB_PASSWORD` and
`REDIS_PASSWORD` are interpolated into connection URLs, so they must be URL-safe — use
`openssl rand -hex 32`. For values that never go into a URL (`JWT_SECRET`, `BACKUP_PASSPHRASE`,
`S3_SECRET_KEY`) `openssl rand -base64 32` is fine.

`migrate` runs automatically before `api`/`worker` start (service_completed_successfully).

There is no hosted CI: run `pnpm verify` (with `pnpm dev:infra` up) before tagging a release.

**Upgrade:** `git pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`.
Migrations are forward-only; take a backup first (`docker compose ... exec backup /backup.sh` runs one now).

**Rollback:** redeploy the previous image tag (`SCM_VERSION=<tag>`). If a migration must be undone,
restore the pre-upgrade backup (runbooks/backup-restore.md) — never hand-edit applied migrations.

**Scale workers:** `docker compose -f docker-compose.prod.yml up -d --scale worker=3`.

**Worker hardening (ADR-0008):** the worker's `/tmp` is a 2 GiB tmpfs so transcodes cannot fill
the disk. The worker must reach the internet (platform APIs); to also deny it access to other
internal hosts, drop RFC1918 + link-local destinations from the stack's subnet in the host's
`DOCKER-USER` chain (traffic inside the compose bridge is unaffected):

```bash
SUBNET=$(docker network inspect scm_default -f '{{(index .IPAM.Config 0).Subnet}}')
for NET in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.169.254/32; do
  iptables -I DOCKER-USER -s "$SUBNET" -d "$NET" -j DROP
done
```

**Checklist before going live:** `PUBLISHER_MODE=live`, Meta App in Live mode, data-deletion URL
= `https://DOMAIN/webhooks/meta/data-deletion`, LINE webhook URL from the account connect response,
`LINE_NOTIFY_*` set (PUB AC: failure alerts within 1 minute), backups copied off-host.

## Kong Gateway host (shared Kong in Docker)

When the host already runs a shared Kong Gateway (DB-backed) fronting other sites — TLS is
terminated upstream (e.g. Cloudflare) and Kong serves plain HTTP routes per `Host` — deploy the
stack into Kong's network instead of Caddy:

```bash
git clone <repo> scm && cd scm
cp .env.example .env.prod          # fill secrets; DOMAIN + MEDIA_DOMAIN on the shared domain
cp docker/seaweedfs/s3.prod.json.example docker/seaweedfs/s3.prod.json
docker compose -f docker-compose.prod.yml -f docker-compose.kong.yml \
  --env-file .env.prod up -d --build --scale caddy=0
docker compose -f docker-compose.prod.yml -f docker-compose.kong.yml --env-file .env.prod \
  run --rm migrate node dist/cli/seed.js admin@org.go.th '<strong-password>' 'ผู้ดูแล' 'ชื่อ Workspace'
DOMAIN=scm.officesoft.shop MEDIA_DOMAIN=scm-media.officesoft.shop ./docker/scripts/kong-routes.sh
```

`docker-compose.kong.yml` joins `web`/`api`/`s3` to the external `kong-docker_default` network so
Kong resolves them by compose service name; `--scale caddy=0` keeps the bundled Caddy parked.
`kong-routes.sh` is idempotent (named upserts) — re-run after every deploy. The media host must
be path-free (SigV4 signs the request path, so a path prefix would break presigned URLs) — give
`MEDIA_DOMAIN` its own DNS record pointing at the same host.

## Staging

Same `docker-compose.prod.yml`, separate host and env (owner decision 2026-10-23). Staging is the
release gate: the `SCM_VERSION` proven on staging is the one deployed to prod.

```bash
git clone <repo> scm && cd scm
cp .env.staging.example .env.staging     # fill every secret; staging domains
cp docker/seaweedfs/s3.prod.json.example docker/seaweedfs/s3.prod.json   # same secret as S3_SECRET_KEY
docker compose -f docker-compose.prod.yml --env-file .env.staging up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.staging run --rm migrate node dist/cli/seed.js \
  admin@org.go.th '<strong-password>' 'ผู้ดูแล' 'Staging'
```

Differences from prod (all in `.env.staging`): `PUBLISHER_MODE=fake` sandbox adapters until the
staging Meta App is verified (`ALLOW_FAKE_PUBLISHER=true` opts past the prod guard), staging
`DOMAIN`/`MEDIA_DOMAIN`, `BACKUP_DIR=./backups-staging`. `AUTH_ENFORCE_MFA=true` mirrors prod.
The compose `ENV_FILE` variable (set inside the env file) points the api/worker/migrate
containers at `.env.staging` instead of `.env.prod`.

**Smoke check after every deploy (also after upgrades):**

1. `curl -fsS https://<staging domain>/api/health` → `{"status":"ok"}`; `https://<staging domain>/status` page loads.
2. Log in, create a post, upload media, approve, schedule, let it fire in sandbox, check the
   publish log shows a sandbox success.
3. `curl -fsS https://<staging domain>/api/metrics | grep -c scm_` — scrape works.
4. `docker compose ... logs worker --since 10m` — no unhandled errors.

**Upgrade:** backup first, then `git pull && docker compose ... --env-file .env.staging up -d --build`.
**Promote to prod:** same commit tag, prod runbook above.
