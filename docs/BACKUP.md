# Backups

Automated nightly backups of the stock-analyzer app. Runs on the production VPS
(`imt-uv-helpdesk`) via `/etc/cron.d`.

## What's backed up

Each nightly run produces **two files** in `/opt/backups/stock-analyzer/`:

| File | Contents |
|---|---|
| `code_<timestamp>.tar.gz` | `/opt/stock-analyzer` (source, `.env`, uploads). Excludes `node_modules`, `dist`, `.git`, `.next`, `coverage`, `logs`. |
| `db_<timestamp>.sql.gz` | `pg_dumpall` — all Postgres databases, users, permissions. Full restore point. |

Timestamp format: `YYYY-MM-DD_HHMMSS` (e.g. `2026-04-17_030000`).

## Schedule & retention

- **Runs**: every night at **03:00 server time**
- **Retention**: last **7 days** (older files auto-pruned)
- **Log**: `/var/log/stock-analyzer/backup.log` (rotated weekly, 8 weeks retained)

Typical backup size: ~50 MB code + ~5–50 MB database depending on data. With
7-day retention this should stay well under 1 GB total.

## Installation (one time)

After merging this PR and the deploy webhook pulls the new code:

```bash
ssh root@imt-uv-helpdesk
sudo /opt/stock-analyzer/scripts/install-backup-cron.sh
```

The installer:
1. Marks `backup.sh` and `restore.sh` executable
2. Writes `/etc/cron.d/stock-analyzer-backup` (nightly at 03:00)
3. Writes `/etc/logrotate.d/stock-analyzer-backup`
4. Runs an immediate backup as a smoke test so you see a file appear right away

It's idempotent — safe to re-run anytime to pick up changes to the scripts.

## Listing backups

```bash
sudo /opt/stock-analyzer/scripts/restore.sh --list
```

Output looks like:

```
TIMESTAMP                    CODE         DB
---------                    ----         --
2026-04-17_030000            48M         12M
2026-04-16_030000            48M         12M
...
```

## Restoring

### Full restore (code + database)

```bash
sudo /opt/stock-analyzer/scripts/restore.sh --full 2026-04-17_030000
```

### Code only

```bash
sudo /opt/stock-analyzer/scripts/restore.sh --code 2026-04-17_030000
```

The current `/opt/stock-analyzer` is moved to `/opt/stock-analyzer.broken-<timestamp>` before the restore, so you always have a rollback path. After restore the script runs `npm ci && npm run build && pm2 restart stock-analyzer` automatically.

### Database only

```bash
sudo /opt/stock-analyzer/scripts/restore.sh --db 2026-04-17_030000
```

Prompts for a `yes` confirmation because `pg_dumpall` includes `DROP DATABASE` / `DROP ROLE` statements — it will wipe the current database state and replace it with the snapshot.

## Running a manual backup

Any time (before a risky change, for instance):

```bash
sudo /opt/stock-analyzer/scripts/backup.sh
```

## Environment overrides

Both scripts honor these env vars:

| Var | Default | Purpose |
|---|---|---|
| `BACKUP_DIR` | `/opt/backups/stock-analyzer` | Where backup files live |
| `APP_DIR` | `/opt/stock-analyzer` | Source directory to tar |
| `RETENTION_DAYS` | `7` | Days before old backups are pruned |
| `PG_USER` | `postgres` | User to run `pg_dumpall` as |
| `PM2_APP` | `stock-analyzer` | PM2 app name for restart on code restore |
| `LOG_FILE` | `/var/log/stock-analyzer/backup.log` | Where to log cron output |

Override via `/etc/cron.d/stock-analyzer-backup` (installer writes them as env lines at the top of the file).

## Offsite copies (future)

These backups currently live only on the same VPS as the app. For true
disaster recovery, pair this with one of:

- `rclone` or `aws s3 cp` to push nightly to S3/R2/Backblaze
- A second cron that syncs `/opt/backups/stock-analyzer/` to another server
- OneDrive/SharePoint upload (the user already has M365)

Not implemented in this PR — deliberately scoped to on-box backups first.
