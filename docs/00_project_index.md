# Polymarket Paper Trader — Project Index

> **Project Path**: `/Users/dickensli/.gemini/jetski/scratch/polymarket-paper-trader/`
> **Created**: 2026-06-20
> **Status**: MVP Complete ✅

---

## 📁 Project Structure

```
polymarket-paper-trader/
├── docs/                           # All documentation
│   ├── 00_project_index.md         # ← YOU ARE HERE
│   ├── 01_feasibility_analysis.md  # Business viability & market research
│   ├── 02_api_prototype_report.md  # API validation results & findings
│   └── 03_technical_architecture.md # Full system architecture (2620 lines)
├── prototype/                      # Step 1: API validation scripts
│   ├── api_validation.mjs          # Node.js script testing 12 API endpoints
│   └── api_validation_results.json # Raw results data
├── src/                            # Step 3: MVP Next.js Application
│   ├── src/
│   │   ├── app/
│   │   │   ├── globals.css         # Design system (dark mode, glassmorphism)
│   │   │   ├── layout.tsx          # Root layout with Inter font
│   │   │   ├── ClientShell.tsx     # Client-side app shell (sidebar + topbar)
│   │   │   ├── page.tsx            # Markets listing page (main)
│   │   │   ├── market/[id]/page.tsx # Market detail page
│   │   │   ├── portfolio/page.tsx  # Portfolio management page
│   │   │   └── api/
│   │   │       ├── markets/route.ts        # GET /api/markets
│   │   │       ├── markets/[id]/route.ts   # GET /api/markets/:id
│   │   │       ├── markets/[id]/price/route.ts # GET price polling
│   │   │       ├── trade/route.ts          # POST trade / GET history
│   │   │       └── portfolio/route.ts      # GET portfolio / DELETE reset
│   │   ├── components/             # 11 UI components
│   │   │   ├── Sidebar.tsx         # Collapsible nav sidebar
│   │   │   ├── TopBar.tsx          # Top bar with portfolio summary
│   │   │   ├── MarketCard.tsx      # Premium market card
│   │   │   ├── TradeModal.tsx      # Trade execution modal
│   │   │   ├── PriceBar.tsx        # YES/NO probability bar
│   │   │   ├── PositionRow.tsx     # Portfolio position row
│   │   │   ├── CategoryFilter.tsx  # Category filter pills
│   │   │   ├── SearchBar.tsx       # Search input
│   │   │   ├── StatsCard.tsx       # Stats display card
│   │   │   ├── LoadingSpinner.tsx  # Loading animation
│   │   │   └── EmptyState.tsx      # Empty state display
│   │   ├── hooks/                  # 4 data hooks
│   │   │   ├── useMarkets.ts       # Markets list + filtering
│   │   │   ├── useMarket.ts        # Single market detail
│   │   │   ├── usePortfolio.ts     # Portfolio management
│   │   │   └── useTrade.ts         # Trade execution
│   │   └── lib/                    # Core business logic
│   │       ├── types.ts            # TypeScript type definitions
│   │       ├── polymarket.ts       # Polymarket API client
│   │       └── trading-engine.ts   # Paper trading engine
│   ├── next.config.ts
│   ├── package.json
│   └── tsconfig.json
└── scripts/                        # Utility scripts (empty for now)
```

---

## 📊 Documentation Index

### 1. Feasibility Analysis (`01_feasibility_analysis.md`)
- Polymarket does NOT support paper trading (confirmed)
- API ecosystem analysis (Gamma API + CLOB API = fully usable)
- Competitive landscape (no direct competitors)
- Target users: US users restricted from real trading
- Business model: Freemium + Builder Program fees
- SWOT analysis & risk assessment

### 2. API Prototype Report (`02_api_prototype_report.md`)
- **10/12 endpoints passed** (83% success rate)
- Gamma API: 4/4 ✅ | CLOB API: 6/6 ✅ | Data API: 2/2 ❌ (deprecated)
- Average response time: 114ms
- Key data quirks documented (JSON-in-JSON, string prices, active≠open)
- Recommended polling strategy and API usage patterns

### 3. Technical Architecture (`03_technical_architecture.md`)
- 2,620 lines of detailed architecture documentation
- 7 Mermaid diagrams (system, ER, sequence flows)
- Complete Drizzle ORM database schema (7 tables)
- Full REST API spec (15 endpoints)
- Trading engine design with P&L formulas
- Background worker implementations
- Security, scaling, and cost estimates ($35-45/mo MVP)

---

## 🚀 Quick Start

```bash
# Navigate to project
cd /Users/dickensli/.gemini/jetski/scratch/polymarket-paper-trader/src

# Install dependencies (already done)
npm install

# Start development server
npm run dev

# Open in browser
open http://localhost:3000
```

---

## 🔑 Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Next.js 16 (App Router) | SSR + API routes in one project |
| Styling | Tailwind CSS | Dark mode, glassmorphism, rapid iteration |
| Database (MVP) | In-memory + server state | Fast MVP, no external dependencies |
| Database (Prod) | PostgreSQL + Drizzle ORM | Designed in architecture doc |
| API Data Source | Gamma API + CLOB API | Free, no auth needed, rich data |
| Trading Execution | Midpoint price | Simple, fair simulation |
| Auth (MVP) | None (single user) | MVP simplicity |
| Auth (Prod) | NextAuth.js | Designed in architecture doc |

---

## 📈 API Endpoints Used

| Polymarket API | Endpoint | Purpose |
|----------------|----------|---------|
| Gamma | `GET /markets?closed=false&order=volume24hr` | List active markets |
| Gamma | `GET /markets/{id}` | Market details |
| Gamma | `GET /events` | Event data |
| CLOB | `GET /midpoint?token_id=X` | Current price |
| CLOB | `GET /spread?token_id=X` | Bid-ask spread |
| CLOB | `GET /book?token_id=X` | Full order book |
| CLOB | `GET /last-trade-price?token_id=X` | Last trade |
| CLOB | `GET /prices-history?market=X` | Price history |

---

## 🔮 Next Steps (Post-MVP)

1. **Auth** — Add NextAuth.js for per-user portfolios
2. **Database** — Migrate from in-memory to PostgreSQL
3. **WebSocket** — Real-time price updates via Polymarket WebSocket
4. **Leaderboard** — Rankings by ROI, win rate
5. **Builder Program** — Integrate Polymarket Builder for real trading
6. **Mobile** — React Native app or PWA
7. **AI Predictions** — ML-powered prediction suggestions
