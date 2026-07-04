# Multi-Agent MCP Trading Architecture

Last updated: 2026-07-04

This document captures the target design for a mature Codex/Gemini-style multi-agent trading system spanning Polymarket International, Kalshi, and Polymarket US. It is intended to be the durable reference for future MCP, server, Supabase, and strategy-agent work.

## Current Repos

- MCP/API connector repo: `/Users/dickensli/Documents/traders`
  - Current role: local MCP server that directly reads official Kalshi and Polymarket US APIs.
  - Recently added: Polymarket US public/authenticated retail API client and MCP tools.
- Web/server repo: `/Users/dickensli/Documents/polymarket-paper-trader`
  - Current role: Next.js app/server, Supabase/Postgres via Drizzle, paper trading engine, market cache, portfolio UI, leaderboard, cron jobs, and older `polytraders-web` MCP wrapper.

## Current Behavior

The `traders` MCP currently connects directly to official APIs:

```text
Codex or MCP client
  -> local MCP server: /Users/dickensli/Documents/traders/dist/index.js
  -> official venue APIs
     - Kalshi Trade API
     - Polymarket US public/authenticated retail API
```

It does not currently write to Supabase and does not route through `polymarkettraders.com`.

The `polymarket-paper-trader` server currently writes paper trading state to Supabase/Postgres:

```text
polytraders-web MCP or web UI
  -> https://www.polymarkettraders.com/api
  -> Next.js handlers
  -> Supabase/Postgres through Drizzle
```

Existing persistent objects include users, portfolios, paper trades, positions, ledger entries, event/market cache, leaderboard snapshots, and paper limit orders.

## Target Product Goal

Build a unified strategy-agent trading platform where scheduled Codex-compatible agents can:

1. Register their strategy identity before doing any trading work.
2. Declare whether they are a `paper` or `real` trading agent.
3. Declare their target platform as `polymarket`, `kalshi`, or `polymarket_us`.
4. Read official live market data through MCP.
5. Execute paper trades or real trades through the same high-level MCP workflow.
6. Persist trade results, portfolio snapshots, reflections, reports, and reconciliation logs to Supabase.
7. Restore context on the next run from prior reports and prior portfolio state.

The mature flow should make the client-side strategy loop look the same for paper and real agents. The server decides whether a write is simulated or calls a real trading API.

## Platform Support Matrix

| Platform | Market Data | Paper Trading | Real Trading | Notes |
| --- | --- | --- | --- | --- |
| `polymarket` | Official Gamma/CLOB public APIs | Required | Not initially supported | International Polymarket real trading requires wallet/EIP-712/CLOB auth and is intentionally out of first real-trading scope. |
| `kalshi` | Official Kalshi API | Required | Required | Real trading already exists in the `traders` MCP, but server-side audit/persistence flow is missing. |
| `polymarket_us` | Official Polymarket US public/authenticated APIs | Required | Required | Retail API support exists in `traders`; paper simulator and server persistence are missing. |

## Agent Lifecycle

Every strategy run should follow the same lifecycle:

1. Bootstrap
   - Call `register_strategy`.
   - Call `get_strategy_context`.
   - Read current market data.
   - Read previous report(s), positions, and portfolio snapshots.
2. Decide
   - Apply strategy-specific research, risk limits, sizing, and exit rules.
   - For real trading, use official data as source of truth.
3. Execute
   - Paper agent: submit simulated order intent to server.
   - Real agent: submit real order intent to server; server calls official API.
4. Persist
   - Save order/trade result.
   - Save portfolio snapshot.
   - Save report/reflection.
5. Reconcile
   - For real agents, compare official portfolio/orders/fills against local Supabase state.
   - Log material differences.
6. Return
   - MCP response includes updated portfolio, report metadata, warnings, and reconciliation status.

## Server-Side Binding & State Guardrails

To prevent AI hallucination leading to catastrophic trading mistakes (e.g., executing a real trade instead of a paper trade, or placing a trade on the wrong market), the system enforces **Server-Side Binding** of strategy configurations.

