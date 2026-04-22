import type { Alert, AlertProvider } from "../types";

export const webhookProvider: AlertProvider = {
  name: "webhook",
  async send(userId: string, alert: Alert): Promise<void> {
    // TODO: lookup user's configured webhook URL, POST JSON, handle retries
    throw new Error("NotImplemented: webhookProvider.send");
  },
};
