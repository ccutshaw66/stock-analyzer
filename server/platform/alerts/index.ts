/**
 * Alerts facade. Delivery providers register themselves; the facade picks
 * which ones to call based on user preferences.
 */
import type { Alert, AlertChannel, AlertProvider } from "./types";
import { emailProvider } from "./providers/email.adapter";
import { webhookProvider } from "./providers/webhook.adapter";
// import { pushProvider } from "./providers/push.adapter"; // future
// import { smsProvider } from "./providers/sms.adapter";   // future

const providers: Record<AlertChannel, AlertProvider> = {
  email: emailProvider,
  webhook: webhookProvider,
  push: emailProvider, // TODO replace with real push
  sms: emailProvider,  // TODO replace with Twilio
};

export async function deliver(userId: string, alert: Alert, channels: AlertChannel[]): Promise<void> {
  await Promise.allSettled(channels.map((c) => providers[c].send(userId, alert)));
}

export type { Alert, AlertChannel } from "./types";
