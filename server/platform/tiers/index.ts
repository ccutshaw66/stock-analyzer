/**
 * Tier gating. Single source of truth for what each tier can do.
 * Pages and routes never check tier inline — they use requireTier() middleware
 * or the canAccess() helper.
 */
export type Tier = "free" | "pro" | "elite";

export interface TierLimits {
  scansPerDay: number;
  watchlistSize: number;
  alertsEnabled: boolean;
  mmExposureEnabled: boolean;
  exportsEnabled: boolean;
  institutionalEnabled: boolean;
}

export const TIERS: Record<Tier, TierLimits> = {
  free: {
    scansPerDay: 10,
    watchlistSize: 5,
    alertsEnabled: false,
    mmExposureEnabled: false,
    exportsEnabled: false,
    institutionalEnabled: false,
  },
  pro: {
    scansPerDay: 30,
    watchlistSize: 25,
    alertsEnabled: true,
    mmExposureEnabled: true,
    exportsEnabled: false,
    institutionalEnabled: true,
  },
  elite: {
    scansPerDay: Infinity,
    watchlistSize: Infinity,
    alertsEnabled: true,
    mmExposureEnabled: true,
    exportsEnabled: true,
    institutionalEnabled: true,
  },
};

const RANK: Record<Tier, number> = { free: 0, pro: 1, elite: 2 };

export function meetsTier(user: Tier, min: Tier): boolean {
  return RANK[user] >= RANK[min];
}

export function limitsFor(tier: Tier): TierLimits {
  return TIERS[tier];
}
