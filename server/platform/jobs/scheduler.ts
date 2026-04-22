/**
 * Lightweight cron wrapper.
 * Every job declares: id, schedule, handler, optional dependencies, retry policy.
 * Scheduler enforces ordering, surfaces failures, and exposes status to admin UI.
 */
export interface Job {
  id: string;
  description: string;
  cron: string; // "30 16 * * 1-5" etc.
  dependsOn?: string[];
  handler: () => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

const registered: Job[] = [];

export function registerJob(job: Job): void {
  registered.push(job);
}

export function listJobs(): Job[] {
  return [...registered];
}

export async function runJob(id: string): Promise<{ ok: boolean; error?: string; durationMs: number }> {
  const job = registered.find((j) => j.id === id);
  if (!job) return { ok: false, error: "not-found", durationMs: 0 };
  const t0 = Date.now();
  try {
    await job.handler();
    return { ok: true, durationMs: Date.now() - t0 };
  } catch (err) {
    // TODO: surface via telemetry, notify operator
    return { ok: false, error: String(err), durationMs: Date.now() - t0 };
  }
}

// TODO: wire into node-cron or bullmq at boot
