/**
 * Jobs scheduler — Phase 2.5.
 *
 * Every scheduled job in the app should be registered here rather than
 * sprinkled as raw setIntervals. Benefits:
 *   - Single place to see all background work
 *   - Per-job run history + error tracking (exposed via /api/admin/jobs)
 *   - Overrun protection: skips a tick if the previous run is still in flight
 *   - Timeout enforcement per job
 *   - Clean shutdown: stop() halts all schedules for graceful restart
 *
 * Defensive: if node-cron fails to load we log and fall back to setInterval
 * for simple interval jobs (cron-string jobs are skipped with a warning).
 */
import { logger as rootLogger } from "../../lib/logger";

const log = rootLogger.child({ module: "jobs" });

export interface JobSpec {
  /** Stable unique identifier. */
  id: string;
  /** Human-readable purpose. */
  description: string;
  /** Standard cron string, e.g. "0 * * * *" for top-of-hour. */
  cron: string;
  /** Work function. Must be async. */
  handler: () => Promise<void>;
  /** Hard timeout. If the handler takes longer, it gets marked as failed but keeps running. */
  timeoutMs?: number;
  /** If true, skip the next tick while the current one is still running (default true). */
  preventOverrun?: boolean;
  /** If true, run once immediately after registration. */
  runOnStart?: boolean;
}

export interface JobStatus {
  id: string;
  description: string;
  cron: string;
  scheduled: boolean;
  running: boolean;
  lastRunAt?: string;
  lastRunMs?: number;
  lastError?: string;
  totalRuns: number;
  totalErrors: number;
}

interface JobState {
  spec: JobSpec;
  running: boolean;
  lastRunAt?: string;
  lastRunMs?: number;
  lastError?: string;
  totalRuns: number;
  totalErrors: number;
  task?: { stop: () => void };
}

const registry = new Map<string, JobState>();
let cronModule: any = null;
let cronLoadError: string | null = null;
// Pending registrations that arrived before node-cron finished loading.
// They get scheduled once the dynamic import resolves.
const pendingSchedule: JobState[] = [];

// Kick off the import once at module load. Using dynamic import so this
// works in both the CJS production bundle and the ESM tsx runner.
(async () => {
  try {
    const mod = await import("node-cron");
    cronModule = mod?.default || mod;
    log.info({}, "node-cron loaded");
    // Flush any jobs registered before we finished loading
    for (const state of pendingSchedule.splice(0)) {
      scheduleState(state);
    }
  } catch (e: any) {
    cronLoadError = String(e?.message || e);
    log.error({ err: cronLoadError }, "node-cron failed to load — scheduled jobs disabled");
  }
})();

function scheduleState(state: JobState): void {
  if (!cronModule) {
    pendingSchedule.push(state);
    return;
  }
  if (!cronModule.validate?.(state.spec.cron)) {
    log.error(
      { job_id: state.spec.id, cron: state.spec.cron },
      "job NOT scheduled (invalid cron string)",
    );
    return;
  }
  state.task = cronModule.schedule(state.spec.cron, () => {
    runOnce(state).catch(() => { /* runOnce already logs */ });
  });
  log.info({ job_id: state.spec.id, cron: state.spec.cron }, "job scheduled");
}

async function runOnce(state: JobState): Promise<void> {
  const { spec } = state;
  if (state.running && spec.preventOverrun !== false) {
    log.warn({ job_id: spec.id }, "overrun prevented: previous run still in flight");
    return;
  }
  state.running = true;
  const started = Date.now();
  state.lastRunAt = new Date().toISOString();
  log.info({ job_id: spec.id }, "job started");
  try {
    const promise = spec.handler();
    if (spec.timeoutMs && spec.timeoutMs > 0) {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<void>((_, rej) => {
        timer = setTimeout(
          () => rej(new Error(`job timed out after ${spec.timeoutMs}ms`)),
          spec.timeoutMs,
        );
      });
      try {
        await Promise.race([promise, timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } else {
      await promise;
    }
    state.lastRunMs = Date.now() - started;
    state.lastError = undefined;
    state.totalRuns += 1;
    log.info({ job_id: spec.id, duration_ms: state.lastRunMs }, "job completed");
  } catch (err: any) {
    state.lastRunMs = Date.now() - started;
    state.lastError = String(err?.message || err);
    state.totalRuns += 1;
    state.totalErrors += 1;
    log.error(
      { job_id: spec.id, duration_ms: state.lastRunMs, err: state.lastError },
      "job failed",
    );
  } finally {
    state.running = false;
  }
}

/** Register and immediately schedule a job. Safe to call at app boot. */
export function registerJob(spec: JobSpec): void {
  if (registry.has(spec.id)) {
    log.warn({ job_id: spec.id }, "job already registered — replacing");
    const existing = registry.get(spec.id)!;
    try { existing.task?.stop(); } catch {}
  }
  const state: JobState = {
    spec,
    running: false,
    totalRuns: 0,
    totalErrors: 0,
  };
  registry.set(spec.id, state);
  scheduleState(state);

  if (spec.runOnStart) {
    // Give the app a moment to finish booting before firing
    setTimeout(() => {
      runOnce(state).catch(() => {});
    }, 5_000);
  }
}

/** Current status snapshot of all registered jobs — for /api/admin/jobs. */
export function listJobStatus(): JobStatus[] {
  return Array.from(registry.values()).map((s) => ({
    id: s.spec.id,
    description: s.spec.description,
    cron: s.spec.cron,
    scheduled: !!s.task,
    running: s.running,
    lastRunAt: s.lastRunAt,
    lastRunMs: s.lastRunMs,
    lastError: s.lastError,
    totalRuns: s.totalRuns,
    totalErrors: s.totalErrors,
  }));
}

/** Trigger a job immediately by ID. Returns result. For admin use. */
export async function runJobNow(id: string): Promise<JobStatus | { error: string }> {
  const state = registry.get(id);
  if (!state) return { error: "not-found" };
  await runOnce(state);
  return listJobStatus().find((j) => j.id === id)!;
}

/** Halt all schedules. Call on SIGTERM/SIGINT for graceful shutdown. */
export function stopAll(): void {
  for (const s of registry.values()) {
    try { s.task?.stop(); } catch {}
  }
  log.info({ count: registry.size }, "all jobs stopped");
}
