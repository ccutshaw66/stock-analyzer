#!/usr/bin/env python3
"""
Out-of-sample, SPY-relative, walk-forward validation of StockOtter's indicators.

Reads backtest_signals.json (forward returns + matched SPY forward returns baked in,
on the SAME trading-day grid -> SPY self-excess is exactly 0). No live data / FMP key.

The only question that matters:
  "Does acting on this indicator beat just buying SPY, risk-adjusted, OUT-OF-SAMPLE,
   after correcting for autocorrelation and for the number of factors we tried?"

Methodology (all stdlib, hand-rolled -- no numpy/pandas/scipy):
  1. WALK-FORWARD: anchored-expanding folds over the date axis (not one 60/40 split).
     A GO must hold across the majority of OOS folds AND the pooled OOS set.
  2. OVERLAPPING-RETURN CORRECTION: 7/30/90d forward windows on daily snapshots are
     heavily autocorrelated -> raw t-stats are inflated. We apply a Newey-West / HAC
     standard error with lag = horizon-in-trading-days and use the HAC t-stat for the
     verdict. (Cross-checked against a moving-block bootstrap p-value.)
  3. DEFLATED SHARPE RATIO (Bailey & Lopez de Prado, 2014): deflate the best factor's
     information ratio for the number of trials (factors x horizons), plus the skew and
     kurtosis of its excess-return stream.
  4. OOS SAMPLE FLOOR >= 100: fewer OOS obs -> "INSUFFICIENT N", no verdict.
  5. DATA-INTEGRITY GUARD: assert file exists, has required fields, and SPY-vs-SPY
     excess is ~0 at every horizon (mirrors verify_alignment.py's invariant).
  6. REDUNDANCY: correlation matrix across factor encodings; collapse redundant votes.

Outputs python/validation/factor_validation.json with fold-level detail, HAC-corrected
stats, bootstrap p-values, and the deflated Sharpe.
"""
import json, math, os, statistics as st, random
from collections import defaultdict

# ----------------------------------------------------------------------------------
# Repo-root-safe paths (resolve relative to this file, not the cwd)
# ----------------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))            # .../python/validation
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))  # repo root
SIGNALS_PATH = os.path.join(REPO_ROOT, "backtest_signals.json")
OUT_PATH = os.path.join(HERE, "factor_validation.json")

HORIZONS = ["7d", "30d", "90d"]
HZ_DAYS = {"7d": 7, "30d": 30, "90d": 90}   # forward window in *trading* days
MIN_OOS_N = 100                              # OOS sample floor (per the prior rec)
N_FOLDS = 4                                  # anchored-expanding walk-forward folds
BOOT_ITERS = 2000
random.seed(20260602)

# ----------------------------------------------------------------------------------
# Stats helpers (stdlib only)
# ----------------------------------------------------------------------------------
def phi(x):  # standard normal CDF via erf
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))

def norm_pdf(x):
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)

def mean(v): return sum(v) / len(v)

def sample_std(v):
    n = len(v)
    if n < 2: return 0.0
    m = mean(v)
    return math.sqrt(sum((x - m) ** 2 for x in v) / (n - 1))

def info_ratio(vals):
    """Per-observation Sharpe-like ratio of excess vs SPY (not annualized)."""
    if len(vals) < 2: return 0.0
    s = sample_std(vals)
    return (mean(vals) / s) if s else 0.0

