# Stock Symbol Analyzer

A comprehensive investment analysis dashboard that evaluates any stock ticker with a color-coded scoring system. Enter a ticker symbol, get an instant go/watch/no-go verdict backed by real-time financial data.

## Features

- **Verdict System** — YES (green) / WATCH (yellow) / NO (red) based on weighted scoring
- **8-Category Scoring Model** — Income Strength, Income Quality, Business Quality, Balance Sheet Quality, Performance Quality, Valuation Sanity, Liquidity & Scale, Thesis Durability
- **Quick Trade Analysis** — Sentiment, analyst consensus, price targets
- **Color-Coded Snapshot** — Every metric rated Good/Neutral/Caution
- **1-Year Price Chart** — Interactive area chart with Recharts
- **Red Flags Checklist** — 10 automated risk checks
- **One-Pass Decision Shortcut** — 7 quick yes/no questions
- **Dark Finance Theme** — Professional dashboard design

## Tech Stack

- **Frontend:** React, Tailwind CSS, shadcn/ui, Recharts
- **Backend:** Express.js, yahoo-finance2
- **Build:** Vite, TypeScript, esbuild

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:5000
```

## Production Build

```bash
npm run build
NODE_ENV=production node dist/index.cjs
```

## Deploy to Railway (Recommended)

1. Push this repo to GitHub (already done)
2. Go to [railway.app](https://railway.app)
3. Click **New Project** → **Deploy from GitHub Repo**
4. Select `ccutshaw66/stock-analyzer`
5. Railway auto-detects Node.js and runs `npm run build` + `npm start`
6. Add environment variable: `PORT=5000`
7. Deploy — you'll get a public URL in ~2 minutes

## Deploy to Render

1. Go to [render.com](https://render.com)
2. New → **Web Service** → Connect your GitHub repo
3. Settings:
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `NODE_ENV=production node dist/index.cjs`
   - **Environment:** Node
4. Add environment variable: `PORT=5000`
5. Deploy

## Deploy to Fly.io

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Launch (creates Dockerfile automatically)
fly launch

# Deploy
fly deploy
```

## Scoring Model

| Category | Weight | What It Measures |
|---|---|---|
| Income Strength | 15% | Dividend yield level |
| Income Quality | 15% | Payout ratio sustainability |
| Business Quality | 15% | Revenue growth + gross margins |
| Balance Sheet Quality | 15% | Debt-to-equity + current ratio |
| Performance Quality | 15% | 1Y and 3Y total returns |
| Valuation Sanity | 10% | P/E ratio + forward P/E |
| Liquidity & Scale | 5% | Market cap + average volume |
| Thesis Durability | 10% | Beta + growth + leverage |

### Verdict Rules

| Score | Verdict | Meaning |
|---|---|---|
| 8.5 – 10.0 | YES ✅ | Strong buy candidate |
| 7.0 – 8.49 | YES ✅ | Buy with minor caveats |
| 5.5 – 6.99 | WATCH 🟡 | Watchlist only |
| Below 5.5 | NO 🔴 | Avoid |

## License

MIT
