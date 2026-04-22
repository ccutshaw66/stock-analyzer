import { registerJob } from "../scheduler";

registerJob({
  id: "log-daily-signals",
  description: "Logs Stock Otter signals for all tracked tickers at 4:30 PM ET weekdays.",
  cron: "30 16 * * 1-5",
  handler: async () => {
    // TODO: iterate tracked tickers, call signals.evaluateConfluence(), persist to signal_log
    throw new Error("NotImplemented: log-daily-signals");
  },
  maxRetries: 2,
  timeoutMs: 5 * 60 * 1000,
});
