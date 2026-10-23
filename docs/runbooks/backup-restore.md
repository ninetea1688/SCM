# Backup and restore (NFR-06: RPO ≤ 24h, RTO ≤ 4h, quarterly restore test)

The `backup` service writes `backups/scm-<UTC>.dump.enc` daily (pg_dump custom format,
AES-256 with `BACKUP_PASSPHRASE`), keeping `BACKUP_KEEP_DAYS`. **Copy `backups/` off the host**
(e.g. nightly rclone to another provider) — a backup on the same disk is not a backup.
Media in SeaweedFS (`s3data` volume) needs its own off-host sync.

## Restore

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in scm-<ts>.dump.enc -out scm.dump
docker compose -f docker-compose.prod.yml stop api worker
docker compose -f docker-compose.prod.yml exec -T postgres pg_restore -U scm -d scm --clean --if-exists < scm.dump
docker compose -f docker-compose.prod.yml start api worker
```

Record each quarterly restore test (date, backup used, duration, result) in this file.
