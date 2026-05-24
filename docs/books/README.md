# Reference library

18 trading / quant PDFs that travel with the repo so any session has
them. The detailed index — what's in each book and which Stockotter
surface should consult it — lives in
`~/.claude/projects/C--Stockotter/memory/trading_books.md`. This file
is the in-repo summary so anyone browsing the tree sees what's here.

## Books

| # | Title | Author | Pages |
|---|---|---|---|
| 1 | Quantitative Trading | Ernest P. Chan | 204 |
| 2 | Encyclopedia of Chart Patterns | Thomas N. Bulkowski | 1,035 |
| 3 | How to Make Money in Stocks | William J. O'Neil | 556 |
| 4 | The Day Trader's Bible | Richard D. Wyckoff | 116 |
| 5 | Trading Volatility | Colin Bennett | 317 |
| 6 | Liquidity, Markets and Trading in Action | Ozenbas, Pagano, Schwartz, Weber | 111 |
| 7 | How to Trade Price Action | Galen Woods | 143 |
| 8 | The Power of Divergence Trading | David Carli | 83 |
| 9 | A Complete Guide to Day Trading | Markus Heitkoetter | 273 |
| 10 | A Practical Guide to Swing Trading | Larry Swing | 74 |
| 11 | Short Swing Trading | David Graeme-Smith | 121 |
| 12 | Day-Trading Guide For Beginners | Warrior Trading | 68 |
| 13 | The First Trading Manual | Trader Tom | 183 |
| 14 | The Complete Guide to Trading | Corporate Finance Institute | 116 |
| 15 | 10 Most Profitable Trading Strategies | Nikhil Porwal | 61 |
| 16 | 9 Advanced and Profitable Trading Strategies | Roman Sadowski | 42 |
| 17 | Introduction to Trading System Development | David Cardoza | 42 |
| 18 | Mastering Trading Psychology | Andrew Aziz & Mike Baehr | 408 |

**Total:** ~3,953 pages across 18 books, ~50MB on disk.

## How to read them

`pdftoppm`/poppler is not installed on the dev machine. Use Python +
`pypdf` (already installed):

```bash
python -c "
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
from pypdf import PdfReader
r = PdfReader(r'docs/books/Quantitative Trading. Ernest P Chan.pdf')
print('Pages:', len(r.pages))
for i in range(5):
    print('--- page', i+1, '---')
    print(r.pages[i].extract_text() or '')
"
```

## Privacy

These are commercial books. **This repo must remain private** — do not
flip it public without removing `docs/books/` first.