1. **Context Registration & Lock-in**:
   - The strategy's operating parameters (`agent_mode`, `platform`, risk settings) are defined and locked at the server level during `register_strategy` or via the host script database.
   - Subsequent execution tools (e.g., `buy`, `sell`, `portfolio`, `get_strategy_context`) **MUST NOT** ask the AI to specify `agent_mode` or `platform` dynamically on every trade. The server resolves these parameters internally by looking up the `strategy_name` (or authenticated header contexts).

2. **Stateless Initialization & Synchronization**:
   - To prevent the polling AI from calling setup/registration tools on every execution (since it is stateless), the system implements three guardrails:
     - **MCP Resources (Recommended)**: The server exposes a read-only resource `strategy_state://{strategy_name}`. The system prompt instructs the AI to read this state first; if `is_setup` is true, the AI skips initialization.
     - **API Idempotency (Defense in Depth)**: If `register_strategy` is called repeatedly, the server handles it gracefully, returning the existing state and a success status without altering configuration or throwing errors.
     - **Host Script Prompt Modification**: The cron runner script checks database state prior to invoking the LLM and dynamically omits setup instructions if initialization has already occurred.

## Per-Platform MCP Servers & Skills

Each platform has its own dedicated MCP server and a corresponding Jetski skill. This avoids tool-name collisions (e.g. `get_order_book` vs `get_orderbook` vs `get_market_book`) and ensures agents never reference tools that don't exist on their platform.

| MCP Server | Platform | Skill | Tools |
| --- | --- | --- | --- |
| `polytraders-web` | Polymarket (International) | `polymarket-trading` | 35 |
| `kalshi-mcp` (kalshi-paper-trader-mcp) | Kalshi | `kalshi-trading` | 20 |
| `polymarket-us-mcp` (polymarket-us-paper-trader-mcp) | Polymarket US | `polymarket-us-trading` | 18 |

Skills are stored in `~/.gemini/config/skills/{skill-name}/SKILL.md` and provide:

- Exact tool inventory for the platform (no cross-platform tool references).
- Data trust boundaries.
- Risk management rules.
- Trading philosophy.
- Session lifecycle (server-side stateless wakeup).
- Critical safety rules (never call `init_account` unless instructed, etc.).

### Shared Core Tools (all 3 platforms)

| Tool | Purpose |
| --- | --- |
| `register_strategy` | Register strategy identity. Idempotent. |
| `get_strategy_context` | Full bootstrap context. Call first on every run. |
| `init_account` | ⚠️ DESTRUCTIVE — resets all state. |
| `get_balance` | Quick portfolio summary. |
| `buy` / `sell` | Execute trades. Server routes to correct venue/mode. |
| `portfolio` | Full portfolio with positions. |
| `history` | Recent trade history. |
| `stats` | Performance statistics. |
| `search_markets` | Full-text market search. |
| `get_market` | Detailed market data. |
| `get_event` | Event-level data. |
| `backtest` | Backtest simulation. |
| `save_report` | Persist session report (cross-session memory). |
| `list_reports` | List prior reports. |
| `read_report` | Read a specific report. |

### Platform-Specific Tools

#### Polymarket Only (`polytraders-web`)

| Tool | Purpose |
| --- | --- |
| `reset_account` | ⚠️ DESTRUCTIVE — alias for init_account. |
| `list_markets` | Paginated market listing. |
| `get_order_book` | Live order book. |
| `get_tags` / `get_markets_by_tag` | Tag-based market filtering. |
| `watch_prices` | Live midpoint prices. |
| `place_limit_order` / `list_orders` / `cancel_order` / `cancel_all_orders` / `check_orders` | Limit order management. |
| `resolve` / `resolve_all` | Settle closed market positions. |
| `stats_card` / `pk_card` / `leaderboard_card` / `leaderboard_entry` / `pk_battle` / `share_content` | Social/sharing. |

#### Kalshi Only (`kalshi-mcp`)

| Tool | Purpose |
| --- | --- |
| `get_orderbook` | Live order book (note: no underscore). |
| `get_candlesticks` | Historical price candlestick data. |
| `get_public_trades` | Public trade history. |
| `search_events` | Event search by keyword. |

