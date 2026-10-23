#!/bin/sh
# NFR-06: nightly encrypted logical backup, kept $BACKUP_KEEP_DAYS days.
# Copy /backups off the host (separate location) — see docs/runbooks/backup-restore.md.
set -eu
while true; do
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  out="/backups/scm-$ts.dump.enc"
  pg_dump --format=custom "$DATABASE_OWNER_URL" | \
    openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -out "$out"
  echo "backup written: $out"
  find /backups -name 'scm-*.enc' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
  sleep "${BACKUP_INTERVAL_SEC:-86400}"
done
