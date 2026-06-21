# 🔮 PolyTrader: The "Two Sigma" of Polymarket

Welcome to **PolyTrader** — the proprietary high-fidelity simulation engine and quantitative strategy validation platform. 

## 🌌 Our Grand Vision

Our ultimate goal is to build the premier **High-Frequency Quantitative Fund (The "Two Sigma") on Polymarket**. 

Prediction markets represent the next frontier of efficient capital allocation and information discovery. However, testing complex quantitative strategies directly on the mainnet carries immense capital risk. **PolyTrader** is designed to bridge this gap.

Through this platform and its accompanying APIs, our quant researchers and trading bots can:
1. **Backtest & Forward-test** algorithmic trading strategies in a high-fidelity sandbox.
2. **Simulate Real-World Friction** including dynamic order book depth, automated slippage calculation, and real-time market resolution.
3. **Analyze Alpha** via immutable transaction ledgers and portfolio mark-to-market leaderboards.

Once our models demonstrate consistent, mathematically sound profitability in PolyTrader, they will be seamlessly **migrated to the Polymarket mainnet to extract live alpha and generate profit.**

---

## 🛠 Technical Architecture

This system is engineered for low latency, high concurrency, and extreme data integrity to mimic a real exchange.

- **Frontend & API Gateway:** Next.js 16/15 (React 19) hosted on Vercel.
- **Edge Compute:** Vercel Edge Middleware handling JWT signature validation and geographic routing.
- **Caching & Rate Limiting:** Upstash Redis clusters at the Edge to enforce API rate limits and cache live Polymarket order book states.
- **Database Layer:** Supabase (PostgreSQL) managed via Drizzle ORM, storing users, portfolios, and an immutable ledger of all test trades.
- **Background Orchestration:** A standalone Node.js cron worker handling live price polling, market resolution settlement, and portfolio snapshots.
- **CDN Optimization:** Native Vercel Edge caching and WebP optimization for all market assets.

---

## 🚀 Getting Started (Local Development)

To run the simulation engine locally and begin connecting your trading algorithms:

### 1. Clone the repository
```bash
git clone https://github.com/Dickensli/polymarket-paper-trader.git
cd polymarket-paper-trader/src
```

### 2. Install dependencies
```bash
npm install
```

### 3. Environment Configuration
Copy the sample environment file and fill in your Supabase, Redis, and NextAuth credentials:
```bash
cp .env.example .env.local
```

### 4. Database Setup
Push the Drizzle ORM schema to your Supabase instance:
```bash
npx drizzle-kit push
```

### 5. Run the Engine
Start the Next.js frontend and API routes:
```bash
npm run dev
```
In a separate terminal, start the background settlement worker:
```bash
npm run worker
```

---

## 📈 Strategy API Integration

If you are a quant dev writing bots, you can interface with PolyTrader exactly as you would with Polymarket:

- **`POST /api/trade/buy`**: Execute a paper trade (includes slippage).
- **`POST /api/trade/sell`**: Liquidate positions.
- **`GET /api/markets`**: Fetch live cached odds.

*Remember: Every strategy tested here today is the alpha of tomorrow.*
