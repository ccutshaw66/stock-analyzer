#!/usr/bin/env python3
"""
Trustworthy, repeatable indicator validation (v2).

Supersedes validate_indicators.py, which overstated significance. This version fixes
the flaws the quant review found so a "this beats SPY" claim is actually defensible:

  1. DE-OVERLAP: 7d/30d/90d forward returns on daily rows overlap massively and inflate
     t-stats ~sqrt(horizon)x. We sample one non-overlapping trade per `horizon` bars/ticker.
  2. REAL RISK: annualized Sharpe of the excess stream + max drawdown of the edge curve
     (the old "infoRatio" was neither annualized nor a Sharpe, and risk was never computed).
  3. COSTS: charge a round-trip transaction cost on every strategy trade.
  4. NO SPY IN ITS OWN UNIVERSE: benchmarking a SPY-included universe against SPY is circular.
  5. CONCENTRATION: per-ticker + equal-weight-across-tickers, so two names (INTC/RIVN) can't
     fake a pooled edge. Reports % of tickers positive and the top ticker's share.
  6. MULTIPLE TESTING on the EFFECTIVE number of independent factors (correlation-clustered),
     not 33 — the factors are mostly one momentum signal repeated.

Stdlib only. Read-only on data; writes python/validation/factor_validation_v2.json.
"""
import json, math, statistics as st
from collections import defaultdict

ROWS_ALL = json.load(open("backtest_signals.json"))
ROWS = [r for r in ROWS_ALL if r.get("ticker") != "SPY"]   # rule 4: drop SPY from the universe
HORIZONS = [7, 30, 90]
TRADING_DAYS_YR = 252
COST_BPS_PER_SIDE = 10.0
ROUND_TRIP_COST = 2 * COST_BPS_PER_SIDE / 10000.0          # 0.20% all-in per trade

def phi(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))
def two_sided_p(t): return 2 * (1 - phi(abs(t)))

LONG, SHORT, NEU = 1, -1, 0
def sig_dir(s): return {"STRONG_BUY": LONG, "BUY": LONG, "SELL": SHORT, "STRONG_SELL": SHORT}.get(s, NEU)
def bs_dir(s):  return {"BUY": LONG, "SELL": SHORT}.get(s, NEU)

# factor name -> (row -> direction or None if the factor doesn't fire on this row)
FACTORS = {}
for s in ["STRONG_BUY", "BUY", "SELL", "STRONG_SELL"]:
    FACTORS[f"signal={s}"] = (lambda r, s=s: sig_dir(s) if r.get("signal") == s else None)
for v in ["BUY", "SELL"]:
    FACTORS[f"bbtc={v}"] = (lambda r, v=v: bs_dir(v) if r.get("bbtc") == v else None)
    FACTORS[f"ver={v}"]  = (lambda r, v=v: bs_dir(v) if r.get("ver") == v else None)
FACTORS["rsi<30 (long)"]   = (lambda r: LONG  if r.get("rsi") is not None and r["rsi"] < 30 else None)
FACTORS["rsi>70 (short)"]  = (lambda r: SHORT if r.get("rsi") is not None and r["rsi"] > 70 else None)
FACTORS["vol_ratio>1.5(L)"] = (lambda r: LONG if r.get("vol_ratio") is not None and r["vol_ratio"] > 1.5 else None)

def trade_excess(r, hz, direction):
    """Directional edge vs SPY over the same window, net of round-trip costs (fraction)."""
    ret, spy = r.get(f"return_{hz}d"), r.get(f"spy_{hz}d")
    if ret is None or spy is None: return None
    return direction * (ret - spy) / 100.0 - ROUND_TRIP_COST

def deoverlap(rows, hz):
    """Greedily keep non-overlapping trades per ticker: day_index must advance >= hz."""
    by_t = defaultdict(list)
    for r in rows:
        by_t[r["ticker"]].append(r)
    kept = []
    for t, rs in by_t.items():
        rs.sort(key=lambda x: x["day_index"])
        last = -10**9
        for r in rs:
            if r["day_index"] - last >= hz:
                kept.append(r); last = r["day_index"]
    return kept

def max_drawdown(excess_by_date):
    """Compound the time-sorted excess stream into an edge curve; return max drawdown (fraction)."""
    eq, peak, mdd = 1.0, 1.0, 0.0
    for _, e in sorted(excess_by_date):
        eq *= (1 + e)
        peak = max(peak, eq)
        mdd = min(mdd, eq / peak - 1)
    return mdd

def evaluate(rows, hz):
    out = {}
    for name, fn in FACTORS.items():
        kept = deoverlap([r for r in rows if fn(r) is not None], hz)
        per_ticker = defaultdict(list)
        stream = []   # (date, excess) for the edge curve
        excs = []
        for r in kept:
            e = trade_excess(r, hz, fn(r))
            if e is None: continue
            excs.append(e); per_ticker[r["ticker"]].append(e); stream.append((r["date"], e))
        n = len(excs)
        if n < 30:
            out[name] = {"n": n, "insufficient": True}; continue
        m, sd = st.mean(excs), st.pstdev(excs)
        t = m / (sd / math.sqrt(n)) if sd else 0.0
        sharpe = (m / sd) * math.sqrt(TRADING_DAYS_YR / hz) if sd else 0.0
        # equal-weight across tickers (kills single-name concentration)
        tick_means = {tk: st.mean(v) for tk, v in per_ticker.items() if len(v) >= 3}
        ew = st.mean(tick_means.values()) if tick_means else 0.0
        pct_pos = 100 * sum(1 for v in tick_means.values() if v > 0) / len(tick_means) if tick_means else 0.0
        # concentration: top ticker's share of total positive excess
        totals = {tk: sum(v) for tk, v in per_ticker.items()}
        pos_total = sum(x for x in totals.values() if x > 0) or 1e-9
        top_share = 100 * (max(totals.values()) / pos_total) if totals else 0.0
        out[name] = {
            "n": n, "tickers": len(tick_means),
            "meanExcessPct": round(m * 100, 3),
            "annSharpe": round(sharpe, 2),
            "maxDrawdownPct": round(max_drawdown(stream) * 100, 1),
            "winRateVsSPY": round(100 * sum(1 for e in excs if e > 0) / n, 1),
            "t": round(t, 2), "p": round(two_sided_p(t), 4),
            "ewMeanExcessPct": round(ew * 100, 3),
            "pctTickersPositive": round(pct_pos, 0),
            "topTickerSharePct": round(top_share, 0),
        }
    return out