# ---- Newey-West / HAC standard error of the mean ---------------------------------
def newey_west_se_mean(vals, lag):
    """
    HAC standard error of the SAMPLE MEAN, treating the series as a regression on a
    constant. Demeaned residuals e_t = x_t - mean. Bartlett-kernel long-run variance:
       LRV = gamma_0 + 2 * sum_{k=1..L} (1 - k/(L+1)) * gamma_k
    SE(mean) = sqrt(LRV / n).  Falls back to OLS SE when lag<=0.
    """
    n = len(vals)
    if n < 3: return 0.0
    m = mean(vals)
    e = [x - m for x in vals]
    g0 = sum(ei * ei for ei in e) / n
    lrv = g0
    L = max(0, min(lag, n - 1))
    for k in range(1, L + 1):
        w = 1.0 - k / (L + 1.0)
        gk = sum(e[t] * e[t - k] for t in range(k, n)) / n
        lrv += 2.0 * w * gk
    if lrv <= 0:  # numerical floor -> fall back to plain variance
        lrv = g0
    return math.sqrt(lrv / n)

def hac_tstat(vals, lag):
    """Mean / HAC-SE(mean) and a two-sided normal p-value."""
    n = len(vals)
    if n < 3: return (0.0, 0.0, 1.0)
    m = mean(vals)
    se = newey_west_se_mean(vals, lag)
    if se == 0: return (m, 0.0, 1.0)
    t = m / se
    p = 2 * (1 - phi(abs(t)))
    return (m, t, p)

def ols_tstat(vals):
    n = len(vals)
    if n < 3: return (0.0, 0.0, 1.0)
    m = mean(vals); s = sample_std(vals)
    if s == 0: return (m, 0.0, 1.0)
    t = m / (s / math.sqrt(n))
    p = 2 * (1 - phi(abs(t)))
    return (m, t, p)

# ---- Moving-block bootstrap p-value (H0: mean excess <= 0) ------------------------
def moving_block_bootstrap_p(vals, block, iters=BOOT_ITERS):
    """
    Two-sided p-value for mean != 0 under autocorrelation, via the moving-block
    bootstrap. Resample overlapping blocks of length ~horizon, recompute the mean of
    a centered (demeaned) series, and see how often |boot mean| >= |observed mean|.
    """
    n = len(vals)
    if n < 3 or block < 1: return 1.0
    obs = abs(mean(vals))
    m = mean(vals)
    centered = [x - m for x in vals]   # H0 world: mean 0, same dependence
    n_blocks = math.ceil(n / block)
    max_start = n - block
    if max_start < 0: return 1.0
    hits = 0
    for _ in range(iters):
        s = 0.0; cnt = 0
        for _b in range(n_blocks):
            start = random.randint(0, max_start)
            for j in range(block):
                s += centered[start + j]; cnt += 1
                if cnt >= n: break
            if cnt >= n: break
        if abs(s / cnt) >= obs:
            hits += 1
    return (hits + 1) / (iters + 1)

# ---- Skew / excess-kurtosis (for the deflated Sharpe) ----------------------------
def skew_kurt(vals):
    n = len(vals)
    if n < 4: return (0.0, 3.0)
    m = mean(vals); s = math.sqrt(sum((x - m) ** 2 for x in vals) / n)
    if s == 0: return (0.0, 3.0)
    g1 = sum(((x - m) / s) ** 3 for x in vals) / n
    g2 = sum(((x - m) / s) ** 4 for x in vals) / n   # raw kurtosis (normal = 3)
    return (g1, g2)

# ---- Deflated Sharpe Ratio (Bailey & Lopez de Prado 2014) ------------------------
def expected_max_sharpe(n_trials, var_sharpe):
    """
    E[max SR] across N independent trials whose SRs have variance var_sharpe and
    mean 0. Uses the standard extreme-value approx:
        sqrt(V) * [ (1-gamma) Z^-1(1 - 1/N) + gamma * Z^-1(1 - 1/(N e)) ]
    gamma = Euler-Mascheroni. SR here is per-observation (not annualized).
    """
    if n_trials < 2 or var_sharpe <= 0: return 0.0
    g = 0.5772156649  # Euler-Mascheroni
    e = math.e
    z1 = inv_norm(1 - 1.0 / n_trials)
    z2 = inv_norm(1 - 1.0 / (n_trials * e))
    return math.sqrt(var_sharpe) * ((1 - g) * z1 + g * z2)

