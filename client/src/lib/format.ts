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

export function getChangeColor(value: number | null | undefined): string {
  if (value === null || value === undefined) return "text-muted-foreground";
  if (value > 0) return "text-green-500";
  if (value < 0) return "text-red-500";
  return "text-muted-foreground";
}

export function getScoreColor(score: number): string {
  if (score >= 7) return "text-green-500";
  if (score >= 5) return "text-yellow-500";
  return "text-red-500";
}

export function getScoreBgColor(score: number): string {
  if (score >= 7) return "bg-green-500";
  if (score >= 5) return "bg-yellow-500";
  return "bg-red-500";
}

export function getVerdictColor(verdict: string): { bg: string; text: string; border: string } {
  switch (verdict) {
    case "STRONG CONVICTION":
    case "INVESTMENT GRADE":
    case "YES":
      return { bg: "bg-green-500", text: "text-green-500", border: "border-green-500/30" };
    case "SPECULATIVE":
    case "WATCH":
      return { bg: "bg-yellow-500", text: "text-yellow-500", border: "border-yellow-500/30" };
    case "HIGH RISK":
    case "NO":
      return { bg: "bg-red-500", text: "text-red-500", border: "border-red-500/30" };
    default:
      return { bg: "bg-muted", text: "text-muted-foreground", border: "border-muted" };
  }
}

export function getIndicatorColor(color: string): string {
  switch (color) {
    case "green": return "text-green-500";
    case "red": return "text-red-500";
    case "yellow": return "text-yellow-500";
    default: return "text-muted-foreground";
  }
}

export function getBadgeBgColor(color: string): string {
  switch (color) {
    case "green": return "bg-green-500/15 text-green-500 border-green-500/20";
    case "red": return "bg-red-500/15 text-red-500 border-red-500/20";
    case "yellow": return "bg-yellow-500/15 text-yellow-500 border-yellow-500/20";
    default: return "bg-muted text-muted-foreground";
  }
}
