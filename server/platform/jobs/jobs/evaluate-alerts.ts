import { registerJob } from "../scheduler";

registerJob({
  id: "evaluate-alerts",
  description: "Scans watchlists + user-configured triggers every 30m during market hours.",
  cron: "*/30 13-21 * * 1-5", // UTC window ~ market hours
  handler: async () => {
    // TODO: iterate active users with alertsEnabled, evaluate triggers, call alerts.deliver()
    throw new Error("NotImplemented: evaluate-alerts");
  },
});
