/**
 * Metals vs the Economy — static annual history (owner-only page).
 *
 * Why static: FMP only carries gold/silver from 2007 and has no world-GDP
 * series, but the thesis starts in 1971 (Nixon ends the gold standard). 50-year-
 * old annual prices/GDP never change, so this is the correct one-source pattern
 * (cache forever, no per-request API). Figures are ANNUAL public-record values:
 *   - GDP: World Bank nominal GDP, current US$ (trillions).
 *   - Gold/Silver: London fix annual-average spot, US$/oz.
 * Approximate to the dollar/0.1T — fine for a half-century macro comparison;
 * refine specific years if needed.
 */

export interface MacroYear {
  year: number;
  worldGdpT: number; // world nominal GDP, US$ trillions
  usGdpT: number;    // US nominal GDP, US$ trillions
  gold: number;      // annual-average spot, US$/oz
  silver: number;    // annual-average spot, US$/oz
}

export type CrisisType = "policy" | "financial" | "war" | "pandemic";

export interface Crisis {
  start: number;   // year
  end: number;     // year (==start for a point event); for ongoing, the current year
  label: string;
  type: CrisisType;
  ongoing?: boolean; // still active — render as "start–present", band runs to now
  note?: string;
}

/** 1971 → present, one row per year. */
export const MACRO_HISTORY: MacroYear[] = [
  { year: 1971, worldGdpT: 3.4, usGdpT: 1.16, gold: 41, silver: 1.55 },
  { year: 1972, worldGdpT: 3.9, usGdpT: 1.28, gold: 58, silver: 1.69 },
  { year: 1973, worldGdpT: 4.9, usGdpT: 1.43, gold: 97, silver: 2.56 },
  { year: 1974, worldGdpT: 5.6, usGdpT: 1.55, gold: 159, silver: 4.71 },
  { year: 1975, worldGdpT: 6.3, usGdpT: 1.69, gold: 161, silver: 4.42 },
  { year: 1976, worldGdpT: 6.7, usGdpT: 1.88, gold: 125, silver: 4.35 },
  { year: 1977, worldGdpT: 7.6, usGdpT: 2.08, gold: 148, silver: 4.62 },
  { year: 1978, worldGdpT: 8.9, usGdpT: 2.35, gold: 193, silver: 5.40 },
  { year: 1979, worldGdpT: 10.3, usGdpT: 2.63, gold: 306, silver: 11.09 },
  { year: 1980, worldGdpT: 11.2, usGdpT: 2.86, gold: 615, silver: 20.63 },
  { year: 1981, worldGdpT: 11.4, usGdpT: 3.21, gold: 460, silver: 10.52 },
  { year: 1982, worldGdpT: 11.3, usGdpT: 3.34, gold: 376, silver: 7.95 },
  { year: 1983, worldGdpT: 11.5, usGdpT: 3.63, gold: 424, silver: 11.44 },
  { year: 1984, worldGdpT: 11.8, usGdpT: 4.04, gold: 361, silver: 8.14 },
  { year: 1985, worldGdpT: 12.9, usGdpT: 4.34, gold: 317, silver: 6.15 },
  { year: 1986, worldGdpT: 15.4, usGdpT: 4.58, gold: 368, silver: 5.47 },
  { year: 1987, worldGdpT: 17.5, usGdpT: 4.86, gold: 447, silver: 7.02 },
  { year: 1988, worldGdpT: 19.5, usGdpT: 5.25, gold: 437, silver: 6.53 },
  { year: 1989, worldGdpT: 20.5, usGdpT: 5.66, gold: 381, silver: 5.50 },
  { year: 1990, worldGdpT: 23.4, usGdpT: 5.96, gold: 384, silver: 4.82 },
  { year: 1991, worldGdpT: 24.4, usGdpT: 6.16, gold: 362, silver: 4.04 },
  { year: 1992, worldGdpT: 26.2, usGdpT: 6.52, gold: 344, silver: 3.94 },
  { year: 1993, worldGdpT: 26.6, usGdpT: 6.86, gold: 360, silver: 4.30 },
  { year: 1994, worldGdpT: 28.5, usGdpT: 7.29, gold: 384, silver: 5.28 },
  { year: 1995, worldGdpT: 31.0, usGdpT: 7.64, gold: 384, silver: 5.20 },
  { year: 1996, worldGdpT: 31.8, usGdpT: 8.07, gold: 388, silver: 5.20 },
  { year: 1997, worldGdpT: 31.7, usGdpT: 8.58, gold: 331, silver: 4.90 },
  { year: 1998, worldGdpT: 31.5, usGdpT: 9.09, gold: 294, silver: 5.54 },
  { year: 1999, worldGdpT: 32.6, usGdpT: 9.66, gold: 279, silver: 5.22 },
  { year: 2000, worldGdpT: 33.8, usGdpT: 10.25, gold: 279, silver: 4.95 },
  { year: 2001, worldGdpT: 33.6, usGdpT: 10.58, gold: 271, silver: 4.37 },
  { year: 2002, worldGdpT: 35.0, usGdpT: 10.94, gold: 310, silver: 4.60 },
  { year: 2003, worldGdpT: 39.3, usGdpT: 11.46, gold: 363, silver: 4.88 },
  { year: 2004, worldGdpT: 44.1, usGdpT: 12.21, gold: 410, silver: 6.67 },
  { year: 2005, worldGdpT: 47.6, usGdpT: 13.04, gold: 445, silver: 7.32 },
  { year: 2006, worldGdpT: 51.5, usGdpT: 13.81, gold: 603, silver: 11.55 },
  { year: 2007, worldGdpT: 58.4, usGdpT: 14.45, gold: 695, silver: 13.38 },
  { year: 2008, worldGdpT: 64.0, usGdpT: 14.77, gold: 872, silver: 14.99 },
  { year: 2009, worldGdpT: 60.6, usGdpT: 14.48, gold: 972, silver: 14.67 },
  { year: 2010, worldGdpT: 66.6, usGdpT: 15.05, gold: 1225, silver: 20.19 },
  { year: 2011, worldGdpT: 73.5, usGdpT: 15.60, gold: 1571, silver: 35.12 },
  { year: 2012, worldGdpT: 75.2, usGdpT: 16.25, gold: 1669, silver: 31.15 },
  { year: 2013, worldGdpT: 77.6, usGdpT: 16.88, gold: 1411, silver: 23.79 },
  { year: 2014, worldGdpT: 79.7, usGdpT: 17.61, gold: 1266, silver: 19.08 },
  { year: 2015, worldGdpT: 75.2, usGdpT: 18.30, gold: 1160, silver: 15.68 },
  { year: 2016, worldGdpT: 76.5, usGdpT: 18.80, gold: 1251, silver: 17.14 },
  { year: 2017, worldGdpT: 81.4, usGdpT: 19.61, gold: 1257, silver: 17.05 },
  { year: 2018, worldGdpT: 86.5, usGdpT: 20.66, gold: 1268, silver: 15.71 },
  { year: 2019, worldGdpT: 87.7, usGdpT: 21.54, gold: 1393, silver: 16.21 },
  { year: 2020, worldGdpT: 85.0, usGdpT: 21.35, gold: 1770, silver: 20.55 },
  { year: 2021, worldGdpT: 97.0, usGdpT: 23.68, gold: 1799, silver: 25.14 },
  { year: 2022, worldGdpT: 100.9, usGdpT: 26.01, gold: 1801, silver: 21.73 },
  { year: 2023, worldGdpT: 105.6, usGdpT: 27.72, gold: 1943, silver: 23.35 },
  { year: 2024, worldGdpT: 110.0, usGdpT: 29.18, gold: 2386, silver: 28.27 },
  { year: 2025, worldGdpT: 113.0, usGdpT: 30.5, gold: 2700, silver: 32.0 },
];