# ---- effective number of independent factors (correlation clusters) ----
def encode(r):
    return {"signal_dir": sig_dir(r.get("signal", "")), "score": r.get("score"),
            "rsi": r.get("rsi"), "vol_ratio": r.get("vol_ratio"),
            "bbtc_dir": bs_dir(r.get("bbtc", "")), "ver_dir": bs_dir(r.get("ver", ""))}
cols = ["signal_dir", "score", "rsi", "vol_ratio", "bbtc_dir", "ver_dir"]
data = {c: [] for c in cols}
for r in ROWS:
    e = encode(r)
    if any(e[c] is None for c in cols): continue
    for c in cols: data[c].append(e[c])

def corr(a, b):
    n = len(a); ma, mb = st.mean(a), st.mean(b); sa, sb = st.pstdev(a), st.pstdev(b)
    if not sa or not sb: return 0.0
    return sum((a[i]-ma)*(b[i]-mb) for i in range(n)) / n / (sa*sb)

# greedy clustering: |corr| > 0.5 merges into the same cluster
clusters, assigned = [], {}
for i, c1 in enumerate(cols):
    if c1 in assigned: continue
    cluster = [c1]; assigned[c1] = True
    for c2 in cols:
        if c2 in assigned: continue
        if abs(corr(data[c1], data[c2])) > 0.5:
            cluster.append(c2); assigned[c2] = True
    clusters.append(cluster)
M_EFF = len(clusters)
ALPHA = 0.05 / M_EFF

print("=" * 100)
print(f"INDICATOR VALIDATION v2  |  {len(ROWS)} non-SPY signals, {len({r['ticker'] for r in ROWS})} tickers, "
      f"{min(r['date'] for r in ROWS)}→{max(r['date'] for r in ROWS)}")
print(f"costs={COST_BPS_PER_SIDE}bps/side  |  effective independent factors M={M_EFF}  |  significance α=0.05/{M_EFF}={ALPHA:.4f}")
print(f"clusters: " + " | ".join("{" + ",".join(c) + "}" for c in clusters))
print("=" * 100)

dates = sorted({r["date"] for r in ROWS})
cut = dates[int(len(dates) * 0.60)]
report = {"meta": {"rows": len(ROWS), "costBpsPerSide": COST_BPS_PER_SIDE, "M_eff": M_EFF,
                   "alpha": ALPHA, "oosCut": cut, "clusters": clusters}, "factors": {}}

for hz in HORIZONS:
    full = evaluate(ROWS, hz)
    oos = evaluate([r for r in ROWS if r["date"] >= cut], hz)
    print(f"\n──────── horizon {hz}d (de-overlapped, after costs) ────────")
    hdr = f"{'factor':<20}{'n':>5}{'mean%':>8}{'annSharpe':>10}{'maxDD%':>8}{'win%':>6}{'EWmean%':>9}{'%tkPos':>7}{'topShr%':>8}{'OOSmean%':>9}{'verdict':>9}"
    print(hdr)
    for name in FACTORS:
        f = full.get(name, {})
        if f.get("insufficient") or "meanExcessPct" not in f:
            print(f"{name:<20}{f.get('n',0):>5}   — insufficient (n<30 after de-overlap)"); continue
        o = oos.get(name, {})
        oos_mean = o.get("meanExcessPct", float("nan"))
        # GO only if it survives every trustworthiness gate
        go = (f["p"] < ALPHA and f["meanExcessPct"] > 0 and f["annSharpe"] > 0
              and f["ewMeanExcessPct"] > 0 and f["pctTickersPositive"] >= 55
              and isinstance(oos_mean, (int, float)) and oos_mean > 0)
        verdict = "GO" if go else "NO-GO"
        print(f"{name:<20}{f['n']:>5}{f['meanExcessPct']:>8}{f['annSharpe']:>10}{f['maxDrawdownPct']:>8}"
              f"{f['winRateVsSPY']:>6}{f['ewMeanExcessPct']:>9}{int(f['pctTickersPositive']):>7}"
              f"{int(f['topTickerSharePct']):>8}{oos_mean:>9}{verdict:>9}")
        report["factors"].setdefault(f"{hz}d", {})[name] = {**f, "oosMeanExcessPct": oos_mean, "verdict": verdict}

json.dump(report, open("python/validation/factor_validation_v2.json", "w"), indent=2)
print("\nWrote python/validation/factor_validation_v2.json")
print("\nGO = significant after de-overlap+multiple-testing, positive after costs, positive risk-adjusted,")
print("     broad across tickers (>=55% positive, not concentration), AND positive out-of-sample.")