#### Polymarket US Only (`polymarket-us-mcp`)

| Tool | Purpose |
| --- | --- |
| `get_market_book` | Live order book (note: different name). |
| `get_events` | List/search events (plural). |

### Required Fields for All Execution Tools

All state-touching tools require the following identity and isolation parameters:

- `agent_user_id`: The human or AI agent's master account/identity name (e.g. `dickens_smith`). Can be passed as an optional tool argument (defaults to the workspace environment's `AGENT_USER_ID` configuration).
- `strategy_name` (previously `account`): The specific strategy logic to execute (e.g. `conservative`). Passed on all subsequent calls to isolate portfolios (the server maps this to the `x-agent-account` header context).

Execution tools (`buy`, `sell`, `portfolio`, etc.) must NOT require the agent to specify `agent_mode` or `platform` dynamically — the server resolves these from the strategy's registration parameters using the authenticated identity resolved from headers.

### MCP Resources (Planned)

- `strategy_state://{agent_user_id}/{strategy_name}`: Returns JSON containing current registration parameters, status, and whether initialization is complete (e.g. `{"is_setup": true, "agent_mode": "paper", "platform": "polymarket_us"}`).


## Server Responsibilities

The server should act as the handler and persistence boundary.

### Paper Trading

For paper agents on `polymarket`, `kalshi`, or `polymarket_us`:

1. Validate strategy registration and required mode/platform.
2. Read official market data or accept a validated market snapshot.
3. Simulate fill behavior using platform-specific pricing/order book rules.
4. Update Supabase:
   - strategy
   - paper trade
   - positions
   - portfolio
   - ledger entries
   - portfolio snapshot
   - strategy report/reflection
5. Return updated portfolio and report references.

### Real Trading

For real agents on `kalshi` or `polymarket_us`:

1. Validate strategy registration and that `agent_mode = real`.
2. Validate real trading is allowed for this strategy/platform.
3. Read official market/portfolio/order state.
4. Submit order to official venue API.
5. Persist:
   - order request
   - official order response
   - fills, if available
   - local portfolio snapshot
   - strategy report/reflection
6. Reconcile official state with local state.
7. If differences exceed configured thresholds, write a reconciliation log.
8. Return official portfolio/report/reconciliation result to the client.

For real agents, official venue data is always source of truth.

## Supabase Data Model Additions

Existing tables are useful but not enough. Add these durable tables, either in the current public schema with careful access control or a private/internal schema if exposed API access is not needed.

### `strategies`

Purpose: one row per strategy identity and platform/mode pair.

Important fields:

- `id`
- `strategy_name`
- `agent_mode`: `paper` or `real`
- `platform`: `polymarket`, `kalshi`, `polymarket_us`
- `status`: `active`, `paused`, `disabled`
- `starting_balance`: default `10000.00`
- `risk_config`: jsonb
- `schedule`: cron string or nullable
- `metadata`: jsonb
- `created_at`, `updated_at`

Uniqueness:

- unique `(strategy_name, agent_mode, platform)`

### `strategy_runs`

Purpose: one row per scheduled/manual agent execution.

Important fields:

- `id`
- `strategy_id`
- `trigger_id`
- `started_at`
- `finished_at`
- `status`
- `input_context`: jsonb
- `summary`: text
- `error`: text
- `metadata`: jsonb

### `strategy_reports`

Purpose: cross-session memory and human-readable reflections.

Important fields:

- `id`
- `strategy_id`
- `run_id`
- `title`
- `report_markdown`
- `lessons_learned`
- `next_steps`
- `portfolio_summary`: jsonb
- `trade_summary`: jsonb
- `created_at`

Required report sections:

- Portfolio Status
- Trades Executed
- Market Observations or Analysis
- Risk Audit
- Lessons Learned
- Next Steps

### `portfolio_snapshots`

Purpose: immutable snapshots after bootstrap, before/after execution, and after reconciliation.

Important fields:

