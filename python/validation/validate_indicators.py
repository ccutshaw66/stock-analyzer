#!/usr/bin/env python3
"""
Out-of-sample, SPY-relative validation of StockOtter's indicators.

Uses backtest_signals.json (forward returns + matched SPY returns already baked in),
so no live data / FMP key is needed. Answers the only question that matters:
  "Does acting on this indicator beat just buying SPY, risk-adjusted, out-of-sample?"
"""
import json, math, statistics as st
from collections import defaultdict

ROWS = json.load(open("backtest_signals.json"))
HORIZONS = ["7d", "30d", "90d"]

def phi(x):  # standard normal CDF via erf
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

def tstat_p(vals):
    n = len(vals)
    if n < 3: return (0.0, 0.0, 1.0, n)
    m = st.mean(vals); s = st.pstdev(vals)
    if s == 0: return (m, 0.0, 1.0, n)
    t = m / (s / math.sqrt(n))
    p = 2 * (1 - phi(abs(t)))
    return (m, t, p, n)

def info_ratio(vals):
    if len(vals) < 2: return 0.0
    s = st.pstdev(vals)
    return (st.mean(vals) / s) if s else 0.0

# Directional excess vs SPY: positive = signal correctly called out/under-performance.
def excess(row, hz, direction):
    r = row.get(f"return_{hz}"); spy = row.get(f"spy_{hz}")
    if r is None or spy is None: return None
    return (r - spy) if direction > 0 else (spy - r)

LONG, SHORT, NEU = 1, -1, 0
def sig_dir(s):   return {"STRONG_BUY":LONG,"BUY":LONG,"SELL":SHORT,"STRONG_SELL":SHORT}.get(s,NEU)
def bs_dir(s):    return {"BUY":LONG,"SELL":SHORT}.get(s,NEU)

# ---- Define the factors to test (name -> function row->(direction or None)) ----
def factors():
    F = {}
    for s in ["STRONG_BUY","BUY","SELL","STRONG_SELL"]:
        F[f"signal={s}"] = (lambda r,s=s: sig_dir(s) if r["signal"]==s else None)
    for v in ["BUY","SELL"]:
        F[f"bbtc={v}"] = (lambda r,v=v: bs_dir(v) if r.get("bbtc")==v else None)
        F[f"ver={v}"]  = (lambda r,v=v: bs_dir(v) if r.get("ver")==v else None)
    # RSI extremes (mean-reversion read): oversold->long, overbought->short
    F["rsi<30 (oversold→long)"]  = (lambda r: LONG  if r.get("rsi") is not None and r["rsi"]<30 else None)
    F["rsi>70 (overbought→short)"]= (lambda r: SHORT if r.get("rsi") is not None and r["rsi"]>70 else None)
    # Volume spike on a long
    F["vol_ratio>1.5 (long)"]    = (lambda r: LONG if r.get("vol_ratio") is not None and r["vol_ratio"]>1.5 else None)
    return F

F = factors()

# Date split for out-of-sample (train = earliest 60% of DATES, test = latest 40%)
dates = sorted({r["date"] for r in ROWS})
cut = dates[int(len(dates)*0.60)]
def in_test(r): return r["date"] >= cut

def evaluate(rows, hz):
    out = {}
    for name, fn in F.items():
        ex = []
        for r in rows:
            d = fn(r)
            if d is None: continue
            e = excess(r, hz, d)
            if e is not None: ex.append(e)
        if len(ex) < 20:  # too few to judge
            out[name] = None; continue
        m, t, p, n = tstat_p(ex)
        win = sum(1 for e in ex if e > 0) / len(ex) * 100
        out[name] = {"n": n, "meanExcessVsSPY": round(m,3), "winRateVsSPY": round(win,1),
                     "infoRatio": round(info_ratio(ex),3), "t": round(t,2), "p": round(p,4)}
    return out

# Number of independent tests for multiple-testing correction
n_tests = sum(1 for _ in F) * len(HORIZONS)
bonf = 0.05 / n_tests

report = {"meta": {"rows": len(ROWS), "tickers": len({r['ticker'] for r in ROWS}),
                   "dateRange": [dates[0], dates[-1]], "oosCutDate": cut,
                   "nTests": n_tests, "bonferroniAlpha": round(bonf,5)}, "factors": {}}

print("="*92)
print(f"INDICATOR VALIDATION  |  {len(ROWS)} signals, {report['meta']['tickers']} tickers, {dates[0]}→{dates[-1]}")
print(f"Out-of-sample test set = dates ≥ {cut} (latest 40%)   |   multiple-testing α = 0.05/{n_tests} = {bonf:.5f}")
print("="*92)

allrows = ROWS
testrows = [r for r in ROWS if in_test(r)]

for hz in HORIZONS:
    full = evaluate(allrows, hz)
    oos  = evaluate(testrows, hz)
    print(f"\n──────── horizon {hz} ────────")
    print(f"{'factor':<30}{'n':>6}{'meanExc%':>10}{'win%vsSPY':>11}{'IR':>7}{'OOS_exc%':>10}{'OOS_IR':>8}{'verdict':>10}")
    for name in F:
        f = full.get(name); o = oos.get(name)
        if not f:
            print(f"{name:<30}{'—  (insufficient n)':>50}"); continue
        survives = (f["p"] < bonf) and (f["meanExcessVsSPY"] > 0)
        oos_ok = bool(o) and o["meanExcessVsSPY"] > 0 and o["infoRatio"] > 0
        verdict = "GO" if (survives and oos_ok) else "NO-GO"
        oexc = o["meanExcessVsSPY"] if o else float('nan')
        oir  = o["infoRatio"] if o else float('nan')
        print(f"{name:<30}{f['n']:>6}{f['meanExcessVsSPY']:>10}{f['winRateVsSPY']:>11}{f['infoRatio']:>7}{oexc:>10}{oir:>8}{verdict:>10}")
        report["factors"].setdefault(hz, {})[name] = {
            "full": f, "oos": o, "survivesMultipleTesting": survives, "verdict": verdict}

# ---- Confluence / redundancy: correlation among factor encodings ----
def enc(r):
    return {
        "signal_dir": sig_dir(r["signal"]),
        "score": r.get("score"),
        "rsi": r.get("rsi"),
        "vol_ratio": r.get("vol_ratio"),
        "bbtc_dir": bs_dir(r.get("bbtc","")),
        "ver_dir": bs_dir(r.get("ver","")),
    }
cols = ["signal_dir","score","rsi","vol_ratio","bbtc_dir","ver_dir"]
data = {c: [] for c in cols}
for r in ROWS:
    e = enc(r)
    if any(e[c] is None for c in cols): continue
    for c in cols: data[c].append(e[c])

def corr(a,b):
    n=len(a); ma=st.mean(a); mb=st.mean(b)
    sa=st.pstdev(a); sb=st.pstdev(b)
    if sa==0 or sb==0: return 0.0
    cov=sum((a[i]-ma)*(b[i]-mb) for i in range(n))/n
    return cov/(sa*sb)

print("\n──────── confluence / redundancy: correlation matrix ────────")
print(f"(rows used: {len(data['score'])})")
print(f"{'':<12}" + "".join(f"{c:>11}" for c in cols))
cormat={}
for c1 in cols:
    line=f"{c1:<12}"
    for c2 in cols:
        v=corr(data[c1],data[c2]); cormat.setdefault(c1,{})[c2]=round(v,2)
        line+=f"{v:>11.2f}"
    print(line)
report["correlation"]=cormat

json.dump(report, open("python/validation/factor_validation.json","w"), indent=2)
print("\nWrote python/validation/factor_validation.json")
