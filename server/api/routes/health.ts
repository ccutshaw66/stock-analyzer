/**
 * /api/health endpoint. Used by UptimeRobot / BetterUptime / Kubernetes.
 *
 * Checks:
 *   - DB connectivity (SELECT 1)
 *   - Process uptime
 *   - Version from package.json
 *   - Last deploy info (optional — read from the deploy status file if present)
 *
 * Returns 200 when DB is reachable, 503 otherwise. The payload always
 * contains the full detail so monitors can alert on sub-checks.
 *
 * This endpoint is intentionally unauthenticated so external monitors can
 * hit it. It does NOT leak secrets.
 */
import { Router } from "express";
import fs from "fs";
import { pool } from "../../storage";

// Resolved once at boot — avoids fs reads on every request
let CACHED_VERSION = "unknown";
let CACHED_GIT_SHA = "unknown";
try {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  CACHED_VERSION = pkg.version || "unknown";
} catch {}
try {
  // GITHUB_SHA is set by CI; fall back to reading .git/HEAD on the box
  CACHED_GIT_SHA =
    process.env.GIT_SHA ||
    process.env.GITHUB_SHA ||
    (() => {
      try {
        const head = fs.readFileSync(".git/HEAD", "utf8").trim();
        if (head.startsWith("ref: ")) {
          const ref = head.slice(5).trim();
          return fs.readFileSync(`.git/${ref}`, "utf8").trim().slice(0, 12);
        }
        return head.slice(0, 12);
      } catch {
        return "unknown";
      }
    })();
} catch {}

const BOOT_TIME = Date.now();
const DEPLOY_STATUS_PATH = "/tmp/stock-analyzer-deploy-status.json";
const HEARTBEAT_PATH = "/tmp/stock-analyzer-heartbeat";

// Self-ping heartbeat: every minute, write a fresh timestamp to a file.
// External monitoring is the source of truth for alerts, but this gives us
// an internal fallback if outbound monitoring is somehow silent.
setInterval(() => {
  try {
    fs.writeFileSync(HEARTBEAT_PATH, new Date().toISOString());
  } catch {
    // never let a failed heartbeat write crash anything
  }
}, 60_000).unref();
// Write one immediately on boot so the file always exists.
try { fs.writeFileSync(HEARTBEAT_PATH, new Date().toISOString()); } catch {}

async function checkDb(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const start = Date.now();
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
    return { ok: true, latency_ms: Date.now() - start };
  } catch (e: any) {
    return { ok: false, latency_ms: Date.now() - start, error: String(e?.message || e) };
  }
}

function readLastDeploy(): { time: string; success: boolean } | null {
  try {
    if (!fs.existsSync(DEPLOY_STATUS_PATH)) return null;
    const j = JSON.parse(fs.readFileSync(DEPLOY_STATUS_PATH, "utf8"));
    return {
      time: j.last_deploy_time || "",
      success: !!j.last_deploy_success,
    };
  } catch {
    return null;
  }
}

export const healthRouter = Router();

/**
 * Liveness: the process is up and able to respond. Cheap.
 * For k8s-style livenessProbe — never hit the DB here.
 */
healthRouter.get("/health/live", (_req, res) => {
  res.json({
    ok: true,
    status: "live",
    uptime_s: Math.round((Date.now() - BOOT_TIME) / 1000),
    ts: new Date().toISOString(),
  });
});

/**
 * Readiness / full health: DB reachable.
 * Returns 503 if DB is down. Use this for UptimeRobot / BetterUptime / LB probes.
 */
healthRouter.get("/health", async (_req, res) => {
  const db = await checkDb();
  const deploy = readLastDeploy();
  const ok = db.ok;
  res.status(ok ? 200 : 503).json({
    ok,
    status: ok ? "healthy" : "degraded",
    version: CACHED_VERSION,
    git_sha: CACHED_GIT_SHA,
    uptime_s: Math.round((Date.now() - BOOT_TIME) / 1000),
    checks: {
      db,
    },
    last_deploy: deploy,
    ts: new Date().toISOString(),
  });
});