- `id`
- `strategy_id`
- `run_id`
- `platform`
- `agent_mode`
- `source`: `local`, `official`, `reconciled`
- `cash`
- `positions_value`
- `total_value`
- `pnl`
- `positions`: jsonb
- `orders`: jsonb
- `captured_at`

### `paper_trade_orders`

Purpose: normalized paper order/trade records for all three platforms. This can wrap or eventually replace the existing `paper_trades` shape.

Important fields:

- `id`
- `strategy_id`
- `run_id`
- `platform`
- `market_id`
- `market_slug`
- `outcome`
- `side`
- `quantity`
- `price`
- `notional`
- `fill_model`
- `status`
- `idempotency_key`
- `request`: jsonb
- `result`: jsonb
- `created_at`

### `real_trade_orders`

Purpose: audit trail for every official trading write.

Important fields:

- `id`
- `strategy_id`
- `run_id`
- `platform`: `kalshi` or `polymarket_us`
- `official_order_id`
- `client_order_id`
- `market_id`
- `market_slug_or_ticker`
- `side`
- `quantity`
- `price`
- `status`
- `request`: jsonb
- `official_response`: jsonb
- `error`: jsonb
- `created_at`, `updated_at`

### `reconciliation_logs`

Purpose: official-vs-local mismatch log for real agents.

Important fields:

- `id`
- `strategy_id`
- `run_id`
- `platform`
- `severity`: `info`, `warning`, `critical`
- `difference_type`: `balance`, `position`, `order`, `fill`, `unknown`
- `official_snapshot`: jsonb
- `local_snapshot`: jsonb
- `diff`: jsonb
- `threshold`: jsonb
- `message`
- `created_at`

## API Endpoints To Add

