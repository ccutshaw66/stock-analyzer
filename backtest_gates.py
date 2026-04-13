#!/usr/bin/env python3
"""
Stock Otter — 3-Gate System Backtest
=====================================
Replicates the exact TypeScript gate logic in Python to backtest
against 2 years of historical daily data.

Gate 1 (READY): VER reversal — RSI divergence + volume spike (1.8x) + BB extreme
Gate 2 (SET):   Momentum confirmation — AMC score 3+/5 within 5 days of Gate 1
Gate 3 (GO):    EMA stack aligned + price confirms (no MME in backtest)

Only signals where Gate 2+ cleared are logged (actionable signals).
"""

import json
import math
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from collections import defaultdict

# ─── Tickers ─────────────────────────────────────────────────────────────────
WATCHLIST = ["AAPL", "MSFT", "HD", "JNJ", "KO", "O", "JEPI", "XOM", "BAC", "TSLA"]
PORTFOLIO = ["O", "JEPI", "KO", "JNJ", "XOM", "T", "VZ", "PG"]
TRADED = ["NVDA", "AMD", "AMZN", "META", "NFLX", "GOOGL", "PLTR", "SOFI",
          "RIVN", "COIN", "SNAP", "ROKU", "DIS", "INTC", "NKE",
          "MO", "F", "SPY", "QQQ", "IWM"]
ALL_TICKERS = sorted(set(WATCHLIST + PORTFOLIO + TRADED))

# ─── Indicator Functions ─────────────────────────────────────────────────────

def compute_ema(data, period):
    ema = [float('nan')] * len(data)
    if len(data) < period:
        return ema
    s = sum(data[:period]) / period
    ema[period - 1] = s
    k = 2.0 / (period + 1)
    for i in range(period, len(data)):
        ema[i] = data[i] * k + ema[i - 1] * (1 - k)
    return ema

def compute_sma(data, period):
    sma = [float('nan')] * len(data)
    for i in range(period - 1, len(data)):
        sma[i] = sum(data[i - period + 1:i + 1]) / period
    return sma

def compute_rsi(closes, period=14):
    rsi = [float('nan')] * len(closes)
    for idx in range(period, len(closes)):
        gains = 0.0
        losses = 0.0
        for i in range(idx - period + 1, idx + 1):
            diff = closes[i] - closes[i - 1]
            if diff > 0: gains += diff
            else: losses += abs(diff)
        avg_gain = gains / period
        avg_loss = losses / period
        rsi[idx] = 100.0 if avg_loss == 0 else 100.0 - (100.0 / (1.0 + avg_gain / avg_loss))
    return rsi

def is_nan(x):
    return x != x  # NaN check

# ─── Gate 1: Reversal Detection ─────────────────────────────────────────────

def evaluate_gate1(closes, highs, lows, volumes, rsi, bb_upper, bb_lower, vol_avg20, last_idx, lookback=5):
    for days_back in range(lookback):
        i = last_idx - days_back
        if i < 20 or is_nan(rsi[i]) or is_nan(bb_upper[i]) or is_nan(bb_lower[i]) or is_nan(vol_avg20[i]):
            continue
        
        volume_spike = (volumes[i] or 0) >= vol_avg20[i] * 1.8
        
        # Bullish reversal
        has_bullish_div = False
        for lb in range(5, min(21, i + 1)):
            prev = i - lb
            if prev < 0 or is_nan(rsi[prev]):
                continue
            if closes[i] < closes[prev] and rsi[i] > rsi[prev] and rsi[i] < 40:
                has_bullish_div = True
                break
        
        touched_lower = lows[i] <= bb_lower[i] or (i > 0 and closes[i-1] <= bb_lower[i-1])
        closed_back_in = closes[i] > bb_lower[i]
        
        if has_bullish_div and volume_spike and touched_lower and closed_back_in:
            return {"cleared": True, "direction": "BULLISH", "days_ago": days_back}
        
        # Bearish reversal
        has_bearish_div = False
        for lb in range(5, min(21, i + 1)):
            prev = i - lb
            if prev < 0 or is_nan(rsi[prev]):
                continue
            if closes[i] > closes[prev] and rsi[i] < rsi[prev] and rsi[i] > 60:
                has_bearish_div = True
                break
        
        touched_upper = highs[i] >= bb_upper[i] or (i > 0 and closes[i-1] >= bb_upper[i-1])
        closed_back_upper = closes[i] < bb_upper[i]
        
        if has_bearish_div and volume_spike and touched_upper and closed_back_upper:
            return {"cleared": True, "direction": "BEARISH", "days_ago": days_back}
    
    return {"cleared": False, "direction": None, "days_ago": None}

