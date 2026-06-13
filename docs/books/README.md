# Reference library — index

18 trading / quant PDFs that travel with the repo so any session has them. **This file is the
canonical index** (what each book is for + which StockOtter work should consult it). The old pointer
to a per-machine memory file was unreliable — that memory doesn't sync, so the index lives **here, in
the repo**, where it travels with the books.

To pull text from a PDF (poppler isn't installed; `pypdf` is): see "How to read them" at the bottom.

## What each book is for

| # | Title (author) | Pages | Consult it for |
|---|---|---|---|
| 1 | **Quantitative Trading** — Ernest P. Chan | 204 | **Validation & backtesting rigor**: avoiding overfitting, out-of-sample testing, Sharpe/drawdown, transaction costs. → Workstream A (the validation harness) + B. |
| 2 | **Encyclopedia of Chart Patterns** — Bulkowski | 1,035 | **The pattern detectors**: High Tight Flag, Rounding Bottom, Pipe Bottom, throwbacks, measure rules. `htf.ts` already cites it. → Workstream B (re-grading the pattern strategies). |
| 3 | **How to Make Money in Stocks** — O'Neil | 556 | CAN SLIM, base breakouts, relative strength. → Scanner / HTF / momentum signals. |
| 4 | **The Day Trader's Bible** — Wyckoff | 116 | Accumulation/distribution, the Wyckoff method. → `wyckoff-spring` strategy, institutional-flow read. |
| 5 | **Trading Volatility** — Colin Bennett | 317 | Options, implied vol, gamma, skew. → MM Exposure page + any options tooling (IV rank / expected move). |
| 6 | **Liquidity, Markets & Trading in Action** | 111 | Market microstructure, slippage, fills. → the bot (realistic fills/costs) + the $5–75 liquidity rationale. |
| 7 | **How to Trade Price Action** — Galen Woods | 143 | Price-action entries/exits. → chart strategies, entry timing. |
| 8 | **The Power of Divergence Trading** — Carli | 83 | RSI/MACD divergence. → Signal Pulse, divergence checks. |
| 9 | **A Complete Guide to Day Trading** — Heitkoetter | 273 | General intraday method. → education / setups. |
| 10 | **A Practical Guide to Swing Trading** — Larry Swing | 74 | Swing setups/holds. → HTF/BBTC are swing-horizon. |
| 11 | **Short Swing Trading** — Graeme-Smith | 121 | Short-hold swing tactics. → swing strategies. |
| 12 | **Day-Trading Guide For Beginners** — Warrior | 68 | Beginner framing. → Help/FAQ, onboarding copy. |
| 13 | **The First Trading Manual** — Trader Tom | 183 | Foundations, plan-building. → education. |
| 14 | **The Complete Guide to Trading** — CFI | 116 | Corporate finance / fundamentals. → fundamental scoring, PEGY, valuation. |
| 15 | **10 Most Profitable Trading Strategies** — Porwal | 61 | Strategy ideas to test. → Workstream B candidates. |
| 16 | **9 Advanced & Profitable Trading Strategies** — Sadowski | 42 | Strategy ideas to test. → Workstream B candidates. |
| 17 | **Introduction to Trading System Development** — Cardoza | 42 | Systematic build/validation process, drawdown control. → Workstream A (system rigor). |
| 18 | **Mastering Trading Psychology** — Aziz & Baehr | 408 | **Capital preservation, discipline, risk-of-ruin, cutting losers.** → the "don't lose money" philosophy, behavior tags, the portfolio-improver. |

**Total:** ~3,953 pages across 18 books, ~50MB on disk.

## By current workstream (quick cross-reference)
- **A — Validation rigor / capital-preservation bar:** #1 Chan, #17 Cardoza, #18 Aziz (risk), #6 Liquidity (costs).
- **B — Find the edge (strategies):** #2 Bulkowski, #3 O'Neil, #4 Wyckoff, #7 Woods, #8 Carli, #15 Porwal, #16 Sadowski.
- **C — Provable bot (fills/risk):** #6 Liquidity, #1 Chan, #18 Aziz.
- **D — Improve your portfolio (risk/psychology):** #18 Aziz, #1 Chan (position sizing), #14 CFI.
- **Options surfaces:** #5 Bennett.

## How to read them
poppler/`pdftoppm` isn't installed; `pypdf` is:

```bash
python -c "
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from pypdf import PdfReader
r = PdfReader(r'docs/books/Quantitative Trading. Ernest P Chan.pdf')
print('Pages:', len(r.pages))
for i in range(5):
    print('--- page', i+1, '---'); print(r.pages[i].extract_text() or '')
"
```

## Privacy
These are commercial books. **This repo must stay private** — do not flip it public without removing
`docs/books/` first.
