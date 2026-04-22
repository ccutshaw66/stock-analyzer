import { registerJob } from "../scheduler";

registerJob({
  id: "check-outcomes",
  description: "Fills 7/30/90-day realized returns against logged signals.",
  cron: "0 17 * * 1-5",
  dependsOn: ["log-daily-signals"],
  handler: async () => {
    // TODO: query signal_log where outcomes unfilled & lookback matured, compute returns
    throw new Error("NotImplemented: check-outcomes");
  },
});