# ─── Gate 2: Momentum Confirmation ──────────────────────────────────────────

def evaluate_gate2(closes, rsi, histogram, vami_scaled, ema9, ema21, direction, g1_days_ago, last_idx, window=5):
    start = max(0, last_idx - g1_days_ago)
    end = min(last_idx, start + window)
    
    for i in range(start, end + 1):
        if i < 1:
            continue
        
        score = 0
        
        # MACD turning
        if not is_nan(histogram[i]):
            if direction == "BULLISH" and histogram[i] > (histogram[i-1] if not is_nan(histogram[i-1]) else 0):
                score += 1
            elif direction == "BEARISH" and histogram[i] < (histogram[i-1] if not is_nan(histogram[i-1]) else 0):
                score += 1
        
        # RSI recovering
        if not is_nan(rsi[i]) and 35 < rsi[i] < 65:
            score += 1
        
        # Price confirms
        if direction == "BULLISH" and closes[i] > closes[i-1]:
            score += 1
        elif direction == "BEARISH" and closes[i] < closes[i-1]:
            score += 1
        
        # VAMI
        if direction == "BULLISH" and vami_scaled[i] > 0 and vami_scaled[i] > vami_scaled[i-1]:
            score += 1
        elif direction == "BEARISH" and vami_scaled[i] < 0 and vami_scaled[i] < vami_scaled[i-1]:
            score += 1
        
        # EMA separation
        if not is_nan(ema9[i]) and not is_nan(ema21[i]) and closes[i] > 0:
            if abs(ema9[i] - ema21[i]) / closes[i] * 100 > 0.3:
                score += 1
        
        if score >= 3:
            return {"cleared": True, "direction": direction, "score": score}
    
    return {"cleared": False, "direction": None, "score": 0}

# ─── Gate 3: Trend Alignment ────────────────────────────────────────────────

def evaluate_gate3(closes, ema9, ema21, ema50, direction, last_idx):
    e9, e21, e50 = ema9[last_idx], ema21[last_idx], ema50[last_idx]
    price = closes[last_idx]
    
    if is_nan(e9) or is_nan(e21) or is_nan(e50):
        return {"cleared": False}
    
    if direction == "BULLISH":
        stack = e9 > e21 and e21 > e50
        price_ok = price > e9
    else:
        stack = e9 < e21 and e21 < e50
        price_ok = price < e9
    
    return {"cleared": stack and price_ok, "stack": stack, "price_ok": price_ok}

# ─── Yahoo Fetch ─────────────────────────────────────────────────────────────

def fetch_chart(ticker, period1, period2):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?period1={period1}&period2={period2}&interval=1d&includeAdjustedClose=true"
    headers = {"User-Agent": "Mozilla/5.0"}
    req = urllib.request.Request(url, headers=headers)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                result = data.get("chart", {}).get("result", [])
                return result[0] if result else None
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(5 * (attempt + 1))
            else:
                return None
        except:
            if attempt < 2: time.sleep(2)
    return None

# ─── Main Backtest ───────────────────────────────────────────────────────────

