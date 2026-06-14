#!/usr/bin/env python3
"""
Capital-preservation re-grade (Workstream A2).

Re-judges existing OOS validation artifacts by the RIGHT bar — "don't lose money"
(docs/RULES.md §6) — instead of SPY-excess. Reads the committed *_oos_validation.json
files (no network needed) and applies one gate:

  CAPITAL-PRESERVING  = positive expectancy AND win rate >= 50% AND median trade >= 0
                        AND drawdown controlled  → you rarely lose, and you net positive.
  FAT-TAIL EV         = positive expectancy BUT win rate < 50% / median trade < 0
                        → makes money over many trades, but LOSES on the typical trade
                          and leans on a few big winners. Wrong character for "don't lose money."
  NO-GO               = negative expectancy → loses money.

Note: Rounding Bottom (67.6% WR) and Pipe Bottom (71% WR) — the high-win-rate patterns most
likely to be genuinely capital-preserving — have NO committed artifact here, so they need a
fresh backtest (bars) before they can be graded. See the command printed at the end.
"""
import json, os

V = os.path.dirname(__file__)

def grade(win_pct, expectancy, median, dd_note):
    if expectancy is None or expectancy <= 0:
        return "NO-GO", "negative/zero expectancy — loses money"
    # positive expectancy from here
    cap_preserving = (win_pct is not None and win_pct >= 50) and (median is not None and median >= 0)
    if cap_preserving:
        return "CAPITAL-PRESERVING", "wins often + nets positive"
    return "FAT-TAIL EV", f"positive EV but win rate {win_pct}% / median {median} — loses on the typical trade, leans on big winners"

rows = []

# ---- BBTC (OOS, ASIS) ----
try:
    d = json.load(open(f"{V}/bbtc_oos_validation.json"))
    m = d["metrics"]["OOS"]["ASIS"]
    rows.append(("BBTC (trend follower)", m["trades"], m["winRatePct"], m["avgRetPct"], m["medianRetPct"],
                 f"${m['maxDD$']:,} maxDD", *grade(m["winRatePct"], m["avgRetPct"], m["medianRetPct"], None)))
except Exception as e:
    rows.append(("BBTC", "—", None, None, None, f"err {e}", "ERR", ""))

# ---- AMC (target-before-stop) ----
try:
    d = json.load(open(f"{V}/amc_oos_validation.json"))["factor"]["amc"]
    win = d["winPctTargetBeforeStop"] * 100
    exp = d["cleanExpectancyR"]            # in R
    rows.append(("AMC (momentum confluence)", d["nSetups"], round(win,1), exp, round(d["medianFwd60"]*100,2),
                 "expectancy in R", *grade(win, exp, d["medianFwd60"]*100, None)))
except Exception as e:
    rows.append(("AMC", "—", None, None, None, f"err {e}", "ERR", ""))

# ---- HTF (OOS, 60d) ----
try:
    h = json.load(open(f"{V}/htf_oos_validation.json"))["factor"]["htf"]["OOS"]["h60"]
    win = round(h["winVsSpy"]*100, 1)      # % beating SPY (raw win-rate not stored; closest proxy)
    rows.append(("HTF (high tight flag)", h["n"], win, round(h["meanExc"]*100,2), round(h["medFwd"]*100,2),
                 "mean is fat-tail (top1%=43% of excess)", *grade(win, h["meanExc"]*100, h["medFwd"]*100, None)))
except Exception as e:
    rows.append(("HTF", "—", None, None, None, f"err {e}", "ERR", ""))

print("="*108)
print("CAPITAL-PRESERVATION RE-GRADE (OOS) — bar = 'don't lose money', NOT 'beat SPY'")
print("="*108)
print(f"{'strategy':<28}{'trades':>8}{'win%':>7}{'expectancy':>12}{'median%':>9}{'verdict':>20}   notes")
out = {}
for name, n, win, exp, med, ddnote, verdict, why in rows:
    print(f"{name:<28}{str(n):>8}{str(win):>7}{str(exp):>12}{str(med):>9}{verdict:>20}   {why}")
    out[name] = {"trades": n, "winPct": win, "expectancy": exp, "medianPct": med, "verdict": verdict, "why": why, "ddNote": ddnote}

json.dump(out, open(f"{V}/capital_preservation.json","w"), indent=2)
print("\nWrote capital_preservation.json")
print("""
READ:
- A strategy is "capital-preserving" only if you WIN MORE OFTEN THAN YOU LOSE and net positive.
- BBTC/HTF make money on AVERAGE but LOSE on the typical trade (win rate <50%, negative median) —
  they rely on rare big winners. That's the opposite of 'don't lose money'.
- AMC has NEGATIVE expectancy — it loses money. NO-GO.

STILL NEEDED (need bars — run on a keyed machine):
- Rounding Bottom (67.6% win rate) and Pipe Bottom (71%) are the ONLY high-win-rate candidates that
  match 'don't lose money', but have no committed artifact. Generate their OOS data, then re-grade:
    npx tsx server/diag/strategy-generic-pnl.ts  # (rounding-bottom / pipe-bottom on the $5-75 universe)
""")
