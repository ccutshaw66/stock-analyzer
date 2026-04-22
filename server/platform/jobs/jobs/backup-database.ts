import { registerJob } from "../scheduler";

registerJob({
  id: "backup-database",
  description: "Nightly pg_dump, upload to S3/B2, verify checksum, prune old backups.",
  cron: "0 3 * * *",
  handler: async () => {
    // TODO: shell out to pg_dump, pipe to S3 via aws-sdk, email result
    throw new Error("NotImplemented: backup-database");
  },
  maxRetries: 1,
});
