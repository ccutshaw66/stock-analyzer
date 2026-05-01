/**
 * SEC Form 4 transaction code translator.
 *
 * Form 4 raw codes (P/S/M/F/A/D/...) are meaningless to retail users. We map
 * each to a plain-English label, classify whether it's directionally
 * meaningful (real buy/sell decision) vs administrative (tax withholding,
 * grants, exercises), and provide a tooltip explanation.
 *
 * Single source of truth — used by both the snapshot insider adapter and the
 * existing parseInstitutionalData path until cutover.
 */

export interface InsiderCodeTranslation {
  label: string;
  meaningful: boolean;
  direction: "buy" | "sell" | "neutral";
  explain: string;
}

const CODE_MAP: Record<string, InsiderCodeTranslation> = {
  P: { label: "Open Market Buy",       meaningful: true,  direction: "buy",     explain: "Insider bought shares with their own money — strongest conviction signal." },
  S: { label: "Open Market Sell",      meaningful: true,  direction: "sell",    explain: "Insider sold shares on the open market." },
  A: { label: "Stock Grant",           meaningful: false, direction: "neutral", explain: "Company-issued stock grant or award (compensation, not a decision to buy)." },
  D: { label: "Disposed to Issuer",    meaningful: false, direction: "neutral", explain: "Shares returned to the company — often part of a buyback or corporate action." },
  F: { label: "Tax Withholding",       meaningful: false, direction: "neutral", explain: "Shares automatically withheld to pay taxes on vesting RSUs — not a directional decision." },
  M: { label: "Option Exercise",       meaningful: false, direction: "neutral", explain: "Insider converted options into stock — administrative, doesn't signal buy/sell intent." },
  X: { label: "Option Exercise",       meaningful: false, direction: "neutral", explain: "Exercised an in-the-money option." },
  C: { label: "Derivative Conversion", meaningful: false, direction: "neutral", explain: "Converted a derivative security into stock." },
  G: { label: "Gift",                  meaningful: false, direction: "neutral", explain: "Bona fide gift — often estate planning." },
  V: { label: "Voluntary Report",      meaningful: true,  direction: "neutral", explain: "Insider voluntarily reported early — check the underlying transaction type." },
  I: { label: "Discretionary",         meaningful: false, direction: "neutral", explain: "Broker-directed transaction within a company plan." },
  J: { label: "Other",                 meaningful: false, direction: "neutral", explain: "Other acquisition or disposition — see SEC filing for details." },
  K: { label: "Equity Swap",           meaningful: false, direction: "neutral", explain: "Equity swap or similar derivative instrument." },
  L: { label: "Small Acquisition",     meaningful: false, direction: "neutral", explain: "Small acquisition under SEC Rule 16a-6." },
  W: { label: "Inheritance",           meaningful: false, direction: "neutral", explain: "Acquired by will or laws of descent." },
  Z: { label: "Voting Trust",          meaningful: false, direction: "neutral", explain: "Deposit into or withdrawal from a voting trust." },
  U: { label: "Tender Offer",          meaningful: true,  direction: "sell",    explain: "Disposed of shares in a change-of-control tender." },
};

export function translateInsiderCode(rawType: string): InsiderCodeTranslation {
  const t = String(rawType || "").toUpperCase().trim();
  const code = t.split(/[\s-]/)[0]; // "M-Exempt" -> "M"
  const lower = String(rawType || "").toLowerCase();
  if (lower.includes("purchase") || lower.includes("buy")) {
    return { label: "Open Market Buy", meaningful: true, direction: "buy", explain: "Insider bought shares." };
  }
  if (lower.includes("sale") || lower.includes("sell")) {
    return { label: "Open Market Sell", meaningful: true, direction: "sell", explain: "Insider sold shares." };
  }
  return CODE_MAP[code] ?? { label: rawType || "Unknown", meaningful: false, direction: "neutral", explain: "Unclassified transaction type." };
}
