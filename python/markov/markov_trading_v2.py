"""
Markov Method v2 — HMM regimes + vol targeting + transaction costs
-------------------------------------------------------------------
Improvements over v1:
  1. Hidden Markov Model (Gaussian emissions) replaces discrete return buckets.
     States are latent regimes inferred from (return, realized_vol) features.
  2. Vol-targeted position sizing instead of binary +1/-1.
  3. Transaction costs + minimum hold to suppress flip-flopping.
  4. Clean train/test split for honest OOS performance.

Usage:
    python markov_trading_v2.py --ticker SPY --start 2010-01-01 --states 3

Dependencies:
    pip install numpy pandas yfinance matplotlib hmmlearn scikit-learn
"""

from __future__ import annotations
import argparse
import warnings
import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM
from sklearn.preprocessing import StandardScaler

# yfinance + matplotlib are imported lazily inside main() / plot() so the
# FastAPI service (which uses FMP and never plots) doesn't need them.

warnings.filterwarnings("ignore")


# ---------- Feature engineering ----------

def build_features(close: pd.Series, vol_window: int = 20) -> pd.DataFrame:
    """Features the HMM will see: daily return + realized vol + momentum."""
    ret = close.pct_change()
    rv = ret.rolling(vol_window).std()
    mom = close.pct_change(vol_window)
    df = pd.concat([ret, rv, mom], axis=1)
    df.columns = ["ret", "vol", "mom"]
    return df.dropna()


# ---------- HMM regime model ----------

def fit_hmm(features: np.ndarray, n_states: int, seed: int = 42) -> tuple[GaussianHMM, StandardScaler]:
    """Fit Gaussian HMM. Scale features for stable EM convergence."""
    scaler = StandardScaler().fit(features)
    X = scaler.transform(features)
    model = GaussianHMM(
        n_components=n_states,
        covariance_type="full",
        n_iter=200,
        random_state=seed,
        tol=1e-4,
    )
    model.fit(X)
    return model, scaler


def regime_stats(model: GaussianHMM, scaler: StandardScaler, ret_idx: int = 0) -> pd.DataFrame:
    """Per-state mean return and vol (in original units)."""
    means = scaler.inverse_transform(model.means_)
    stats = []
    for i in range(model.n_components):
        # Diagonal of covariance in scaled space; rescale variance for ret feature
        var_scaled = model.covars_[i][ret_idx, ret_idx]
        var_orig = var_scaled * (scaler.scale_[ret_idx] ** 2)
        stats.append({
            "state": i,
            "mean_ret": means[i, ret_idx],
            "vol": np.sqrt(var_orig),
        })
    return pd.DataFrame(stats)


# ---------- Strategy ----------

def vol_target_size(expected_ret: float, expected_vol: float,
                    target_vol: float = 0.10, max_lev: float = 2.0) -> float:
    """
    Kelly-lite sizing: position = sign(E[r]) * (target_vol / predicted_vol),
    capped at max_lev. Annualized vol target (default 10%).
    """
    if expected_vol <= 0 or np.isnan(expected_vol):
        return 0.0
    annual_vol = expected_vol * np.sqrt(252)
    size = np.sign(expected_ret) * (target_vol / annual_vol)
    return float(np.clip(size, -max_lev, max_lev))