Add a new `/api/agent/*` API family in `polymarket-paper-trader`.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/agent/strategies/register` | POST | Register strategy identity. |
| `/api/agent/context` | GET/POST | Return prior reports, portfolio, orders, and official snapshot if real. |
| `/api/agent/reports` | GET/POST | List/write strategy reports. |
| `/api/agent/reports/[id]` | GET | Read one report. |
| `/api/agent/paper-trades` | POST | Execute or record a paper trade. |
| `/api/agent/real-trades` | POST | Execute a real trade and persist audit. |
| `/api/agent/real-orders/[id]/cancel` | POST | Cancel a real order and persist audit. |
| `/api/agent/reconcile` | POST | Reconcile official venue state against local state. |

Authentication should continue to support the agent-secret pattern, but required strategy fields should be in the request body or structured MCP args, not hidden only in headers.

## Scheduler / Trigger Reference

The attached Smith/Gemini config shows the desired pattern:

- One MCP server: `polytraders-web`.
- Strategy runs are scheduled by cron.
- Each prompt pins a strategy account (e.g. `conservative_arb`).
- Each strategy must use MCP for all reads and writes.
- Retro strategies require cross-session memory:
  - `list_reports`
  - `read_report`
  - `save_report`
- Save State is required at the end of every run.

Important trigger examples to preserve:

| Trigger | Schedule | Mode Today | Intended Notes |
| --- | --- | --- | --- |
| `conservative_arb` | `0 */2 * * *` | paper | Low-risk arbitrage, Kelly fraction 0.25, min edge 5%, max 5% per trade. |
| `aggressive` | `*/30 * * * *` | paper | Momentum, $500-1000 trades, max 15% per trade. |
| `world_cup` | `0 */2 * * *` | paper | World Cup only, external research required. |
| `high_freq` | `*/15 * * * *` | paper | Scalping/market making/hedging, quick exits. |
| `high_freq_conservative` | `*/30 * * * *` | paper | High-frequency but liquidity-filtered and risk-limited. |
| `cross_platform_arb` | `0 * * * *` | paper/quant-assisted | Execution-only agent follows quant engine instructions exactly. |
| `*_retro` | varies | paper | Must restore context from prior reports before trading. |

Do not store real secrets from external configs in docs. MCP server env should reference secret names only.

## Recommended MCP Server Direction

Long term, the MCP exposed to agents should be a single `polytraders-web` server, because the strategy prompts already assume:

```text
Use ONLY the polytraders-web MCP server for all reads and writes.
```

The current `traders` MCP can be used as an implementation reference or internal official-API client, but the mature agent-facing MCP should:

- require `strategy_name`, `agent_mode`, and `platform`;
- call the web/server `/api/agent/*` endpoints for persistence;
- call official APIs either directly or through the server, depending on secret custody decisions;
- keep secrets in server/MCP environment only, never in strategy prompts.

## Secrets And Custody

Never put secrets into tracked docs or prompts.

Allowed local/server env names:

- `AGENT_SECRET`
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `KALSHI_API_KEY_ID`
- `KALSHI_PRIVATE_KEY_PATH`
- `KALSHI_PRIVATE_KEY_PEM`
- `POLYMARKET_US_KEY_ID`
- `POLYMARKET_US_SECRET_KEY`

For production, prefer server-side custody:

```text
Agent MCP request
  -> polymarkettraders.com API
  -> official API write
  -> Supabase audit/report
```

This keeps real venue credentials away from frontend code and away from strategy prompts.

## Open Design Decisions

1. Whether the agent-facing MCP should call official APIs directly or always route through `polymarkettraders.com`.
   - Recommended for real trading: route writes through server.
   - Acceptable for market reads: direct official reads through MCP or server proxy.
2. Whether old `users` rows should continue representing strategies or a new `strategies` table should become primary.
   - Recommended: add `strategies` and keep old user mapping for UI compatibility during migration.
3. Whether paper trading should keep current `paper_trades` table or move to `paper_trade_orders`.
   - Recommended: keep current tables initially, add strategy foreign keys and platform enum support, then migrate gradually.
4. Whether Polymarket International real trading should ever be supported.
   - Recommended: not in first version because wallet/EIP-712/CLOB auth adds a separate risk model.

## Todo List

### Phase 0 - Documentation And Safety

- [x] Capture target architecture and gaps in this document.
- [x] Add server-side binding and anti-hallucination guardrails to architecture.
- [ ] Remove any real secrets from tracked files and configs.
- [ ] Decide canonical agent-facing MCP name: likely `polytraders-web`.
- [ ] Decide whether real trading writes must always route through `polymarkettraders.com`.

### Phase 1 - Schema

- [x] Add `polymarket_us` to platform enum/type support.
- [x] Add `agent_mode` enum: `paper`, `real`.
- [x] Add `platform` enum: `polymarket`, `kalshi`, `polymarket_us`.
- [x] Add `strategy_status` enum: `active`, `paused`, `disabled`.
- [x] Add `strategies` table.
- [x] Add `strategy_runs` table.
- [x] Add `strategy_reports` table (extend existing `agent_reports` with strategy FK).
- [x] Add `portfolio_snapshots` table.
- [x] Add `paper_trade_orders` table or extend existing `paper_trades` with strategy/platform fields.
- [x] Add `real_trade_orders` table.
- [x] Add `reconciliation_logs` table.
- [x] Generate and verify Drizzle migration.

### Phase 2 - Server APIs

- [x] Add `POST /api/agent/strategies/register`.
- [x] Add `GET /api/agent/context`.
- [x] Add `GET/POST /api/reports` (existing).
- [x] Add `GET /api/reports/[filename]` (existing).
- [x] Add `GET/POST /api/agent/reports`.
- [x] Add `GET /api/agent/reports/[id]`.
- [x] Add `POST /api/agent/paper-trades` (unified cross-platform paper trade endpoint).
- [x] Add `POST /api/agent/real-trades` (audit-first official real trade endpoint).
- [x] Add `POST /api/agent/real-orders/[id]/cancel` (audit-first official cancel endpoint).
- [x] Add `POST /api/agent/reconcile` (local snapshot/log placeholder; official snapshot fetch pending).
- [x] Keep compatibility wrappers for old `init_account`, `portfolio`, `history`, `stats`, `buy`, and `sell`.

### Phase 3 - Paper Trading

- [x] Polymarket paper trading flow (via `/api/trade/buy`, `/api/trade/sell`).
- [x] Kalshi paper trading flow (via `/api/kalshi/trade/buy`, `/api/kalshi/trade/sell`).
- [x] Polymarket US paper market-data client (via official `polymarket-us` SDK).
- [x] Polymarket US paper fill simulator (via `/api/polymarket-us/trade/buy`, `/api/polymarket-us/trade/sell`).
- [x] Normalize all three into unified `/api/agent/paper-trades`.
- [x] Ensure unified agent paper trades write portfolio snapshot.
- [x] Link paper trades to the current strategy report/run summary.
- [x] Idempotency enforcement per strategy/platform.

### Phase 4 - Real Trading

- [x] Move or reuse Kalshi official trading client server-side.
- [x] Move or reuse Polymarket US official trading client server-side.
- [x] Add real-trading enable flag per strategy (`metadata.real_trading_enabled`).
- [x] Add `submit_real_trade` MCP flow for Kalshi.
- [x] Add `submit_real_trade` MCP flow for Polymarket US.
- [x] Add cancel-order flow for both real platforms.
- [x] Persist every attempted official request/response/error in `real_trade_orders`.
- [x] Add official portfolio snapshot after each real write.

### Phase 5 - Reconciliation

- [x] Implement official Kalshi portfolio/order/fill snapshot fetch.
- [x] Implement official Polymarket US portfolio/order/activity snapshot fetch.
- [x] Compare official vs local balances.
- [x] Compare official vs local positions.
- [x] Compare official vs local open orders/fills.
- [x] Write `reconciliation_logs` for local snapshot / pending-official reconciliation state.
- [x] Return warnings to MCP client when official reconciliation is unavailable or fails.

### Phase 6 - MCP

- [x] Add `register_strategy` tool (all 3 MCP servers).
- [x] Add `get_strategy_context` tool (all 3 MCP servers).
- [x] Add `save_report` / `list_reports` / `read_report` tools (all 3 MCP servers).
- [x] Create per-platform Jetski skills with verified tool inventories (`polymarket-trading`, `kalshi-trading`, `polymarket-us-trading`).
- [x] Document per-platform tool comparison matrix in architecture doc.
- [ ] Add `record_paper_trade` tool (unified).
- [x] Add `submit_real_trade` tool.
- [x] Add `cancel_real_order` tool.
- [ ] Add `reconcile_portfolio` tool.
- [x] Execution tools (buy/sell) use only `strategy_name` — server resolves platform via server-side binding.
- [ ] Expose MCP Resource `strategy_state://{strategy_name}` for initialization state sync.
- [ ] Update old tools to call new tools internally or mark legacy.

### Phase 7 - Scheduling

- [ ] Convert Smith/Gemini trigger concepts into Codex-compatible automations if needed.
- [ ] Define schedules per strategy in Supabase or config.
- [ ] Add run locking so the same strategy cannot overlap itself.
- [ ] Add run status tracking.
- [ ] Add failure notification/reporting.
- [ ] Add host-script prompt modification to omit `register_strategy` when already setup.

### Phase 8 - UI

- [x] Add strategy registry dashboard.
- [x] Add reports viewer.
- [x] Add per-strategy portfolio snapshots.
- [x] Add real-trade audit log viewer.
- [x] Add reconciliation warning dashboard.
- [x] Add filters by platform and mode.

### Phase 9 - Tests

- [x] Unit test strategy registration (idempotency, mode/platform binding).
- [x] Unit test report write/read/list.
- [x] Unit test paper trade idempotency.
- [x] Unit test unified paper trade writes normalized order and portfolio snapshot.
- [x] Unit test unified paper trade links current strategy report/run summary.
- [x] Unit test real-trade/cancel flows persist audit state with mocked official clients.
- [x] Unit test reconciliation local snapshot/log placeholder.
- [ ] Integration test Polymarket paper flow.
- [ ] Integration test Kalshi paper flow.
- [ ] Integration test Polymarket US paper flow.
- [x] Mock official real trade clients for route-level real trade and cancel tests.
- [ ] Test reconciliation thresholds.
- [ ] MCP smoke test listing and calling new tools.