/** Major crises / shocks that hit the global and US economy, 1971 → present. */
export const CRISES: Crisis[] = [
  { start: 1971, end: 1971, label: "Nixon ends gold standard", type: "policy", note: "USD floats; gold begins trading freely. The anchor of this whole chart." },
  { start: 1973, end: 1974, label: "Oil embargo + stagflation", type: "war", note: "OPEC embargo; deep recession; gold ~4x." },
  { start: 1979, end: 1980, label: "Oil shock / Iran + silver spike", type: "war", note: "Volcker rate shock; Hunt brothers run silver to ~$50." },
  { start: 1987, end: 1987, label: "Black Monday", type: "financial", note: "-22% single-day crash." },
  { start: 1990, end: 1991, label: "Gulf War + recession", type: "war" },
  { start: 1997, end: 1998, label: "Asian crisis / LTCM", type: "financial" },
  { start: 2000, end: 2002, label: "Dot-com bust", type: "financial" },
  { start: 2001, end: 2001, label: "9/11", type: "war" },
  { start: 2003, end: 2003, label: "Iraq War", type: "war" },
  { start: 2007, end: 2009, label: "Global Financial Crisis", type: "financial", note: "QE money-printing begins in earnest; gold ~2x into 2011." },
  { start: 2010, end: 2012, label: "EU sovereign-debt crisis", type: "financial" },
  { start: 2020, end: 2020, label: "COVID-19 pandemic", type: "pandemic", note: "Largest peacetime money-printing; gold to records." },
  { start: 2022, end: 2026, label: "Russia–Ukraine war", type: "war", ongoing: true, note: "Still active. Energy/food shock + 40-yr-high inflation, fastest rate hikes in decades." },
  { start: 2025, end: 2026, label: "Iran war + Strait of Hormuz shut", type: "war", ongoing: true, note: "Hormuz closed → oil squeeze; massive safe-haven bid drives gold past $4,000 and silver to ~$70." },
];
