const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  compactDisplay: "short",
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "N/A";
  return currencyFormatter.format(value);
}

export function formatCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return "N/A";
  return compactFormatter.format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "N/A";
  return value.toFixed(2) + "%";
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined) return "N/A";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatLargeNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "N/A";
  const abs = Math.abs(value);
  if (abs >= 1e12) return "$" + (value / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return "$" + (value / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return "$" + (value / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return "$" + (value / 1e3).toFixed(2) + "K";
  return "$" + value.toFixed(2);
}

export function formatVolume(value: number | null | undefined): string {
  if (value === null || value === undefined) return "N/A";
  return compactFormatter.format(value);
}

// Color helpers below — semantic signal tokens only. Per the universal-
// structure rule, this formatter file is canonical and MUST NOT introduce
// Tailwind palette classes (text-green-*, bg-red-*, etc.) — semantic
// tokens only (text-bull / text-bear / text-watch).

export function getChangeColor(value: number | null | undefined): string {
  if (value === null || value === undefined) return "text-muted-foreground";
  if (value > 0) return "text-bull";
  if (value < 0) return "text-bear";
  return "text-muted-foreground";
}

export function getScoreColor(score: number): string {
  if (score >= 7) return "text-bull";
  if (score >= 5) return "text-watch";
  return "text-bear";
}

export function getScoreBgColor(score: number): string {
  if (score >= 7) return "bg-bull";
  if (score >= 5) return "bg-watch";
  return "bg-bear";
}

export function getVerdictColor(verdict: string): { bg: string; text: string; border: string } {
  switch (verdict) {
    case "STRONG CONVICTION":
    case "INVESTMENT GRADE":
    case "YES":
      return { bg: "bg-bull", text: "text-bull", border: "border-bull/30" };
    case "SPECULATIVE":
    case "WATCH":
      return { bg: "bg-watch", text: "text-watch", border: "border-watch/30" };
    case "HIGH RISK":
    case "NO":
      return { bg: "bg-bear", text: "text-bear", border: "border-bear/30" };
    default:
      return { bg: "bg-muted", text: "text-muted-foreground", border: "border-muted" };
  }
}

export function getIndicatorColor(color: string): string {
  switch (color) {
    case "green": return "text-bull";
    case "red": return "text-bear";
    case "yellow": return "text-watch";
    default: return "text-muted-foreground";
  }
}

export function getBadgeBgColor(color: string): string {
  switch (color) {
    case "green": return "bg-bull/15 text-bull border-bull/20";
    case "red": return "bg-bear/15 text-bear border-bear/20";
    case "yellow": return "bg-watch/15 text-watch border-watch/20";
    default: return "bg-muted text-muted-foreground";
  }
}
