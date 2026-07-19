# Repository and evidence map

## Canonical evidence sources

Use the sources in this order:

1. Server-verified fields in `agent_reports.portfolio_summary.verified` and `agent_reports.trade_summary.verified`.
2. `strategy_performance_snapshots`, `strategy_decisions`, exact paper trades, official order/fill/settlement ledgers, and current portfolio state.
3. Report narrative, `lessons_learned`, and `next_steps` only as hypotheses or qualitative context.

Join reports through `agent_reports.strategy_id = strategies.id`. Never group by `strategy_name` alone: the same ID can exist on multiple platforms or modes. The stable analysis key is:

```text
platform:agent_mode:strategy_id
```

Ignore reports before `strategies.metadata.performance_baseline_at` or `last_destructive_reset_at` when evaluating the current strategy incarnation. Empty history after a reset is missing evidence, not neutral or poor performance.

The API implementation is in:

- `src/src/app/api/agent/reports/route.ts`
- `src/src/app/api/agent/context/route.ts`
- `src/src/lib/db/schema.ts`

The global flywheel should use the bundled read-only exporter because `/api/agent/reports` is authenticated to one strategy user at a time.

## MCP fallback

When direct database export is unavailable, use the venue MCP registered for the exact strategy:

1. `get_strategy_context`
2. `list_reports`
3. `read_report` for the selected filenames
4. `portfolio`, `history`, and `stats`

Pass the exact registered `strategy_id` on every state-touching call. Account identity is injected by each venue MCP deployment; only pass an `account_id` when that specific `register_strategy` schema exposes it. This fallback is read-only for the flywheel: do not call `buy`, `sell`, `save_report`, `register_strategy`, or `init_account`.

## Prompt ownership map

| Stable strategy key | Prompt source | Block |
| --- | --- | --- |
| `kalshi:paper:commander` | `docs/agent-prompts/kalshi-prompts.proto` | `id: "commander"` |
| `kalshi:real:commander_real` | `docs/agent-prompts/kalshi-prompts.proto` | `id: "commander_real"` |
| `kalshi:paper:conservative_retro` | `docs/agent-prompts/kalshi-prompts.proto` | `id: "conservative_retro"` |
| `kalshi:paper:high_freq_retro` | `docs/agent-prompts/kalshi-prompts.proto` | `id: "high_freq_retro"` |
| `polymarket_us:paper:conservative_retro` | `docs/agent-prompts/polymarket-us-prompts.proto` | `id: "conservative_retro"` |
| `polymarket_us:paper:high_freq_retro` | `docs/agent-prompts/polymarket-us-prompts.proto` | `id: "high_freq_retro"` |

If a database strategy has no mapped prompt block, include it in the audit report as `unmapped`; do not invent a trigger or silently add a prompt. Polymarket International currently has no prompt source in this directory.

## Comparison boundaries

- Compare strategies only within the same platform, mode, baseline era, and overlapping time window.
- Kalshi paper strategies use live production public depth with local shadow fills.
- `kalshi:real:commander_real` uses the official Kalshi venue configured by `KALSHI_USE_DEMO`. When Demo is enabled, its PnL/fills measure integration behavior, not live strategy quality. Never rank it against Kalshi paper strategies.
- Polymarket US paper valuation must use executable SELL-side liquidation value and full outcome-aware book depth.
- External capital flows make raw PnL incomparable; prefer TWR and explicitly disclose flows.
- Unpriced positions, stale pricing, missing verified summaries, or report/ledger conflicts lower evidence quality and can invalidate tuning.

## Git history checks

Use strategy-specific history to enforce the cooldown and understand intent:

```bash
git log --since='30 days ago' -p -- docs/agent-prompts/kalshi-prompts.proto
git log --since='30 days ago' -p -- docs/agent-prompts/polymarket-us-prompts.proto
```

Do not revert unrelated prompt safeguards merely because a later report does not mention them.
