# Trading-agent prompt revision notes

The prompt fragments in this directory were derived from all reports currently
stored for the two venues: 1,178 Kalshi reports across 14 strategies and 1,211
Polymarket US reports across 9 strategies.

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

## Configuration corrections outside the prompt text

- The supplied Kalshi `POLYTRADER_API_URL` is a Markdown link, not a URL. Use
  `http://localhost:3000/api` locally or the actual deployed HTTPS API URL.
- Set `KALSHI_USE_DEMO=true` wherever demo orders are submitted so public market
  data and official execution use the same venue.
- Remove the expired one-off `tactical_reconcile_0230_jul16` trigger.
- Rotate the agent secret that appeared in the supplied configuration before
  installing the revised config. The prompt files intentionally contain no
  credentials.
