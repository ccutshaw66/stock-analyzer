import Stripe from 'stripe';
import { storage } from './storage';

// ─── Stripe Client ─────────────────────────────────────────────────────────

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2023-10-16' as any,
});

// ─── Price IDs ────────────────────────────────────────────────────────────

export const PRICE_IDS = {
  pro: process.env.STRIPE_PRO_PRICE_ID || 'price_pro_placeholder',
  elite: process.env.STRIPE_ELITE_PRICE_ID || 'price_elite_placeholder',
};

// ─── Tier Limits ──────────────────────────────────────────────────────────

export const TIER_LIMITS = {
  free: { scansPerDay: 5, analysisPerDay: 1, mmExposure: false, tradeLimit: 10, exports: false },
  pro: { scansPerDay: 25, analysisPerDay: 999, mmExposure: true, tradeLimit: 999, exports: false },
  elite: { scansPerDay: 999, analysisPerDay: 999, mmExposure: true, tradeLimit: 999, exports: true },
};

export type SubscriptionTier = keyof typeof TIER_LIMITS;

// ─── Admin Email ──────────────────────────────────────────────────────────

const ADMIN_EMAILS = ['awisper@me.com', 'christopher.cutshaw@gmail.com', 'admin@stockotter.ai'];

// ─── Get User Tier ────────────────────────────────────────────────────────

/**
 * Returns the effective subscription tier for a user.
 * Admin always gets elite. Checks subscriptionExpiresAt for validity.
 */
export async function getUserTier(userId: number): Promise<SubscriptionTier> {
  const user = await storage.getUser(userId);
  if (!user) return 'free';

  // Admin always gets elite
  if (ADMIN_EMAILS.includes(user.email)) return 'elite';

  const tier = (user.subscriptionTier || 'free') as SubscriptionTier;

  // If not free, verify subscription hasn't expired
  if (tier !== 'free') {
    if (user.subscriptionExpiresAt) {
      const now = new Date();
      if (user.subscriptionExpiresAt < now) {
        // Expired — downgrade to free
        await storage.updateUserSubscription(userId, {
          subscriptionTier: 'free',
          stripeSubscriptionId: undefined,
          subscriptionExpiresAt: null,
        });
        return 'free';
      }
    }
    // Valid tier in TIER_LIMITS
    if (tier in TIER_LIMITS) return tier;
  }

  return 'free';
}

// ─── Create Checkout Session ──────────────────────────────────────────────

export async function createCheckoutSession(
  userId: number,
  userEmail: string,
  tier: 'pro' | 'elite',
): Promise<string> {
  const priceId = PRICE_IDS[tier];

  // Get or reuse existing Stripe customer
  let customerId: string | undefined;
  const user = await storage.getUser(userId);
  if (user?.stripeCustomerId) {
    customerId = user.stripeCustomerId;
  } else {
    const customer = await stripe.customers.create({
      email: userEmail,
      metadata: { userId: String(userId) },
    });
    customerId = customer.id;
    await storage.updateUserSubscription(userId, { stripeCustomerId: customerId });
  }

  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:5000';

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: `${baseUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/subscription/cancel`,
    metadata: { userId: String(userId), tier },
  });

  return session.url!;
}

// ─── Create Portal Session ────────────────────────────────────────────────

export async function createPortalSession(stripeCustomerId: string): Promise<string> {
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:5000';

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: `${baseUrl}/subscription`,
  });

  return session.url;
}

// ─── Handle Webhook ──────────────────────────────────────────────────────

export async function handleWebhook(body: Buffer, signature: string): Promise<void> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

  let event: Stripe.Event;

  if (webhookSecret) {
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err: any) {
      throw new Error(`Webhook signature verification failed: ${err.message}`);
    }
  } else {
    // In development with no secret, parse the raw body directly
    event = JSON.parse(body.toString()) as Stripe.Event;
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutCompleted(session);
      break;
    }
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionUpdated(subscription);
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(subscription);
      break;
    }
    default:
      console.log(`[stripe] Unhandled webhook event type: ${event.type}`);
  }
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.userId ? parseInt(session.metadata.userId, 10) : null;
  const tier = session.metadata?.tier as SubscriptionTier | undefined;

  if (!userId || !tier) {
    console.error('[stripe] checkout.session.completed: missing userId or tier in metadata');
    return;
  }

  const subscriptionId = session.subscription as string | undefined;
  let expiresAt: Date | undefined;

  if (subscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      expiresAt = new Date(sub.current_period_end * 1000);
    } catch (err) {
      console.error('[stripe] Failed to retrieve subscription:', err);
    }
  }

  await storage.updateUserSubscription(userId, {
    subscriptionTier: tier,
    stripeCustomerId: session.customer as string | undefined,
    stripeSubscriptionId: subscriptionId,
    subscriptionExpiresAt: expiresAt,
  });

  console.log(`[stripe] User ${userId} upgraded to ${tier}`);
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  const customerId = subscription.customer as string;
  const user = await storage.getUserByStripeCustomerId(customerId);

  if (!user) {
    console.error(`[stripe] subscription.updated: no user found for customer ${customerId}`);
    return;
  }

  // Determine tier from the price
  const priceId = subscription.items.data[0]?.price?.id;
  let tier: SubscriptionTier = 'free';
  if (priceId === PRICE_IDS.pro) tier = 'pro';
  else if (priceId === PRICE_IDS.elite) tier = 'elite';

  const status = subscription.status;
  const expiresAt = new Date(subscription.current_period_end * 1000);

  // If subscription is active/trialing, set tier; otherwise downgrade to free
  if (status === 'active' || status === 'trialing') {
    await storage.updateUserSubscription(user.id, {
      subscriptionTier: tier,
      stripeSubscriptionId: subscription.id,
      subscriptionExpiresAt: expiresAt,
    });
    console.log(`[stripe] User ${user.id} subscription updated to ${tier} (${status})`);
  } else {
    await storage.updateUserSubscription(user.id, {
      subscriptionTier: 'free',
      stripeSubscriptionId: subscription.id,
      subscriptionExpiresAt: expiresAt,
    });
    console.log(`[stripe] User ${user.id} subscription status: ${status}, set to free`);
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  const customerId = subscription.customer as string;
  const user = await storage.getUserByStripeCustomerId(customerId);

  if (!user) {
    console.error(`[stripe] subscription.deleted: no user found for customer ${customerId}`);
    return;
  }

  await storage.updateUserSubscription(user.id, {
    subscriptionTier: 'free',
    stripeSubscriptionId: null,
    subscriptionExpiresAt: null,
  });

  console.log(`[stripe] User ${user.id} subscription cancelled — downgraded to free`);
}

export { stripe };
