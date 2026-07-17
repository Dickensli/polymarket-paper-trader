# How to Test Kalshi Real API Trading

This guide details the procedure for testing real API trading on Kalshi (using either the **Demo environment** with play money or the **Live environment** with real funds).

---

## 1. Setup API Credentials (Environment Variables)

The Next.js backend and the `kalshi-mcp` server authenticate requests to Kalshi using environment variables. Configure the following variables in your hosting environment or local `.env.local` file:

- **`KALSHI_API_KEY_ID`**: Your Kalshi API Key ID (a UUID generated from the Kalshi dashboard).
- **`KALSHI_PRIVATE_KEY_PEM`**: The multi-line RSA private key associated with the API key.
  > [!NOTE]
  > When pasting this key into a `.env` file, ensure all line breaks are escaped (replaced with `\n` characters) so that the file parses as a single-line string.
- **`KALSHI_PRIVATE_KEY_PATH`**: (Optional) Alternatively, keep the key in a file and set this to the absolute file path of your private key PEM file (e.g., `/usr/local/google/home/dickensli/.gemini/kalshi_key.pem`).
- **`KALSHI_USE_DEMO=true`**: Selects demo credentials and the official demo
  account for authenticated portfolio/order API calls.
- **`KALSHI_MARKET_DATA_ENV=live`**: Selects live production public market data
  for market research and local paper/shadow fills. This is the default.
- **`KALSHI_EXECUTION_BASE_URL`** and **`KALSHI_MARKET_DATA_BASE_URL`** are
  optional explicit URL overrides. Avoid the legacy shared `KALSHI_BASE_URL`
  when splitting the two venues.

Recommended commander test configuration:

```dotenv
KALSHI_USE_DEMO=true
KALSHI_MARKET_DATA_ENV=live
```

There is no `KALSHI_EXECUTION_MODE` variable. Strategy registration already
selects execution: `agent_mode=paper` means a local live-depth FOK shadow fill;
`agent_mode=real` means an authenticated official API submission (demo when
`KALSHI_USE_DEMO=true`).

---

## 2. Register a Real Trading Strategy

To execute real orders, you must first register your strategy with the server in "real trading" mode and enable the safety metadata flag.

### Option A: Using the `kalshi-mcp` Server `register_strategy` Tool
Call `register_strategy` with:
```json
{
  "strategy_id": "kalshi_real_test",
  "is_paper_trading": false,
  "platform": "kalshi",
  "account_id": "your_agent_user_id",
  "metadata": {
    "real_trading_enabled": true
  }
}
```

### Option B: Using the `/api/agent/strategies/register` REST Endpoint
Send a `POST` request to `/api/agent/strategies/register` with:
```json
{
  "strategy_id": "kalshi_real_test",
  "account_id": "your_agent_user_id",
  "is_paper_trading": false,
  "platform": "kalshi",
  "metadata": {
    "real_trading_enabled": true
  }
}
```
*Note: This request requires authentication and a valid user session.*

---

## 3. Submitting Real Trades

For both paper and official trading, use the standard `buy`/`sell` MCP tools.
The registered strategy mode selects the server-side execution path. Every BUY
must include the structured proposal described by the tool schema; do not pass
a caller price.

### Option A: Using the `kalshi-mcp` Server `buy` Tool
Call `buy` with:
```json
{
  "strategy_id": "kalshi_real_test",
  "ticker": "NASDAQ-26-D10000",
  "outcome": "YES",
  "shares": 10,
  "proposal": {
    "thesis": "A sourced thesis of at least twenty characters.",
    "rules_verified": true,
    "source_urls": ["https://example.com/source"],
    "fair_probability": 0.60,
    "confidence_low": 0.55,
    "confidence_high": 0.65,
    "quote_observed_at": "2026-07-16T12:00:00Z",
    "observed_price": 0.45,
    "available_depth": 100,
    "net_edge": 0.15,
    "proposed_nav_pct": 0.01,
    "exit_condition": "Exit when the catalyst passes or edge closes.",
    "invalidation_condition": "Do not enter if the source changes."
  }
}
```

### Option B: Using the `/api/agent/real-trades` REST Endpoint
Send a `POST` request to `/api/agent/real-trades` with the following body:
```json
{
  "strategy_id": "kalshi_real_test",
  "slug": "NASDAQ-26-D10000",
  "outcome": "YES",
  "side": "BUY",
  "shares": 10,
  "proposal": "same structured object shown above"
}
```

---

## 4. Cancelling Active Orders

Unfilled limit orders can be cancelled using their database UUID.

### Option A: Using the `kalshi-mcp` Server `cancel_real_order` Tool
Call `cancel_real_order` with:
```json
{
  "order_id": "local-order-uuid-from-database",
  "account": "kalshi_real_test"
}
```

### Option B: Using the `/api/agent/real-orders/[id]/cancel` REST Endpoint
Send a `POST` request to `/api/agent/real-orders/<order_id>/cancel`.

---

## 5. Audit, Verification & Reconciliation

The platform logs all official trading activity to Supabase for auditability:
- **`real_trade_orders`**: Tracks order submission status (`SUBMITTING`, `SUBMITTED`, `ERROR`, `CANCELLED`) and the official response payload.
- **`portfolio_snapshots`**: Captures actual cash, positions, and orders from Kalshi's API after each write.
- **`reconciliation_logs`**: Logs any mismatches between local state and Kalshi's official records.
- **`strategy_decisions`**: Stores accepted and rejected structured proposals,
  server quote facts, and policy-rejection reasons used by the graduation scorecard.

### Verification Steps
1. Call the `get_strategy_context` tool or check `/api/agent/context?strategy_id=kalshi_real_test` to verify that your portfolio cash and open positions match Kalshi's records.
2. In case of issues, verify the `real_trade_orders` and `reconciliation_logs` tables in Supabase for error codes (e.g. `REAL_TRADING_DISABLED` if the metadata flag was not set).
