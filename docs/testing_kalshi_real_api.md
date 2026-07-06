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
- **`KALSHI_BASE_URL`**:
  - **Demo Environment (Recommended for Testing)**: `https://demo-api.kalshi.com/trade-api/v2`
  - **Live Environment (Production)**: `https://external-api.kalshi.com/trade-api/v2`

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

For real trading, use the dedicated real trading tools or endpoints. Standard `buy`/`sell` tools are reserved for paper trading simulation.

### Option A: Using the `kalshi-mcp` Server `submit_real_trade` Tool
Call `submit_real_trade` with:
```json
{
  "strategy_id": "kalshi_real_test",
  "slug": "NASDAQ-26-D10000",
  "outcome": "YES",
  "side": "BUY",
  "price": 0.45,
  "shares": 10,
  "account": "kalshi_real_test",
  "agent_user_id": "your_agent_user_id"
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
  "price": 0.45,
  "shares": 10
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

### Verification Steps
1. Call the `get_strategy_context` tool or check `/api/agent/context?strategy_id=kalshi_real_test` to verify that your portfolio cash and open positions match Kalshi's records.
2. In case of issues, verify the `real_trade_orders` and `reconciliation_logs` tables in Supabase for error codes (e.g. `REAL_TRADING_DISABLED` if the metadata flag was not set).
