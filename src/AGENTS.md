<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Strategy ID & Reporting Guardrails
1. **STRATEGY ID LOCK**: All trading agents MUST use their exact assigned trigger ID (e.g. `high_freq_retro`, `high_freq_real`) for all tool calls. You are STRICTLY forbidden from dynamically calling `register_strategy` with custom, invented, or modified strategy IDs (e.g. adding `_sol` or `_v2` suffixes). The MCP servers enforce this at runtime.
2. **ZERO HALLUCINATION REPORTING**: When calling `save_report`, every trade price, share count, and P&L figure you write MUST correspond EXACTLY to a transaction fetched in your Bootstrap/History step or returned by a write tool in this active session. NEVER guess or make up trade execution prices or P&L. If no trades executed, report: 'No trades executed in this session'. Every number must be 100% verified.

# Test-Driven Development (TDD) Enforcement
1. **TEST-DRIVEN**: When implementing any new feature or modifying existing logic, you MUST verify if appropriate tests (unit, integration, or E2E via Playwright) exist. If new features do not have covering test cases, you MUST write them. Never consider a feature complete without automated verification.

# Kalshi Split-Environment Execution

1. **INDEPENDENT CONTROLS**: `KALSHI_MARKET_DATA_ENV` selects the public quote venue; `KALSHI_USE_DEMO` selects credentials and the authenticated official-account venue. Never infer one from the other. Do not introduce `KALSHI_ACCOUNT_ENV` or `KALSHI_EXECUTION_MODE`; strategy `agent_mode` is the execution-mode source of truth.
2. **RECOMMENDED TEST CONFIGURATION**: Use `KALSHI_MARKET_DATA_ENV=live` with `KALSHI_USE_DEMO=true`. Do not set the legacy shared `KALSHI_BASE_URL`; use `KALSHI_MARKET_DATA_BASE_URL` or `KALSHI_EXECUTION_BASE_URL` only for an intentional explicit override.
3. **COMMANDER (PAPER/SHADOW)**: `commander` reads the live production market/orderbook, validates a structured BUY proposal, walks displayed depth with FOK semantics, and writes only local paper state. It never submits an authenticated Demo or production order. Its fills and scorecard measure decision quality under displayed live liquidity.
4. **COMMANDER_REAL (OFFICIAL DEMO)**: `commander_real` also researches against live public data, but reads official balances/orders/fills and submits authenticated orders to Kalshi Demo while `KALSHI_USE_DEMO=true`. Because Demo and production are independent books, a price derived from live data may not fill on Demo; use this path to verify signing, order lifecycle, cancellation, sync, and reconciliation—not strategy P&L or fill realism.
5. **GRADUATION GATE**: Before `commander_real` may add risk, the server checks the `commander` shadow scorecard configured by `graduation_source_strategy_id`. This validates the same decision policy on realistic live depth before official execution is allowed. A passing `GRADUATION_READY` result is only a notification for human review; it never sets `real_trading_enabled` and never authorizes automatic real-money activation. Risk-reducing orders remain permitted.
6. **NO CROSS-VENUE FILL ASSUMPTIONS**: Production market data cannot provide liquidity to a Demo order. Never report a local shadow fill as an official Demo fill, and never report a submitted/resting Demo order as filled.

The controls resolve in this order:

| Control | `commander` (`agent_mode=paper`) | `commander_real` (`agent_mode=real`) |
| --- | --- | --- |
| `KALSHI_MARKET_DATA_ENV=live` | Reads live public markets/orderbooks | Reads live public markets/orderbooks |
| `KALSHI_MARKET_DATA_ENV=demo` | Reads Demo public markets/orderbooks | Reads Demo public markets/orderbooks |
| `KALSHI_USE_DEMO=true` | Ignored for execution; writes local paper state only | Uses Demo credentials/account and submits to Demo |
| `KALSHI_USE_DEMO=false` | Ignored for execution; writes local paper state only | Uses production credentials/account and can spend real money |

The supported test pair is `KALSHI_MARKET_DATA_ENV=live` plus
`KALSHI_USE_DEMO=true`. Never combine Demo market data with production
execution (`KALSHI_MARKET_DATA_ENV=demo`, `KALSHI_USE_DEMO=false`): that would
make real-money decisions from the wrong book.
