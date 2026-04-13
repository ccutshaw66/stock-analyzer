#!/usr/bin/env python3
"""
Stock Otter — Track Record Model Backtest
==========================================
Runs the exact BBTC + VER + COMBINED signal logic from track-record.ts
against 2 years of historical daily data for watchlist + portfolio tickers.

Measures:
  - Win rate at 7/30/90 day horizons
  - Average return by signal type and score bracket
  - Alpha vs SPY
  - Best/worst calls
  - Monthly signal distribution
"""

import json
import math
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from collections import defaultdict

# ─── Tickers ────────────────────────────────────────────────────────────────────
# Watchlist (from favorites table via demo-seed.ts)
WATCHLIST = ["AAPL", "MSFT", "HD", "JNJ", "KO", "O", "JEPI", "XOM", "BAC", "TSLA"]

# Portfolio / dividend holdings
PORTFOLIO = ["O", "JEPI", "KO", "JNJ", "XOM", "T", "VZ", "PG"]

# Traded tickers (from demo trades)
TRADED = ["NVDA", "AMD", "AMZN", "META", "NFLX", "GOOGL", "PLTR", "SOFI",
          "RIVN", "COIN", "SNAP", "ROKU", "PARA", "DIS", "INTC", "NKE",
          "WBA", "MO", "F", "SPY", "QQQ", "IWM"]

# De-duplicate and sort
ALL_TICKERS = sorted(set(WATCHLIST + PORTFOLIO + TRADED))
print(f"Backtesting {len(ALL_TICKERS)} tickers: {', '.join(ALL_TICKERS)}")

# ─── Yahoo Finance Data Fetch ────────────────────────────────────────────────