def backtest(
    close: pd.Series,
    n_states: int = 3,
    train_frac: float = 0.6,
    target_vol: float = 0.10,
    cost_bps: float = 3.0,
    min_hold_days: int = 2,
    allow_short: bool = True,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    feats = build_features(close)
    split = int(len(feats) * train_frac)
    train, test = feats.iloc[:split], feats.iloc[split:]

    # Fit once on training data (could also do walk-forward refits)
    model, scaler = fit_hmm(train.values, n_states)
    stats = regime_stats(model, scaler)
    print("\n--- Regime stats (train) ---")
    print(stats.to_string(index=False))

    # Predict states across full series for continuous backtest
    X_test = scaler.transform(test.values)
    test_states = model.predict(X_test)

    # Expected next-period (state, return) using transition matrix
    P = model.transmat_
    state_means = stats["mean_ret"].values
    state_vols = stats["vol"].values

    df = test.copy()
    df["state"] = test_states
    df["exp_ret"] = [P[s] @ state_means for s in test_states]
    df["exp_vol"] = [np.sqrt(P[s] @ (state_vols ** 2)) for s in test_states]

    # Raw target positions
    raw_pos = [
        vol_target_size(er, ev, target_vol) if (allow_short or er > 0) else max(vol_target_size(er, ev, target_vol), 0)
        for er, ev in zip(df["exp_ret"], df["exp_vol"])
    ]
    df["raw_pos"] = raw_pos

    # Apply min-hold filter (don't change position more often than every N days)
    pos = np.zeros(len(df))
    last_change = -min_hold_days
    current = 0.0
    for i, r in enumerate(raw_pos):
        if i - last_change >= min_hold_days and np.sign(r) != np.sign(current):
            current = r
            last_change = i
        elif i - last_change >= min_hold_days:
            current = r  # same direction, allow resize
        pos[i] = current
    df["position"] = pos
    df["position"] = df["position"].shift(1).fillna(0)  # trade next bar

    # Returns with costs
    turnover = df["position"].diff().abs().fillna(0)
    cost = turnover * (cost_bps / 10_000)
    df["gross_ret"] = df["position"] * df["ret"]
    df["net_ret"] = df["gross_ret"] - cost
    df["bh_ret"] = df["ret"]

    return df, stats


# ---------- Performance ----------

def perf(rets: pd.Series, freq: int = 252) -> dict:
    rets = rets.dropna()
    if len(rets) == 0 or rets.std() == 0:
        return {"CAGR": 0, "Sharpe": 0, "Sortino": 0, "MaxDD": 0, "HitRate": 0, "Turnover": 0}
    cum = (1 + rets).cumprod()
    cagr = cum.iloc[-1] ** (freq / len(rets)) - 1
    sharpe = np.sqrt(freq) * rets.mean() / rets.std()
    downside = rets[rets < 0].std()
    sortino = np.sqrt(freq) * rets.mean() / downside if downside > 0 else 0
    dd = (cum / cum.cummax() - 1).min()
    hit = (rets[rets != 0] > 0).mean()
    return {"CAGR": cagr, "Sharpe": sharpe, "Sortino": sortino, "MaxDD": dd, "HitRate": hit}


def plot(df: pd.DataFrame, ticker: str) -> None:
    import matplotlib.pyplot as plt  # lazy: not needed by the FastAPI service

    eq_strat = (1 + df["net_ret"].fillna(0)).cumprod()
    eq_gross = (1 + df["gross_ret"].fillna(0)).cumprod()
    eq_bh = (1 + df["bh_ret"].fillna(0)).cumprod()

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 8), sharex=True,
                                    gridspec_kw={"height_ratios": [3, 1]})
    ax1.plot(eq_bh, label=f"{ticker} Buy & Hold", linewidth=1.2, alpha=0.8)
    ax1.plot(eq_gross, label="HMM Strategy (gross)", linewidth=1.2, alpha=0.7, linestyle="--")
    ax1.plot(eq_strat, label="HMM Strategy (net of costs)", linewidth=1.5)
    ax1.set_title(f"HMM Regime Strategy — {ticker} (OOS)")
    ax1.set_ylabel("Equity")
    ax1.legend(); ax1.grid(alpha=0.3)

    ax2.plot(df["position"], linewidth=0.8, color="steelblue")
    ax2.axhline(0, color="black", linewidth=0.5)
    ax2.set_ylabel("Position")
    ax2.set_xlabel("Date")
    ax2.grid(alpha=0.3)

    plt.tight_layout()
    plt.savefig(f"markov_v2_{ticker}.png", dpi=120)
    print(f"\nSaved chart: markov_v2_{ticker}.png")


# ---------- Entry point ----------

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ticker", default="SPY")
    p.add_argument("--start", default="2010-01-01")
    p.add_argument("--end", default=None)
    p.add_argument("--states", type=int, default=3)
    p.add_argument("--train-frac", type=float, default=0.6)
    p.add_argument("--target-vol", type=float, default=0.10)
    p.add_argument("--cost-bps", type=float, default=3.0)
    p.add_argument("--min-hold", type=int, default=2)
    p.add_argument("--long-only", action="store_true")
    args = p.parse_args()

    # Lazy: only the script needs yfinance — the FastAPI service uses FMP.
    import yfinance as yf

    print(f"Downloading {args.ticker}...")
    data = yf.download(args.ticker, start=args.start, end=args.end,
                       auto_adjust=True, progress=False)
    if data.empty:
        raise SystemExit("No data returned.")

    close = data["Close"].squeeze()

    df, stats = backtest(
        close,
        n_states=args.states,
        train_frac=args.train_frac,
        target_vol=args.target_vol,
        cost_bps=args.cost_bps,
        min_hold_days=args.min_hold,
        allow_short=not args.long_only,
    )

    print("\n--- OOS Performance ---")
    print(f"{'Metric':<10}{'Net':>12}{'Gross':>12}{'Buy&Hold':>12}")
    n, g, b = perf(df["net_ret"]), perf(df["gross_ret"]), perf(df["bh_ret"])
    for k in n:
        print(f"{k:<10}{n[k]:>12.3f}{g[k]:>12.3f}{b[k]:>12.3f}")

    avg_turnover = df["position"].diff().abs().mean() * 252
    print(f"\nAnnualized turnover: {avg_turnover:.1f}x")

    plot(df, args.ticker)


if __name__ == "__main__":
    main()
