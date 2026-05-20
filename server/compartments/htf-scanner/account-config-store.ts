/**
 * Account config persistence for the HTF scanner.
 *
 * Stored as JSON files under `data/htf-account-config/<userId>.json` so the
 * Config tab works without requiring `npm run db:push` first. (The original
 * design wrote to a new `account_settings.htf_config` jsonb column — that
 * still works as a future enhancement, but file storage is the immediate
 * source of truth so prod can pick up Chris's edits without a migration.)
 *
 * Read order on get: file → DEFAULT_ACCOUNT_CONFIG.
 * Write: file only — keeps a single source of truth.
 */
import fs from "fs";
import path from "path";
import {
  DEFAULT_ACCOUNT_CONFIG,
  type AccountConfig,
} from "../../signals/risk/position-sizing";

const STORE_DIR = path.resolve(process.cwd(), "data", "htf-account-config");

function fileFor(userId: number): string {
  return path.join(STORE_DIR, `${userId}.json`);
}

function ensureDir(): void {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true });
  } catch {
    // ignore
  }
}

export function readAccountConfig(userId: number): AccountConfig {
  try {
    const fp = fileFor(userId);
    if (!fs.existsSync(fp)) return { ...DEFAULT_ACCOUNT_CONFIG };
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
    return { ...DEFAULT_ACCOUNT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_ACCOUNT_CONFIG };
  }
}

export function writeAccountConfig(userId: number, cfg: AccountConfig): void {
  ensureDir();
  const fp = fileFor(userId);
  const tmp = `${fp}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf8");
  fs.renameSync(tmp, fp);
}
