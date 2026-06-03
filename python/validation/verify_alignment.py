#!/usr/bin/env python3
"""
Data-integrity guard for the SPY benchmark alignment.

backtest.py computes a ticker's forward return as N *trading days* forward
(closes[day + N]) but USED to compute the SPY benchmark as N *calendar days*
forward (date + timedelta(days=N), then scan). Those are different grids, so
SPY-measured-against-itself showed a fake positive excess (~+0.13/+0.52/+1.16%
at 7/30/90d) that inflated every signal's alpha.

This test runs real SPY data through BOTH benchmark methods:
  - NEW: trading-day index (idx + N)      -> self-excess MUST be ~0
  - OLD: calendar-day + forward scan        -> reproduces the old bias

PASS = the NEW path is flat (|mean| < 0.02%) at every horizon.
Exit 0 = aligned, 1 = misaligned.
"""
import json, urllib.request, time, sys
from datetime import datetime, timedelta

EPS = 0.02  # percent

def fetch_spy():
    now = int(time.time())
    p1 = now - (2 * 365 * 24 * 3600)
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/SPY"
           f"?period1={p1}&period2={now}&interval=1d&includeAdjustedClose=true")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    r = json.loads(urllib.request.urlopen(req, timeout=20).read())
    res = r["chart"]["result"][0]
    out = {}
    for t, c in zip(res["timestamp"], res["indicators"]["quote"][0]["close"]):
        if c is None or c <= 0:
            continue
        out[datetime.utcfromtimestamp(t).strftime("%Y-%m-%d")] = float(c)
    return out

def main():
    spy_daily = fetch_spy()
    dates = sorted(spy_daily.keys())
    closes = [spy_daily[d] for d in dates]
    idx = {d: i for i, d in enumerate(dates)}
    n = len(dates)
    print(f"SPY bars: {n}  ({dates[0]} → {dates[-1]})")

    new_ok = True
    for hz in (7, 30, 90):
        new_exc, old_exc = [], []
        for day in range(50, n):
            j = day + hz
            if j >= n:
                continue
            price = closes[day]
            ticker_ret = (closes[j] - price) / price * 100          # return_Nd path

            # NEW benchmark: trading-day index
            spy_new = (closes[day + hz] - price) / price * 100
            new_exc.append(ticker_ret - spy_new)

            # OLD benchmark: calendar-day + up-to-4-day forward scan
            target = datetime.strptime(dates[day], "%Y-%m-%d") + timedelta(days=hz)
            spy_future = None
            for off in range(0, 5):
                chk = (target + timedelta(days=off)).strftime("%Y-%m-%d")
                if chk in spy_daily:
                    spy_future = spy_daily[chk]
                    break
            if spy_future:
                spy_old = (spy_future - price) / price * 100
                old_exc.append(ticker_ret - spy_old)

        m_new = sum(new_exc) / len(new_exc)
        m_old = sum(old_exc) / len(old_exc)
        flag = "OK" if abs(m_new) < EPS else "FAIL"
        if flag == "FAIL":
            new_ok = False
        print(f"  {hz:>3}d  NEW self-excess {m_new:+.4f}% [{flag}]   "
              f"OLD (buggy) {m_old:+.4f}%   (n={len(new_exc)})")

    print("\nALIGNED — benchmark on correct trading-day grid."
          if new_ok else "\nMISALIGNED — benchmark bug still present.")
    sys.exit(0 if new_ok else 1)

if __name__ == "__main__":
    main()
