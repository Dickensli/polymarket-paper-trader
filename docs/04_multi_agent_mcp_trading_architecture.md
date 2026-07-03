# Multi-Agent MCP Trading Architecture

Last updated: 2026-07-02

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

## Required MCP Tool Shape

All lifecycle tools should require these fields unless the tool is obviously platform-neutral:

- `strategy_name`: stable strategy/account name, for example `dickens_smith("conservative_arb")`.
- `agent_mode`: enum, `paper` or `real`.
- `platform`: enum, `polymarket`, `kalshi`, or `polymarket_us`.

Recommended core tools:

| Tool | Purpose |
| --- | --- |
| `register_strategy` | Register or update strategy identity. Must return `{ registered: true, starting_balance: 10000 }` by default. |
| `get_strategy_context` | Return prior portfolio, current official portfolio if real, recent trades/orders, recent reports, and warnings. |
| `write_strategy_report` | Persist markdown/structured reflection after a run. |
| `list_strategy_reports` | List prior reports for cross-session memory. |
| `read_strategy_report` | Read a specific prior report. |
| `record_paper_trade` | Submit paper trade intent/results to server. |
| `submit_real_trade` | Submit real order intent to server; server handles official API call and Supabase audit. |
| `cancel_real_order` | Cancel a real order and persist audit/result. |
| `reconcile_portfolio` | Compare official portfolio/orders with local snapshots and log discrepancies. |
| `get_official_market_data` | Unified read tool or family of read tools backed by official APIs. |

Older tools such as `init_account`, `portfolio`, `history`, `stats`, `buy`, and `sell` can remain as compatibility wrappers, but the new agent protocol should be explicit about strategy, mode, and platform.

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
- Each prompt pins a strategy account such as `dickens_smith("conservative_arb")`.
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
- [ ] Remove any real secrets from tracked files and configs.
- [ ] Decide canonical agent-facing MCP name: likely `polytraders-web`.
- [ ] Decide whether real trading writes must always route through `polymarkettraders.com`.

### Phase 1 - Schema

- [ ] Add `polymarket_us` to platform enum/type support.
- [ ] Add `agent_mode` enum: `paper`, `real`.
- [ ] Add `strategies` table.
- [ ] Add `strategy_runs` table.
- [ ] Add `strategy_reports` table.
- [ ] Add `portfolio_snapshots` table.
- [ ] Add `paper_trade_orders` table or extend existing `paper_trades` with strategy/platform fields.
- [ ] Add `real_trade_orders` table.
- [ ] Add `reconciliation_logs` table.
- [ ] Generate and verify Drizzle migration.

### Phase 2 - Server APIs

- [ ] Add `POST /api/agent/strategies/register`.
- [ ] Add `GET/POST /api/agent/context`.
- [ ] Add `GET/POST /api/agent/reports`.
- [ ] Add `GET /api/agent/reports/[id]`.
- [ ] Add `POST /api/agent/paper-trades`.
- [ ] Add `POST /api/agent/real-trades`.
- [ ] Add `POST /api/agent/real-orders/[id]/cancel`.
- [ ] Add `POST /api/agent/reconcile`.
- [ ] Keep compatibility wrappers for old `init_account`, `portfolio`, `history`, `stats`, `buy`, and `sell`.

### Phase 3 - Paper Trading

- [ ] Normalize current Polymarket paper flow into `/api/agent/paper-trades`.
- [ ] Normalize current Kalshi paper flow into `/api/agent/paper-trades`.
- [ ] Add Polymarket US paper market-data client.
- [ ] Add Polymarket US paper fill simulator.
- [ ] Ensure all paper trades write portfolio snapshot and report link.
- [ ] Add idempotency enforcement per strategy/platform.

### Phase 4 - Real Trading

- [ ] Move or reuse Kalshi official trading client server-side.
- [ ] Move or reuse Polymarket US official trading client server-side.
- [ ] Add real-trading enable flags per platform and per strategy.
- [ ] Add `submit_real_trade` MCP flow for Kalshi.
- [ ] Add `submit_real_trade` MCP flow for Polymarket US.
- [ ] Add cancel-order flow for both real platforms.
- [ ] Persist every official request/response in `real_trade_orders`.
- [ ] Add official portfolio snapshot after each real write.

### Phase 5 - Reconciliation

- [ ] Implement official Kalshi portfolio/order/fill snapshot fetch.
- [ ] Implement official Polymarket US portfolio/order/activity snapshot fetch.
- [ ] Compare official vs local balances.
- [ ] Compare official vs local positions.
- [ ] Compare official vs local open orders/fills.
- [ ] Write `reconciliation_logs` for material differences.
- [ ] Return warnings to MCP client when differences exceed threshold.

### Phase 6 - MCP

- [ ] Add `register_strategy` tool.
- [ ] Add `get_strategy_context` tool.
- [ ] Add `write_strategy_report` tool.
- [ ] Add `list_strategy_reports` tool.
- [ ] Add `read_strategy_report` tool.
- [ ] Add `record_paper_trade` tool.
- [ ] Add `submit_real_trade` tool.
- [ ] Add `cancel_real_order` tool.
- [ ] Add `reconcile_portfolio` tool.
- [ ] Require `strategy_name`, `agent_mode`, and `platform` in new tools.
- [ ] Update old tools to call new tools internally or mark legacy.

### Phase 7 - Scheduling

- [ ] Convert Smith/Gemini trigger concepts into Codex-compatible automations if needed.
- [ ] Define schedules per strategy in Supabase or config.
- [ ] Add run locking so the same strategy cannot overlap itself.
- [ ] Add run status tracking.
- [ ] Add failure notification/reporting.

### Phase 8 - UI

- [ ] Add strategy registry dashboard.
- [ ] Add reports viewer.
- [ ] Add per-strategy portfolio snapshots.
- [ ] Add real-trade audit log viewer.
- [ ] Add reconciliation warning dashboard.
- [ ] Add filters by platform and mode.

### Phase 9 - Tests

- [ ] Unit test strategy registration.
- [ ] Unit test report write/read/list.
- [ ] Unit test paper trade idempotency.
- [ ] Integration test Polymarket paper flow.
- [ ] Integration test Kalshi paper flow.
- [ ] Integration test Polymarket US paper flow.
- [ ] Mock official real trade clients for Kalshi and Polymarket US.
- [ ] Test reconciliation thresholds and log creation.
- [ ] MCP smoke test listing and calling new tools.