def inv_norm(p):
    """Inverse standard-normal CDF (Acklam's rational approximation)."""
    if p <= 0: return -1e9
    if p >= 1: return 1e9
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
          1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
          6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    plow, phigh = 0.02425, 1 - 0.02425
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
               ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p > phigh:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
                ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q = p - 0.5; r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / \
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)

def deflated_sharpe(vals, sr_observed, n_trials, var_sharpe_across_trials):
    """
    DSR = Prob( true SR > 0 | observed SR ), deflating SR_observed by the
    expected max SR achievable by chance over n_trials, then z-scaling with the
    higher-moment-adjusted SR standard error (Bailey-LdP eq.):
        SE(SR) = sqrt( (1 - g1*SR + (g2-1)/4 * SR^2) / (n - 1) )
        DSR    = Phi( (SR_obs - SR_threshold) / SE(SR) )
    SR here is per-observation. g2 is RAW kurtosis (normal = 3).
    """
    n = len(vals)
    if n < 10: return None
    g1, g2 = skew_kurt(vals)
    sr0 = expected_max_sharpe(n_trials, var_sharpe_across_trials)  # threshold
    denom = (1 - g1 * sr_observed + (g2 - 1) / 4.0 * sr_observed ** 2)
    if denom <= 0: denom = 1e-9
    se_sr = math.sqrt(denom / (n - 1))
    if se_sr == 0: return None
    z = (sr_observed - sr0) / se_sr
    return {"dsr": round(phi(z), 4), "srObserved": round(sr_observed, 4),
            "srThreshold": round(sr0, 4), "skew": round(g1, 3),
            "kurtosis": round(g2, 3), "z": round(z, 3), "nTrials": n_trials}

# ----------------------------------------------------------------------------------
# Directional excess vs SPY: positive = signal correctly called the right direction.
# ----------------------------------------------------------------------------------
def excess(row, hz, direction):
    r = row.get(f"return_{hz}"); spy = row.get(f"spy_{hz}")
    if r is None or spy is None: return None
    return (r - spy) if direction > 0 else (spy - r)

LONG, SHORT, NEU = 1, -1, 0
def sig_dir(s): return {"STRONG_BUY":LONG,"BUY":LONG,"SELL":SHORT,"STRONG_SELL":SHORT}.get(s,NEU)
def bs_dir(s):  return {"BUY":LONG,"SELL":SHORT}.get(s,NEU)

def factors():
    F = {}
    for s in ["STRONG_BUY","BUY","SELL","STRONG_SELL"]:
        F[f"signal={s}"] = (lambda r,s=s: sig_dir(s) if r["signal"]==s else None)
    for v in ["BUY","SELL"]:
        F[f"bbtc={v}"] = (lambda r,v=v: bs_dir(v) if r.get("bbtc")==v else None)
        F[f"ver={v}"]  = (lambda r,v=v: bs_dir(v) if r.get("ver")==v else None)
    F["rsi<30 (oversold->long)"]   = (lambda r: LONG  if r.get("rsi") is not None and r["rsi"]<30 else None)
    F["rsi>70 (overbought->short)"] = (lambda r: SHORT if r.get("rsi") is not None and r["rsi"]>70 else None)
    F["vol_ratio>1.5 (long)"]      = (lambda r: LONG if r.get("vol_ratio") is not None and r["vol_ratio"]>1.5 else None)
    return F

