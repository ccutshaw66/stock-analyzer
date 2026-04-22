/**
 * Billing facade. All Stripe calls route through here.
 * Future providers (PayPal, Paddle) implement the same interface.
 */
import type { Tier } from "../tiers";

export interface BillingProvider {
  name: string;
  createCheckoutSession(userId: string, plan: Tier): Promise<{ url: string }>;
  cancelSubscription(userId: string): Promise<void>;
  handleWebhook(signature: string, rawBody: Buffer): Promise<void>;
}

// TODO: implement stripeProvider in ./stripe.adapter.ts and wire here.
// import { stripeProvider } from "./stripe.adapter";
// export const billing: BillingProvider = stripeProvider;

export type { Tier };
