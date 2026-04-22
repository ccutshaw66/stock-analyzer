/**
 * Beta computation (stock vs benchmark).
 * Delivered through the in-house adapter (data/providers/in-house.adapter.ts).
 */
import type { OHLCV } from "../data/types";

export function computeBeta(stockBars: OHLCV[], benchmarkBars: OHLCV[]): number | null {
  if (stockBars.length !== benchmarkBars.length || stockBars.length < 30) return null;
  const stockReturns: number[] = [];
  const benchReturns: number[] = [];
  for (let i = 1; i < stockBars.length; i++) {
    stockReturns.push((stockBars[i].c - stockBars[i - 1].c) / stockBars[i - 1].c);
    benchReturns.push((benchmarkBars[i].c - benchmarkBars[i - 1].c) / benchmarkBars[i - 1].c);
  }
  const meanS = stockReturns.reduce((a, b) => a + b, 0) / stockReturns.length;
  const meanB = benchReturns.reduce((a, b) => a + b, 0) / benchReturns.length;
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < stockReturns.length; i++) {
    cov += (stockReturns[i] - meanS) * (benchReturns[i] - meanB);
    varB += (benchReturns[i] - meanB) ** 2;
  }
  if (varB === 0) return null;
  return cov / varB;
}