# ----------------------------------------------------------------------------------
# Data-integrity guard
# ----------------------------------------------------------------------------------
def load_and_guard():
    if not os.path.exists(SIGNALS_PATH):
        raise SystemExit(f"FATAL: signals file not found at {SIGNALS_PATH}")
    rows = json.load(open(SIGNALS_PATH, encoding="utf-8"))
    if not rows:
        raise SystemExit("FATAL: signals file is empty")
    required = {"ticker","date","signal","return_7d","return_30d","return_90d",
                "spy_7d","spy_30d","spy_90d"}
    missing = required - set(rows[0].keys())
    if missing:
        raise SystemExit(f"FATAL: missing required fields: {sorted(missing)}")

    # Alignment invariant: SPY measured against itself must be ~0 at every horizon.
    spy = [r for r in rows if r["ticker"] == "SPY"]
    problems = []
    if spy:
        for hz in HORIZONS:
            ex = [r[f"return_{hz}"] - r[f"spy_{hz}"] for r in spy
                  if r.get(f"return_{hz}") is not None and r.get(f"spy_{hz}") is not None]
            if ex:
                m = mean(ex)
                if abs(m) > 0.02:
                    problems.append(f"SPY self-excess {hz} = {m:+.4f}% (>0.02% -> MISALIGNED)")
    else:
        problems.append("no SPY rows present -> cannot verify alignment invariant")
    if problems:
        for p in problems: print("  GUARD FAIL:", p)
        raise SystemExit("FATAL: data-integrity guard failed (see above)")
    print("  data-integrity guard PASSED (SPY self-excess ~0 at 7/30/90d, fields present)")
    return rows

# ----------------------------------------------------------------------------------
# Per-factor evaluation on an arbitrary row set
# ----------------------------------------------------------------------------------
def collect_excess(rows, fn, hz):
    """Excess series in chronological order (so HAC/block stats see real autocorr)."""
    rows_sorted = sorted(rows, key=lambda r: (r["date"], r["ticker"]))
    out = []
    for r in rows_sorted:
        d = fn(r)
        if d is None: continue
        e = excess(r, hz, d)
        if e is not None: out.append(e)
    return out

def stat_block(ex, hz):
    n = len(ex)
    m = mean(ex)
    lag = HZ_DAYS[hz]
    m_ols, t_ols, p_ols = ols_tstat(ex)
    m_hac, t_hac, p_hac = hac_tstat(ex, lag)
    p_boot = moving_block_bootstrap_p(ex, lag)
    win = sum(1 for e in ex if e > 0) / n * 100
    return {
        "n": n,
        "meanExcessVsSPY": round(m, 4),
        "winRateVsSPY": round(win, 1),
        "infoRatio": round(info_ratio(ex), 4),
        "t_ols": round(t_ols, 2), "p_ols": round(p_ols, 5),
        "t_hac": round(t_hac, 2), "p_hac": round(p_hac, 5),
        "p_bootstrap": round(p_boot, 5),
        "hacLag": lag,
    }

# ----------------------------------------------------------------------------------
# Walk-forward folds: anchored-expanding over the sorted unique dates.
# Fold i trains on [d0, cut_i) and TESTS on [cut_i, cut_{i+1}).
# We only score the OOS test slices (training side is reported for context).
# ----------------------------------------------------------------------------------
def fold_boundaries(dates, n_folds):
    # Reserve the first ~40% as the initial training anchor, then split the
    # remaining 60% into n_folds sequential OOS test windows.
    n = len(dates)
    anchor = int(n * 0.40)
    bounds = []
    span = (n - anchor) / n_folds
    for i in range(n_folds):
        lo = int(anchor + i * span)
        hi = int(anchor + (i + 1) * span) if i < n_folds - 1 else n
        bounds.append((dates[lo], dates[hi - 1]))
    return bounds