def main():
    now = int(time.time())
    two_years_ago = now - (2 * 365 * 24 * 3600)
    
    all_signals = []
    spy_daily = {}
    
    print(f"3-Gate Backtest: {len(ALL_TICKERS)} tickers, 2 years\n")
    
    tickers_to_fetch = ["SPY"] + [t for t in ALL_TICKERS if t != "SPY"]
    
    for idx, ticker in enumerate(tickers_to_fetch):
        print(f"[{idx+1}/{len(tickers_to_fetch)}] {ticker}...", end=" ", flush=True)
        
        chart = fetch_chart(ticker, two_years_ago, now)
        if not chart:
            print("FAILED")
            continue
        
        timestamps = chart.get("timestamp", [])
        quotes = chart.get("indicators", {}).get("quote", [{}])[0]
        closes_raw = quotes.get("close", [])
        highs_raw = quotes.get("high", [])
        lows_raw = quotes.get("low", [])
        volumes_raw = quotes.get("volume", [])
        
        # Clean data
        closes, highs, lows, volumes = [], [], [], []
        for i in range(len(closes_raw)):
            c = closes_raw[i] if closes_raw[i] is not None and closes_raw[i] > 0 else (closes[-1] if closes else 0)
            h = highs_raw[i] if highs_raw[i] is not None else c
            l = lows_raw[i] if lows_raw[i] is not None else c
            v = float(volumes_raw[i]) if volumes_raw[i] is not None else 0.0
            closes.append(float(c))
            highs.append(float(h))
            lows.append(float(l))
            volumes.append(v)
        
        if len(closes) < 60:
            print(f"{len(closes)} bars (skip)")
            continue
        
        # Store SPY prices
        if ticker == "SPY":
            for j, ts in enumerate(timestamps):
                if j < len(closes):
                    d = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
                    spy_daily[d] = closes[j]
        
        # Compute all indicators once
        rsi = compute_rsi(closes, 14)
        ema9 = compute_ema(closes, 9)
        ema21 = compute_ema(closes, 21)
        ema50 = compute_ema(closes, 50)
        
        # Bollinger Bands
        bb_sma = compute_sma(closes, 20)
        bb_upper = [float('nan')] * len(closes)
        bb_lower = [float('nan')] * len(closes)
        for i in range(19, len(closes)):
            s = sum((closes[j] - bb_sma[i])**2 for j in range(i-19, i+1))
            std = math.sqrt(s / 20)
            bb_upper[i] = bb_sma[i] + 2 * std
            bb_lower[i] = bb_sma[i] - 2 * std
        
        vol_avg20 = compute_sma(volumes, 20)
        
        # MACD
        macd12 = compute_ema(closes, 12)
        macd26 = compute_ema(closes, 26)
        macd_line = [macd12[i] - macd26[i] if not is_nan(macd12[i]) and not is_nan(macd26[i]) else float('nan') for i in range(len(closes))]
        valid_macd = [(v, i) for i, v in enumerate(macd_line) if not is_nan(v)]
        if valid_macd:
            macd_vals = [v for v, _ in valid_macd]
            macd_sig = compute_ema(macd_vals, 9)
            macd_signal = [float('nan')] * len(closes)
            for j, (_, orig_idx) in enumerate(valid_macd):
                if j < len(macd_sig):
                    macd_signal[orig_idx] = macd_sig[j]
        else:
            macd_signal = [float('nan')] * len(closes)
        
        histogram = [macd_line[i] - macd_signal[i] if not is_nan(macd_line[i]) and not is_nan(macd_signal[i]) else float('nan') for i in range(len(closes))]
        
        # VAMI
        vami = [0.0] * len(closes)
        avg_vol20 = compute_sma(volumes, 20)
        for i in range(1, len(closes)):
            if closes[i-1] == 0 or is_nan(avg_vol20[i]) or avg_vol20[i] == 0:
                vami[i] = vami[i-1]
                continue
            ret = (closes[i] - closes[i-1]) / closes[i-1] * 100
            vr = min(2.5, max(0.5, volumes[i] / avg_vol20[i]))
            wr = ret * vr
            k = 2 / 13.0
            vami[i] = wr * k + vami[i-1] * (1 - k)
        vami_scaled = [v * 8 for v in vami]
        
        # Walk through each day
        signal_count = 0
        last_signal_day = -10  # Avoid duplicate signals within 5 days
        
        for day in range(60, len(closes)):
            # Skip if we signaled too recently (debounce)
            if day - last_signal_day < 5:
                continue
            
            # Gate 1
            g1 = evaluate_gate1(closes, highs, lows, volumes, rsi, bb_upper, bb_lower, vol_avg20, day, lookback=5)
            if not g1["cleared"]:
                continue
            
            # Gate 2
            g2 = evaluate_gate2(closes, rsi, histogram, vami_scaled, ema9, ema21, g1["direction"], g1["days_ago"], day, window=5)
            if not g2["cleared"]:
                continue
            
            # Gate 3
            g3 = evaluate_gate3(closes, ema9, ema21, ema50, g2["direction"], day)
            
            gates_cleared = 2 if not g3["cleared"] else 3
            direction = g2["direction"]
            
            if gates_cleared == 3:
                signal = "STRONG_BUY" if direction == "BULLISH" else "STRONG_SELL"
                confidence = "HIGH"
            else:
                signal = "BUY" if direction == "BULLISH" else "SELL"
                confidence = "MODERATE"
            
            price = closes[day]
            
            # Forward returns
            ret_7d = ((closes[day+7] - price) / price * 100) if day+7 < len(closes) and closes[day+7] > 0 else None
            ret_30d = ((closes[day+30] - price) / price * 100) if day+30 < len(closes) and closes[day+30] > 0 else None
            ret_90d = ((closes[day+90] - price) / price * 100) if day+90 < len(closes) and closes[day+90] > 0 else None
            
            date_str = datetime.utcfromtimestamp(timestamps[day]).strftime("%Y-%m-%d") if day < len(timestamps) else f"day-{day}"
            
            all_signals.append({
                "ticker": ticker,
                "date": date_str,
                "signal": signal,
                "gates_cleared": gates_cleared,
                "confidence": confidence,
                "direction": direction,
                "price": round(price, 2),
                "return_7d": round(ret_7d, 2) if ret_7d is not None else None,
                "return_30d": round(ret_30d, 2) if ret_30d is not None else None,
                "return_90d": round(ret_90d, 2) if ret_90d is not None else None,
            })
            signal_count += 1
            last_signal_day = day
        
        print(f"{len(closes)} bars → {signal_count} signals")
        time.sleep(0.5)
    
    # ─── Analysis ────────────────────────────────────────────────────────────
    
    print(f"\n{'='*70}")
    print("3-GATE SYSTEM BACKTEST RESULTS")
    print(f"{'='*70}")
    print(f"\nTotal signals: {len(all_signals)}")
    
    # Signal distribution
    dist = defaultdict(int)
    for s in all_signals:
        dist[s["signal"]] += 1
    print(f"\nSignal Distribution:")
    for sig, cnt in sorted(dist.items(), key=lambda x: -x[1]):
        print(f"  {sig:15s}  {cnt:5d}")
    
    # Win rates by horizon
    for horizon in ["7d", "30d", "90d"]:
        key = f"return_{horizon}"
        with_data = [s for s in all_signals if s[key] is not None]
        if not with_data:
            continue
        
        buys = [s for s in with_data if s["direction"] == "BULLISH"]
        sells = [s for s in with_data if s["direction"] == "BEARISH"]
        
        buy_wins = [s for s in buys if s[key] > 0]
        sell_wins = [s for s in sells if s[key] < 0]
        
        total = len(buys) + len(sells)
        wins = len(buy_wins) + len(sell_wins)
        
        avg_buy = sum(s[key] for s in buys) / len(buys) if buys else 0
        avg_sell = sum(s[key] for s in sells) / len(sells) if sells else 0
        
        print(f"\n  {horizon.upper()} Forward Returns:")
        print(f"    Buy signals:  {len(buys):5d}  |  Win rate: {len(buy_wins)/len(buys)*100 if buys else 0:5.1f}%  |  Avg return: {avg_buy:+.2f}%")
        print(f"    Sell signals: {len(sells):5d}  |  Win rate: {len(sell_wins)/len(sells)*100 if sells else 0:5.1f}%  |  Avg return: {avg_sell:+.2f}%")
        print(f"    Combined:                Win rate: {wins/total*100 if total else 0:5.1f}%")
    
    # By confidence level (30d)
    print(f"\n{'─'*70}")
    print("BY CONFIDENCE LEVEL (30-Day)")
    print(f"{'─'*70}")
    for conf in ["HIGH", "MODERATE"]:
        sigs = [s for s in all_signals if s["confidence"] == conf and s["return_30d"] is not None]
        if not sigs:
            print(f"  {conf:12s}  No signals")
            continue
        buys = [s for s in sigs if s["direction"] == "BULLISH"]
        sells = [s for s in sigs if s["direction"] == "BEARISH"]
        buy_wins = [s for s in buys if s["return_30d"] > 0]
        sell_wins = [s for s in sells if s["return_30d"] < 0]
        total = len(buys) + len(sells)
        wins = len(buy_wins) + len(sell_wins)
        avg = sum(s["return_30d"] for s in sigs) / len(sigs)
        print(f"  {conf:12s}  {total:4d} signals  |  Win rate: {wins/total*100 if total else 0:5.1f}%  |  Avg return: {avg:+.2f}%")
    
    # By ticker (30d)
    print(f"\n{'─'*70}")
    print("BY TICKER (30-Day, sorted by win rate)")
    print(f"{'─'*70}")
    print(f"  {'Ticker':8s} {'Signals':>8s} {'Win Rate':>10s} {'Avg Ret':>10s}")
    ticker_stats = {}
    for ticker in ALL_TICKERS:
        t_sigs = [s for s in all_signals if s["ticker"] == ticker and s["return_30d"] is not None]
        if not t_sigs:
            continue
        buys = [s for s in t_sigs if s["direction"] == "BULLISH"]
        sells = [s for s in t_sigs if s["direction"] == "BEARISH"]
        buy_wins = [s for s in buys if s["return_30d"] > 0]
        sell_wins = [s for s in sells if s["return_30d"] < 0]
        total = len(buys) + len(sells)
        wins = len(buy_wins) + len(sell_wins)
        wr = wins / total * 100 if total else 0
        avg = sum(s["return_30d"] for s in t_sigs) / len(t_sigs)
        ticker_stats[ticker] = {"total": total, "win_rate": wr, "avg_return": avg}
    
    for t, d in sorted(ticker_stats.items(), key=lambda x: -x[1]["win_rate"]):
        print(f"  {t:8s} {d['total']:>8d} {d['win_rate']:>9.1f}% {d['avg_return']:>+9.2f}%")
    
    # Best/worst calls
    buys_30d = [s for s in all_signals if s["direction"] == "BULLISH" and s["return_30d"] is not None]
    if buys_30d:
        best = sorted(buys_30d, key=lambda s: -s["return_30d"])[:5]
        worst = sorted(buys_30d, key=lambda s: s["return_30d"])[:5]
        
        print(f"\n{'─'*70}")
        print("TOP 5 BEST BUY CALLS (30d)")
        for c in best:
            print(f"  {c['ticker']:8s} {c['date']:12s} ${c['price']:>8.2f} → {c['return_30d']:+7.2f}%  ({c['confidence']})")
        
        print(f"\nTOP 5 WORST BUY CALLS (30d)")
        for c in worst:
            print(f"  {c['ticker']:8s} {c['date']:12s} ${c['price']:>8.2f} → {c['return_30d']:+7.2f}%  ({c['confidence']})")
    
    # Comparison vs old system
    print(f"\n{'='*70}")
    print("COMPARISON: Old System vs 3-Gate System")
    print(f"{'='*70}")
    print(f"  Old system:  14,817 signals  |  56.3% buy win rate (30d)  |  +2.17% avg return")
    buys_30 = [s for s in all_signals if s["direction"] == "BULLISH" and s["return_30d"] is not None]
    if buys_30:
        wr = len([s for s in buys_30 if s["return_30d"] > 0]) / len(buys_30) * 100
        avg = sum(s["return_30d"] for s in buys_30) / len(buys_30)
        print(f"  3-Gate:      {len(all_signals):6d} signals  |  {wr:.1f}% buy win rate (30d)  |  {avg:+.2f}% avg return")
    print(f"{'='*70}\n")
    
    # Save
    with open("/home/user/workspace/stock-analyzer/backtest_gates_results.json", "w") as f:
        json.dump(all_signals, f, indent=2)
    print(f"Saved {len(all_signals)} signals to backtest_gates_results.json")

if __name__ == "__main__":
    main()
