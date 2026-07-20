# Trading-agent prompt revision notes

## Ongoing report-to-prompt flywheel

Run `.agents/skills/strategy-prompt-flywheel` for future report-driven prompt
revisions. The flywheel treats report prose as a hypothesis and server-verified
ledger/performance data as evidence. Performance tuning requires repeated
behavior across at least three reports, seven post-reset days, three independent
markets/events, and a chronologically held-out validation slice. Single winners,
single losses, named-market lessons, and unverified PnL never justify a prompt
change. Correctness and safety defects may be fixed sooner when they are
reproducible from authoritative server data.

Every cycle writes a timestamped audit to `docs/strategy-flywheel-reports/`,
including changed and unchanged strategies, verified strengths, rejected
overfit candidates, validation results, and the published git commit.

The initial prompt fragments in this directory were derived from the historical
pre-reset corpus: 1,178 Kalshi reports across 14 strategies and 1,211
Polymarket US reports across 9 strategies. Those raw reports were removed during
the 2026-07-17 clean-inception reset. Future revisions must use only post-reset
evidence gathered by the flywheel above.

## Repeated failure modes converted into prompt rules

- Treat missing, identical, stale, or non-complementary YES/NO quotes as data
  integrity failures, never as arbitrage.
- Require executable book depth for the full requested size. Top-of-book price
  is not evidence that an unlimited order can fill there.
- Define arbitrage using identical settlement rules plus mutually exclusive and
  exhaustive outcomes; directional bets and loose hedges cannot be labeled arb.
- Aggregate exposure across repeated trades and across both outcomes of the
  same event. Add daily loss, drawdown, trade-count, category, and cash limits.
- Remove cash-deployment targets. Holding cash is explicitly valid.
- Require source URLs/timestamps and exact contract-rule mapping; unsupported
  lineup, injury, political, or macro claims cannot justify a trade.
- Reconcile exact official fill counts and remaining quantities after every
  order. `SUBMITTED` or `RESTING` does not mean `FILLED`.
- Narrow the so-called HFT strategies to short-horizon taker trading; they do
  not have the tooling needed for true market making.
- A reset is a new inception. Agents must never call `init_account` on their
  own, restore deleted positions from reports, or convert an old marked NAV
  into new principal. Empty history/reports with $10,000 cash is authoritative.
- Portfolio value means executable liquidation value. Venue quotes, current
  prices, top-of-book walls, and exposure/cost fields are not market value.
- Structured report summaries are server-verified. Narrative text may explain
  decisions but must not override `portfolio_summary.verified` or
  `trade_summary.verified`.
- Reports provide bounded cross-session research memory. A server-timestamped
  memory generation hides legacy reports from agent list/read/context calls
  without deleting audit evidence; agents read up to three active-generation
  reports as hypotheses while current server state remains authoritative.
- Graduation is notification-only for paper strategies. Brier score, historical
  decision counts, policy history, and unmet graduation criteria never pause
  paper trading or justify manufacturing rejected decisions for volume. Kalshi
  paper strategies query graduation only after the cycle's trade/no-trade
  decision and execution verification are complete.

## Configuration corrections outside the prompt text

- The supplied Kalshi `POLYTRADER_API_URL` is a Markdown link, not a URL. Use
  `http://localhost:3000/api` locally or the actual deployed HTTPS API URL.
- `KALSHI_USE_DEMO=true` selects demo credentials and the demo venue only for
  authenticated official-account reads/writes. Set `KALSHI_MARKET_DATA_ENV=live`
  (the default) for production quotes and realistic local shadow fills. A paper
  strategy is already the shadow execution mode; no `KALSHI_EXECUTION_MODE`
  variable is needed.
- With the recommended pair (`KALSHI_USE_DEMO=true`,
  `KALSHI_MARKET_DATA_ENV=live`), `commander` reads the live book and writes
  only local paper state, while `commander_real` reads the same live public
  book but submits authenticated orders only to Kalshi Demo. Live liquidity
  cannot fill the Demo order; the two executions must be evaluated separately.
- Every Kalshi BUY now carries a structured proposal that the server checks
  against fresh price, full depth, edge, and NAV. Graduation is also computed
  server-side; agents may announce `GRADUATION_READY` but cannot self-enable
  real-money trading.
- Polymarket US paper orders now walk the full outcome-aware book with FOK
  semantics, and open positions are marked at the executable SELL side.
- Remove the expired one-off `tactical_reconcile_0230_jul16` trigger.
- Rotate the agent secret that appeared in the supplied configuration before
  installing the revised config. The prompt files intentionally contain no
  credentials.