def main():
    print("=" * 96)
    print("INDICATOR VALIDATION (walk-forward, HAC-corrected, deflated-Sharpe)")
    print("=" * 96)
    rows = load_and_guard()

    F = factors()
    dates = sorted({r["date"] for r in rows})
    tickers = sorted({r["ticker"] for r in rows if r["ticker"] != "SPY"})

    # Multiple-testing budget = factors x horizons.
    n_tests = len(F) * len(HORIZONS)
    bonf = 0.05 / n_tests

    bounds = fold_boundaries(dates, N_FOLDS)
    print(f"\nUniverse: {len(tickers)} tradeable tickers (SPY = benchmark only)")
    print(f"Dates:    {dates[0]} -> {dates[-1]}  ({len(dates)} trading days, ~{len(dates)/252:.1f}y)")
    print(f"Rows:     {len(rows)}")
    print(f"Folds:    {N_FOLDS} anchored-expanding OOS windows:")
    for i, (lo, hi) in enumerate(bounds):
        print(f"            fold {i+1}: test [{lo} .. {hi}]")
    print(f"Trials:   {len(F)} factors x {len(HORIZONS)} horizons = {n_tests}  -> Bonferroni alpha = {bonf:.5f}")
    print(f"OOS floor: n >= {MIN_OOS_N}.  HAC lag = horizon trading days.  Bootstrap block = horizon.")

    report = {
        "meta": {
            "rowsTotal": len(rows),
            "tradeableTickers": len(tickers),
            "tickers": tickers,
            "dateRange": [dates[0], dates[-1]],
            "tradingDays": len(dates),
            "approxYears": round(len(dates) / 252, 2),
            "horizons": HORIZONS,
            "nFolds": N_FOLDS,
            "foldBounds": [{"fold": i+1, "testStart": lo, "testEnd": hi}
                          for i, (lo, hi) in enumerate(bounds)],
            "nTrials": n_tests,
            "bonferroniAlpha": round(bonf, 6),
            "minOOSn": MIN_OOS_N,
            "method": "anchored walk-forward; Newey-West HAC SE (lag=horizon); "
                      "moving-block bootstrap; Bailey-LdP deflated Sharpe",
        },
        "factors": {},
    }

    # First pass: gather per-factor full + pooled-OOS + per-fold stats; collect IRs
    # for the deflated-Sharpe trial pool.
    pooled = {}   # (name,hz) -> stat dict
    all_oos_irs = []  # info ratios across every (factor,horizon) OOS test -> DSR trial pool

    for hz in HORIZONS:
        for name, fn in F.items():
            full_ex = collect_excess(rows, fn, hz)
            # pooled OOS = union of all fold test windows = dates >= bounds[0][0]
            oos_rows = [r for r in rows if r["date"] >= bounds[0][0]]
            oos_ex = collect_excess(oos_rows, fn, hz)

            fold_results = []
            for i, (lo, hi) in enumerate(bounds):
                fr = [r for r in rows if lo <= r["date"] <= hi]
                fex = collect_excess(fr, fn, hz)
                if len(fex) >= 20:
                    fold_results.append({
                        "fold": i + 1, "n": len(fex),
                        "meanExcessVsSPY": round(mean(fex), 4),
                        "infoRatio": round(info_ratio(fex), 4),
                        "winRateVsSPY": round(sum(1 for e in fex if e > 0)/len(fex)*100, 1),
                    })
                else:
                    fold_results.append({"fold": i + 1, "n": len(fex), "note": "thin (<20)"})

            entry = {"horizon": hz}
            entry["full"] = stat_block(full_ex, hz) if len(full_ex) >= 20 else {"n": len(full_ex), "note": "insufficient (<20)"}
            if len(oos_ex) >= MIN_OOS_N:
                entry["oosPooled"] = stat_block(oos_ex, hz)
                all_oos_irs.append(((name, hz), entry["oosPooled"]["infoRatio"], oos_ex))
            else:
                entry["oosPooled"] = {"n": len(oos_ex), "note": f"INSUFFICIENT N (<{MIN_OOS_N})"}
            entry["folds"] = fold_results
            report["factors"].setdefault(hz, {})[name] = entry
            pooled[(name, hz)] = entry

    # ---- Deflated Sharpe across all trials ----
    # Deflate by E[max SR] over the WHOLE search space (n_tests trials, variance of SRs
    # across trials). Report DSR for two discoveries:
    #   bestByMagnitude   = largest |IR| (may be a fragile short on a tiny n)
    #   bestLongCandidate = largest positive IR (the actual tradeable GO candidate)
    dsr_block = None
    if all_oos_irs:
        irs = [ir for (_, ir, _) in all_oos_irs]
        var_sr = sample_std(irs) ** 2 if len(irs) > 1 else 1e-6
        def dsr_pick(pick):
            (pn, ph), pir, pex = pick
            d = deflated_sharpe(pex, abs(pir), n_tests, var_sr)
            return {"factor": pn, "horizon": ph, "oosInfoRatio": round(pir, 4),
                    "n": len(pex), **(d or {})}
        by_mag = dsr_pick(max(all_oos_irs, key=lambda x: abs(x[1])))
        longs = [t for t in all_oos_irs if t[1] > 0]
        by_long = dsr_pick(max(longs, key=lambda x: x[1])) if longs else None
        dsr_block = {"varSharpeAcrossTrials": round(var_sr, 6), "nTrials": n_tests,
                     "bestByMagnitude": by_mag, "bestLongCandidate": by_long}
    report["deflatedSharpe"] = dsr_block

    # ---- Verdicts ----
    # GO requires, on the OOS pooled set:
    #   (a) mean OOS excess vs SPY > 0,
    #   (b) HAC p < Bonferroni alpha (autocorrelation-corrected),
    #   (c) bootstrap p < 0.05 as a robustness cross-check,
    #   (d) majority of folds (>= ceil(N/2)) positive OOS excess (consistency),
    #   (e) n >= MIN_OOS_N (else INSUFFICIENT N).
    def verdict_for(entry):
        oos = entry["oosPooled"]
        if "note" in oos and "INSUFFICIENT" in oos["note"]:
            return "INSUFFICIENT N"
        folds_ok = [f for f in entry["folds"] if "meanExcessVsSPY" in f]
        n_pos = sum(1 for f in folds_ok if f["meanExcessVsSPY"] > 0)
        need = math.ceil(len(folds_ok) / 2) if folds_ok else 1
        cond = (oos["meanExcessVsSPY"] > 0 and oos["p_hac"] < bonf
                and oos["p_bootstrap"] < 0.05 and n_pos >= need
                and len(folds_ok) >= 2)
        return "GO" if cond else "NO-GO"

    for hz in HORIZONS:
        for name in F:
            v = verdict_for(report["factors"][hz][name])
            report["factors"][hz][name]["verdict"] = v
            folds_ok = [f for f in report["factors"][hz][name]["folds"] if "meanExcessVsSPY" in f]
            report["factors"][hz][name]["foldsPositive"] = sum(1 for f in folds_ok if f["meanExcessVsSPY"] > 0)
            report["factors"][hz][name]["foldsScored"] = len(folds_ok)

    # ---- Print per-horizon verdict tables ----
    for hz in HORIZONS:
        print(f"\n{'-'*96}\nHORIZON {hz}  (HAC lag={HZ_DAYS[hz]}d)\n{'-'*96}")
        hdr = (f"{'factor':<28}{'n_oos':>7}{'fullExc%':>9}{'oosExc%':>9}"
               f"{'oosIR':>7}{'t_hac':>7}{'p_hac':>9}{'p_boot':>8}{'folds+':>7}{'verdict':>16}")
        print(hdr)
        for name in F:
            e = report["factors"][hz][name]
            full = e["full"]; oos = e["oosPooled"]
            fullx = full.get("meanExcessVsSPY", float('nan'))
            if "note" in oos and "INSUFFICIENT" in oos["note"]:
                print(f"{name:<28}{oos.get('n',0):>7}{fullx:>9.3f}{'--':>9}{'--':>7}"
                      f"{'--':>7}{'--':>9}{'--':>8}{'--':>7}{'INSUFFICIENT N':>16}")
                continue
            print(f"{name:<28}{oos['n']:>7}{fullx:>9.3f}{oos['meanExcessVsSPY']:>9.3f}"
                  f"{oos['infoRatio']:>7.3f}{oos['t_hac']:>7.2f}{oos['p_hac']:>9.4f}"
                  f"{oos['p_bootstrap']:>8.4f}{e['foldsPositive']}/{e['foldsScored']:<2}"
                  f"{e['verdict']:>16}")

    # ---- Deflated Sharpe print ----
    print()
    print("-"*96)
    print(f"DEFLATED SHARPE (deflated over {n_tests} trials)")
    print("-"*96)
    def _print_dsr(label, blk):
        if not blk or "dsr" not in blk:
            print(f"  {label}: (not computable)"); return
        print(f"  {label}: {blk['factor']} @ {blk['horizon']}  IR={blk['oosInfoRatio']:+.4f}  n={blk['n']}")
        print(f"      skew {blk['skew']}  kurt {blk['kurtosis']}  |  SR threshold E[max over trials]={blk['srThreshold']:.4f}")
        tag = "PASS (>=0.90)" if blk['dsr'] >= 0.90 else "FAIL (<0.90: not separable from search luck)"
        print(f"      Deflated Sharpe (P[true SR>0]) = {blk['dsr']:.4f}  -> {tag}")
    if dsr_block:
        _print_dsr("best-by-magnitude ", dsr_block.get("bestByMagnitude"))
        _print_dsr("best-long-candidate", dsr_block.get("bestLongCandidate"))
    else:
        print("  (no factor reached the OOS floor; DSR not computed)")

    # ---- Redundancy / confluence correlation matrix ----
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
    for r in rows:
        if r["ticker"] == "SPY": continue
        e = enc(r)
        if any(e[c] is None for c in cols): continue
        for c in cols: data[c].append(e[c])

    def corr(a, b):
        n = len(a); ma = mean(a); mb = mean(b)
        sa = math.sqrt(sum((x-ma)**2 for x in a)/n); sb = math.sqrt(sum((x-mb)**2 for x in b)/n)
        if sa == 0 or sb == 0: return 0.0
        cov = sum((a[i]-ma)*(b[i]-mb) for i in range(n))/n
        return cov/(sa*sb)

    print(f"\n{'-'*96}\nREDUNDANCY / CONFLUENCE  (Pearson corr across factor encodings, rows={len(data['score'])})\n{'-'*96}")
    print(f"{'':<12}" + "".join(f"{c:>11}" for c in cols))
    cormat = {}
    for c1 in cols:
        line = f"{c1:<12}"
        for c2 in cols:
            v = corr(data[c1], data[c2]); cormat.setdefault(c1, {})[c2] = round(v, 3)
            line += f"{v:>11.2f}"
        print(line)
    report["correlation"] = cormat

    # Collapse clusters: |corr| >= 0.7 -> same vote
    THRESH = 0.7
    parent = {c: c for c in cols}
    def find(x):
        while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
        return x
    def union(a, b): parent[find(a)] = find(b)
    for i in range(len(cols)):
        for j in range(i+1, len(cols)):
            if abs(cormat[cols[i]][cols[j]]) >= THRESH:
                union(cols[i], cols[j])
    clusters = defaultdict(list)
    for c in cols: clusters[find(c)].append(c)
    cluster_list = list(clusters.values())
    report["redundancyClusters"] = {"threshold": THRESH, "clusters": cluster_list,
                                    "independentAxes": len(cluster_list)}
    print(f"\n  Clusters at |r|>={THRESH} (each cluster = ONE independent vote):")
    for cl in cluster_list:
        tag = "  <-- redundant, collapses to one vote" if len(cl) > 1 else ""
        print(f"    {cl}{tag}")
    print(f"  => {len(cluster_list)} independent axes of information among {len(cols)} encodings.")

    json.dump(report, open(OUT_PATH, "w", encoding="utf-8"), indent=2)
    print(f"\nWrote {OUT_PATH}")

if __name__ == "__main__":
    main()