def fetch_chart(ticker, period1, period2):
    """Fetch daily OHLCV from Yahoo Finance chart API (2y of data)."""
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?period1={period1}&period2={period2}&interval=1d"
        f"&includeAdjustedClose=true"
    )
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    req = urllib.request.Request(url, headers=headers)
    
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read())
                result = data.get("chart", {}).get("result", [])
                if not result:
                    return None
                return result[0]
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 5 * (attempt + 1)
                print(f"  Rate limited on {ticker}, waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"  HTTP {e.code} for {ticker}")
                return None
        except Exception as e:
            print(f"  Error fetching {ticker}: {e}")
            if attempt < 2:
                time.sleep(2)
    return None


def compute_ema(closes, length):
    """Compute EMA — exact same logic as the TypeScript version."""
    if len(closes) < length:
        return closes[:]
    
    multiplier = 2.0 / (length + 1)
    ema = [0.0] * len(closes)
    
    # SMA seed
    sma = sum(closes[:length]) / length
    ema[length - 1] = sma
    
    for i in range(length, len(closes)):
        ema[i] = (closes[i] - ema[i-1]) * multiplier + ema[i-1]
    
    # Fill early values
    for i in range(length - 1):
        ema[i] = ema[length - 1]
    
    return ema


def compute_rsi(closes, period=14):
    """Compute RSI at each point — same as track-record.ts logic."""
    if len(closes) < period + 1:
        return [50.0] * len(closes)
    
    rsi_values = [50.0] * len(closes)
    
    for idx in range(period, len(closes)):
        gains = 0.0
        losses = 0.0
        for i in range(idx - period + 1, idx + 1):
            diff = closes[i] - closes[i-1]
            if diff > 0:
                gains += diff
            else:
                losses += abs(diff)
        avg_gain = gains / period
        avg_loss = losses / period
        if avg_loss == 0:
            rsi_values[idx] = 100.0
        else:
            rsi_values[idx] = 100.0 - (100.0 / (1.0 + avg_gain / avg_loss))
    
    return rsi_values


# ─── Signal Generation ──────────────────────────────────────────────────────

def generate_signals_for_ticker(ticker, chart_data):
    """
    Walk through daily bars and generate BBTC/VER/COMBINED signals
    exactly matching the track-record.ts logic.
    Returns list of signal dicts.
    """
    timestamps = chart_data.get("timestamp", [])
    quotes = chart_data.get("indicators", {}).get("quote", [{}])[0]
    closes_raw = quotes.get("close", [])
    volumes_raw = quotes.get("volume", [])
    
    if len(closes_raw) < 60:
        return []
    
    # Clean data (fill nulls forward)
    closes = []
    for i, c in enumerate(closes_raw):
        if c is not None and c > 0:
            closes.append(float(c))
        elif closes:
            closes.append(closes[-1])
        else:
            closes.append(0)
    
    volumes = [float(v) if v is not None else 0.0 for v in volumes_raw]
    
    # Pre-compute indicators
    ema9 = compute_ema(closes, 9)
    ema21 = compute_ema(closes, 21)
    ema50 = compute_ema(closes, 50)
    rsi_vals = compute_rsi(closes, 14)
    
    signals = []
    
    # Start from day 50 (need enough data for EMA50)
    for day in range(50, len(closes)):
        date_ts = timestamps[day] if day < len(timestamps) else None
        if date_ts is None:
            continue
        date_str = datetime.utcfromtimestamp(date_ts).strftime("%Y-%m-%d")
        price = closes[day]
        if price <= 0:
            continue
        
        last_ema9 = ema9[day]
        last_ema21 = ema21[day]
        last_ema50 = ema50[day]
        
        # ── BBTC Signal ──
        ema9_above_21 = last_ema9 > last_ema21
        ema21_above_50 = last_ema21 > last_ema50
        price_above_ema9 = price > last_ema9
        
        bbtc_signal = "HOLD"
        if ema9_above_21 and price_above_ema9:
            bbtc_signal = "BUY"
        if not ema9_above_21 and not price_above_ema9:
            bbtc_signal = "SELL"
        
        # ── VER Signal (Volume Exhaustion) ──
        vol_window = volumes[max(0, day-19):day+1]
        avg_vol = sum(vol_window) / len(vol_window) if vol_window else 1
        last_vol = volumes[day]
        vol_ratio = last_vol / avg_vol if avg_vol > 0 else 1
        
        rsi = rsi_vals[day]
        
        ver_signal = "HOLD"
        if rsi < 30 and vol_ratio > 1.5:
            ver_signal = "BUY"  # oversold + high volume = exhaustion reversal
        if rsi > 70 and vol_ratio > 1.5:
            ver_signal = "SELL"  # overbought + high volume = exhaustion top
        
        # ── Combined Score ──
        combined_score = 0
        if bbtc_signal == "BUY": combined_score += 2
        if bbtc_signal == "SELL": combined_score -= 2
        if ver_signal == "BUY": combined_score += 2
        if ver_signal == "SELL": combined_score -= 2
        if ema21_above_50: combined_score += 1
        else: combined_score -= 1
        
        combined_signal = "HOLD"
        if combined_score >= 3: combined_signal = "STRONG_BUY"
        elif combined_score >= 1: combined_signal = "BUY"
        elif combined_score <= -3: combined_signal = "STRONG_SELL"
        elif combined_score <= -1: combined_signal = "SELL"
        
        # Only log non-HOLD combined signals (like the real system does)
        if combined_signal != "HOLD":
            # Look ahead for forward returns
            ret_7d = None
            ret_30d = None
            ret_90d = None
            
            if day + 7 < len(closes) and closes[day + 7] > 0:
                ret_7d = ((closes[day + 7] - price) / price) * 100
            if day + 30 < len(closes) and closes[day + 30] > 0:
                ret_30d = ((closes[day + 30] - price) / price) * 100
            if day + 90 < len(closes) and closes[day + 90] > 0:
                ret_90d = ((closes[day + 90] - price) / price) * 100
            
            signals.append({
                "ticker": ticker,
                "date": date_str,
                "day_index": day,
                "signal": combined_signal,
                "score": combined_score,
                "bbtc": bbtc_signal,
                "ver": ver_signal,
                "price": round(price, 2),
                "rsi": round(rsi, 1),
                "vol_ratio": round(vol_ratio, 2),
                "return_7d": round(ret_7d, 2) if ret_7d is not None else None,
                "return_30d": round(ret_30d, 2) if ret_30d is not None else None,
                "return_90d": round(ret_90d, 2) if ret_90d is not None else None,
            })
    
    return signals


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    now = int(time.time())
    two_years_ago = now - (2 * 365 * 24 * 3600)
    
    all_signals = []
    spy_daily = {}  # date -> price for SPY benchmark
    
    print(f"\nFetching 2 years of daily data ({datetime.utcfromtimestamp(two_years_ago).strftime('%Y-%m-%d')} to {datetime.utcfromtimestamp(now).strftime('%Y-%m-%d')})...\n")
    
    # Always fetch SPY first for benchmark
    tickers_to_fetch = ["SPY"] + [t for t in ALL_TICKERS if t != "SPY"]
    
    for i, ticker in enumerate(tickers_to_fetch):
        print(f"[{i+1}/{len(tickers_to_fetch)}] Fetching {ticker}...", end=" ", flush=True)
        
        chart = fetch_chart(ticker, two_years_ago, now)
        if not chart:
            print("FAILED")
            continue
        
        timestamps = chart.get("timestamp", [])
        quotes = chart.get("indicators", {}).get("quote", [{}])[0]
        closes = quotes.get("close", [])
        
        print(f"{len(closes)} bars", end=" ", flush=True)
        
        # Store SPY daily prices for benchmark
        if ticker == "SPY":
            for j, ts in enumerate(timestamps):
                if j < len(closes) and closes[j] is not None:
                    d = datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
                    spy_daily[d] = float(closes[j])
        
        signals = generate_signals_for_ticker(ticker, chart)
        all_signals.extend(signals)
        print(f"→ {len(signals)} signals")
        
        # Rate limit respect
        time.sleep(0.5)
    
    print(f"\n{'='*70}")
    print(f"TOTAL SIGNALS: {len(all_signals)}")
    print(f"{'='*70}\n")
    
    # ── Add SPY benchmark returns ──
    for sig in all_signals:
        sig_date = sig["date"]
        spy_price_at = spy_daily.get(sig_date)
        if spy_price_at:
            # Find SPY price ~7/30/90 days later
            d = datetime.strptime(sig_date, "%Y-%m-%d")
            for horizon, key in [(7, "spy_7d"), (30, "spy_30d"), (90, "spy_90d")]:
                target = d + timedelta(days=horizon)
                # Find closest trading day
                spy_future = None
                for offset in range(0, 5):
                    check = (target + timedelta(days=offset)).strftime("%Y-%m-%d")
                    if check in spy_daily:
                        spy_future = spy_daily[check]
                        break
                if spy_future and spy_price_at > 0:
                    sig[key] = round(((spy_future - spy_price_at) / spy_price_at) * 100, 2)
                else:
                    sig[key] = None
        else:
            sig["spy_7d"] = sig["spy_30d"] = sig["spy_90d"] = None
    
    # ── Analysis ──────────────────────────────────────────────────────────────
    
    results = {}
    
    # --- Overall Win Rates ---
    for horizon in ["7d", "30d", "90d"]:
        ret_key = f"return_{horizon}"
        with_data = [s for s in all_signals if s[ret_key] is not None]
        if not with_data:
            continue
        
        buys = [s for s in with_data if s["signal"] in ("BUY", "STRONG_BUY")]
        sells = [s for s in with_data if s["signal"] in ("SELL", "STRONG_SELL")]
        
        buy_wins = [s for s in buys if s[ret_key] > 0]
        sell_wins = [s for s in sells if s[ret_key] < 0]
        
        total_directional = len(buys) + len(sells)
        total_wins = len(buy_wins) + len(sell_wins)
        
        avg_buy_ret = sum(s[ret_key] for s in buys) / len(buys) if buys else 0
        avg_sell_ret = sum(s[ret_key] for s in sells) / len(sells) if sells else 0
        
        spy_key = f"spy_{horizon}"
        spy_returns = [s[spy_key] for s in buys if s.get(spy_key) is not None]
        avg_spy = sum(spy_returns) / len(spy_returns) if spy_returns else 0
        
        results[f"overall_{horizon}"] = {
            "total_signals": len(with_data),
            "buy_signals": len(buys),
            "sell_signals": len(sells),
            "buy_win_rate": round(len(buy_wins) / len(buys) * 100, 1) if buys else 0,
            "sell_win_rate": round(len(sell_wins) / len(sells) * 100, 1) if sells else 0,
            "combined_win_rate": round(total_wins / total_directional * 100, 1) if total_directional else 0,
            "avg_buy_return": round(avg_buy_ret, 2),
            "avg_sell_return": round(avg_sell_ret, 2),
            "avg_spy_return": round(avg_spy, 2),
            "alpha_vs_spy": round(avg_buy_ret - avg_spy, 2),
        }
    
    # --- Win Rate by Score Bracket ---
    brackets = [
        ("Strong Buy (3+)", 3, 99),
        ("Buy (1-2)", 1, 2),
        ("Sell (-1 to -2)", -2, -1),
        ("Strong Sell (-3+)", -99, -3),
    ]
    
    bracket_results = {}
    for label, min_score, max_score in brackets:
        in_bracket = [s for s in all_signals if s["score"] >= min_score and s["score"] <= max_score and s["return_30d"] is not None]
        if not in_bracket:
            bracket_results[label] = {"count": 0}
            continue
        
        is_buy = min_score > 0
        if is_buy:
            wins = [s for s in in_bracket if s["return_30d"] > 0]
        else:
            wins = [s for s in in_bracket if s["return_30d"] < 0]
        
        avg_ret = sum(s["return_30d"] for s in in_bracket) / len(in_bracket)
        
        bracket_results[label] = {
            "count": len(in_bracket),
            "win_rate": round(len(wins) / len(in_bracket) * 100, 1),
            "avg_return_30d": round(avg_ret, 2),
            "wins": len(wins),
        }
    
    results["by_score_bracket_30d"] = bracket_results
    
    # --- Win Rate by Ticker (30d) ---
    ticker_stats = {}
    for ticker in ALL_TICKERS:
        t_signals = [s for s in all_signals if s["ticker"] == ticker and s["return_30d"] is not None]
        if not t_signals:
            continue
        
        buys = [s for s in t_signals if s["signal"] in ("BUY", "STRONG_BUY")]
        sells = [s for s in t_signals if s["signal"] in ("SELL", "STRONG_SELL")]
        buy_wins = [s for s in buys if s["return_30d"] > 0]
        sell_wins = [s for s in sells if s["return_30d"] < 0]
        
        total = len(buys) + len(sells)
        wins = len(buy_wins) + len(sell_wins)
        
        avg_ret = sum(s["return_30d"] for s in t_signals) / len(t_signals)
        
        ticker_stats[ticker] = {
            "total": total,
            "buys": len(buys),
            "sells": len(sells),
            "win_rate": round(wins / total * 100, 1) if total else 0,
            "avg_return_30d": round(avg_ret, 2),
        }
    
    results["by_ticker_30d"] = ticker_stats
    
    # --- Best & Worst Calls ---
    buys_with_30d = [s for s in all_signals if s["signal"] in ("BUY", "STRONG_BUY") and s["return_30d"] is not None]
    sells_with_30d = [s for s in all_signals if s["signal"] in ("SELL", "STRONG_SELL") and s["return_30d"] is not None]
    
    best_buys = sorted(buys_with_30d, key=lambda s: s["return_30d"], reverse=True)[:10]
    worst_buys = sorted(buys_with_30d, key=lambda s: s["return_30d"])[:10]
    best_sells = sorted(sells_with_30d, key=lambda s: s["return_30d"])[:10]  # Most negative = best sell call
    worst_sells = sorted(sells_with_30d, key=lambda s: s["return_30d"], reverse=True)[:10]  # Went up = wrong
    
    results["best_buy_calls"] = [{"ticker": s["ticker"], "date": s["date"], "score": s["score"], "price": s["price"], "return_30d": s["return_30d"]} for s in best_buys]
    results["worst_buy_calls"] = [{"ticker": s["ticker"], "date": s["date"], "score": s["score"], "price": s["price"], "return_30d": s["return_30d"]} for s in worst_buys]
    results["best_sell_calls"] = [{"ticker": s["ticker"], "date": s["date"], "score": s["score"], "price": s["price"], "return_30d": s["return_30d"]} for s in best_sells]
    results["worst_sell_calls"] = [{"ticker": s["ticker"], "date": s["date"], "score": s["score"], "price": s["price"], "return_30d": s["return_30d"]} for s in worst_sells]
    
    # --- Signal Type Distribution ---
    type_counts = defaultdict(int)
    for s in all_signals:
        type_counts[s["signal"]] += 1
    results["signal_distribution"] = dict(type_counts)
    
    # --- VER-only and BBTC-only accuracy ---
    for source_name, source_field in [("BBTC", "bbtc"), ("VER", "ver")]:
        source_signals = [s for s in all_signals if s[source_field] != "HOLD" and s["return_30d"] is not None]
        if source_signals:
            buys = [s for s in source_signals if s[source_field] == "BUY"]
            sells = [s for s in source_signals if s[source_field] == "SELL"]
            buy_wins = [s for s in buys if s["return_30d"] > 0]
            sell_wins = [s for s in sells if s["return_30d"] < 0]
            total = len(buys) + len(sells)
            wins = len(buy_wins) + len(sell_wins)
            results[f"{source_name}_standalone_30d"] = {
                "total": total,
                "buys": len(buys),
                "sells": len(sells),
                "buy_win_rate": round(len(buy_wins)/len(buys)*100, 1) if buys else 0,
                "sell_win_rate": round(len(sell_wins)/len(sells)*100, 1) if sells else 0,
                "combined_win_rate": round(wins/total*100, 1) if total else 0,
            }
    
    # ── Save Results ──────────────────────────────────────────────────────────
    
    with open("/home/user/workspace/stock-analyzer/backtest_results.json", "w") as f:
        json.dump(results, f, indent=2)
    
    with open("/home/user/workspace/stock-analyzer/backtest_signals.json", "w") as f:
        json.dump(all_signals, f, indent=2)
    
    # ── Print Summary ─────────────────────────────────────────────────────────
    
    print("\n" + "="*70)
    print("STOCK OTTER TRACK RECORD — 2-YEAR BACKTEST RESULTS")
    print("="*70)
    
    print(f"\nTickers tested: {len(ALL_TICKERS)}")
    print(f"Total signals generated: {len(all_signals)}")
    
    print(f"\n{'─'*70}")
    print("SIGNAL DISTRIBUTION")
    print(f"{'─'*70}")
    for sig_type, count in sorted(type_counts.items(), key=lambda x: -x[1]):
        pct = count / len(all_signals) * 100
        print(f"  {sig_type:15s}  {count:5d} ({pct:.1f}%)")
    
    print(f"\n{'─'*70}")
    print("OVERALL WIN RATES")
    print(f"{'─'*70}")
    for horizon in ["7d", "30d", "90d"]:
        key = f"overall_{horizon}"
        if key not in results:
            continue
        r = results[key]
        print(f"\n  {horizon.upper()} Forward Returns:")
        print(f"    Buy signals:  {r['buy_signals']:5d}  |  Win rate: {r['buy_win_rate']:5.1f}%  |  Avg return: {r['avg_buy_return']:+.2f}%")
        print(f"    Sell signals: {r['sell_signals']:5d}  |  Win rate: {r['sell_win_rate']:5.1f}%  |  Avg return: {r['avg_sell_return']:+.2f}%")
        print(f"    Combined:                Win rate: {r['combined_win_rate']:5.1f}%")
        print(f"    SPY avg return:  {r['avg_spy_return']:+.2f}%  |  Alpha: {r['alpha_vs_spy']:+.2f}%")
    
    print(f"\n{'─'*70}")
    print("WIN RATE BY SCORE BRACKET (30-Day)")
    print(f"{'─'*70}")
    for label, data in bracket_results.items():
        if data["count"] == 0:
            print(f"  {label:25s}  No signals")
        else:
            print(f"  {label:25s}  {data['count']:4d} signals  |  Win rate: {data['win_rate']:5.1f}%  |  Avg return: {data['avg_return_30d']:+.2f}%")
    
    print(f"\n{'─'*70}")
    print("INDIVIDUAL SIGNAL ACCURACY (30-Day)")
    print(f"{'─'*70}")
    for source in ["BBTC", "VER"]:
        key = f"{source}_standalone_30d"
        if key in results:
            r = results[key]
            print(f"\n  {source}:")
            print(f"    Buy win rate:  {r['buy_win_rate']:5.1f}%  ({r['buys']} signals)")
            print(f"    Sell win rate: {r['sell_win_rate']:5.1f}%  ({r['sells']} signals)")
            print(f"    Combined:      {r['combined_win_rate']:5.1f}%  ({r['total']} signals)")
    
    print(f"\n{'─'*70}")
    print("TOP 10 BEST BUY CALLS (30-Day)")
    print(f"{'─'*70}")
    print(f"  {'Ticker':8s} {'Date':12s} {'Score':6s} {'Price':>8s} {'Return':>8s}")
    for c in best_buys:
        print(f"  {c['ticker']:8s} {c['date']:12s} {c['score']:+5d}  ${c['price']:>7.2f} {c['return_30d']:+7.2f}%")
    
    print(f"\n{'─'*70}")
    print("TOP 10 WORST BUY CALLS (30-Day)")
    print(f"{'─'*70}")
    print(f"  {'Ticker':8s} {'Date':12s} {'Score':6s} {'Price':>8s} {'Return':>8s}")
    for c in worst_buys:
        print(f"  {c['ticker']:8s} {c['date']:12s} {c['score']:+5d}  ${c['price']:>7.2f} {c['return_30d']:+7.2f}%")
    
    print(f"\n{'─'*70}")
    print("WIN RATE BY TICKER (30-Day, sorted by win rate)")
    print(f"{'─'*70}")
    print(f"  {'Ticker':8s} {'Signals':>8s} {'Win Rate':>10s} {'Avg Ret':>10s}")
    sorted_tickers = sorted(ticker_stats.items(), key=lambda x: -x[1]["win_rate"])
    for ticker, data in sorted_tickers:
        print(f"  {ticker:8s} {data['total']:>8d} {data['win_rate']:>9.1f}% {data['avg_return_30d']:>+9.2f}%")
    
    print(f"\n{'='*70}")
    print("Backtest complete. Full data saved to:")
    print("  backtest_results.json  — Summary statistics")
    print("  backtest_signals.json  — Every individual signal")
    print(f"{'='*70}\n")
    
    return results


if __name__ == "__main__":
    main()
