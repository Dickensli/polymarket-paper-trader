# Polymarket API Prototype Report

> **Run Date:** 2026-06-20T05:44:41Z  
> **Node Version:** v24.13.0  
> **Script:** `prototype/api_validation.mjs`  
> **Results Data:** `prototype/api_validation_results.json`

---

## 1. Executive Summary

**10 of 12 endpoints responded successfully (83% pass rate).** The Gamma API and CLOB API are fully operational and provide rich, well-structured data ideal for a paper trading application. The Data API (`data-api.polymarket.com`) returned 404 for both tested endpoints — it appears to be deprecated or reorganized.

| API Layer | Endpoints Tested | Passing | Failing |
|-----------|:---:|:---:|:---:|
| Gamma API | 4 | 4 ✅ | 0 |
| CLOB API | 6 | 6 ✅ | 0 |
| Data API | 2 | 0 | 2 ❌ |
| **Total** | **12** | **10** | **2** |

---

## 2. Endpoint-by-Endpoint Results

### ✅ Working Endpoints

| # | Endpoint | Status | Time (ms) | Size (B) | Response Shape |
|---|----------|:------:|:---------:|:---------:|---------------|
| 1 | `Gamma GET /events` | 200 | 181 | 29,600 | `Array[5]` of event objects |
| 2 | `Gamma GET /events/{id}` | 200 | 165 | 6,049 | Single event object |
| 3 | `Gamma GET /markets` | 200 | 102 | 33,997 | `Array[5]` of market objects |
| 4 | `Gamma GET /markets/{id}` | 200 | 20 | 4,060 | Single market object |
| 5 | `CLOB GET /midpoint` | 200 | 143 | 15 | `{ mid }` |
| 6 | `CLOB GET /spread` | 200 | 96 | 18 | `{ spread }` |
| 7 | `CLOB GET /book` | 200 | 91 | 2,281 | `{ market, asset_id, bids, asks, ... }` |
| 8 | `CLOB GET /last-trade-price` | 200 | 92 | 30 | `{ price, side }` |
| 9 | `CLOB GET /prices-history` | 200 | 132 | 15 | `{ history }` |
| 10 | `CLOB GET /time` | 200 | 93 | 10 | Unix timestamp (number) |

### ❌ Failed Endpoints

| # | Endpoint | Status | Response |
|---|----------|:------:|---------|
| 11 | `Data API GET /markets` | 404 | `"404 page not found"` (non-JSON) |
| 12 | `Data API GET /events` | 404 | `"404 page not found"` (non-JSON) |

> [!WARNING]
> The `data-api.polymarket.com` endpoints appear to be deprecated or relocated. Both return 404 with plain-text (non-JSON) error bodies. **Do not rely on the Data API** for the paper trading app.

---

## 3. Response Time Analysis

| Metric | Value |
|--------|------:|
| **Average** | 114 ms |
| **Fastest** | 20 ms (`Gamma GET /markets/{id}`) |
| **Slowest** | 181 ms (`Gamma GET /events`) |
| **Median** | ~96 ms |

### Distribution

```
  0–50ms  │ █ .................... (1 endpoint — single market fetch, likely cached)
 50–100ms │ █████ ................ (5 endpoints — CLOB single-value queries)
100–150ms │ ████ ................. (4 endpoints — list queries + Data API 404s)
150–200ms │ ██ ................... (2 endpoints — Gamma list/detail with nested data)
```

**Assessment:** All endpoints respond well under 200ms. Response times are suitable for real-time paper trading with no perceptible lag. The CLOB endpoints are remarkably fast (91–143ms) for a public API.

---

## 4. Data Quality Observations

### 4.1 Gamma API — Events

**Shape:** 45 fields per event, including nested `markets[]`, `series[]`, and `tags[]`.

**Key observations:**
- Events marked `active=true` may still have `closed=true` — the `active` flag appears to mean "not archived," not "currently tradeable." **The `closed` field is the reliable indicator.**
- Events with `closed=true` have `volume24hr=0` and zero liquidity, as expected.
- The default sort appears to be by `id` (ascending / chronological), meaning the first results are very old markets (2021 NBA/NFL). For a paper trader, filtering with `closed=false` would be more useful.
- `commentCount` values seem unrealistically high on some closed markets (8,125 comments on a 2021 NBA spread bet). Possibly aggregated from the series.

**Sample:**
```json
{
  "id": "2890",
  "title": "NBA: Will the Mavericks beat the Grizzlies by more than 5.5 points in their December 4 matchup?",
  "active": true,      // ← still "active" even though closed
  "closed": true,       // ← THIS is the real status
  "volume": 1335.05,
  "liquidity": 0,
  "category": "Sports"
}
```

### 4.2 Gamma API — Markets

**Shape:** 80+ fields per market — extremely rich data model.

**Key fields for paper trading:**

| Field | Purpose | Example |
|-------|---------|---------|
| `question` | Display name | `"New Rihanna Album before GTA VI?"` |
| `conditionId` | Used for CLOB queries | `0x1fad72...` |
| `clobTokenIds` | JSON-encoded string of token IDs (Yes/No) | `["98022...", "53831..."]` |
| `outcomePrices` | Current probability as JSON string | `["0.51", "0.49"]` |
| `outcomes` | JSON-encoded labels | `["Yes", "No"]` |
| `lastTradePrice` | Most recent trade | `0.5` |
| `bestBid` / `bestAsk` | Top of book | `0.50 / 0.52` |
| `spread` | Bid-ask spread | `0.02` |
| `volume24hr` | 24h volume (USD) | `778.05` |
| `liquidityClob` | CLOB liquidity | `12538.12` |
| `enableOrderBook` | Whether CLOB is active | `true` |
| `orderPriceMinTickSize` | Min price increment | `0.01` |
| `orderMinSize` | Minimum order size | `5` |
| `feeSchedule` | Fee structure | `{ rate: 0.05, takerOnly: true, rebateRate: 0.25 }` |

> [!IMPORTANT]
> `clobTokenIds` and `outcomes` are **JSON-encoded strings**, not arrays. They must be parsed with `JSON.parse()` before use.

### 4.3 CLOB API — Price Data

All CLOB endpoints return string-encoded numeric values (not raw numbers).

**Midpoint:**
```json
{ "mid": "0.51" }
```

**Spread:**
```json
{ "spread": "0.02" }
```

**Last Trade:**
```json
{ "price": "0.5", "side": "SELL" }
```

**Order Book:**
```json
{
  "market": "0x1fad72...",
  "asset_id": "98022...",
  "timestamp": "1781934281257",
  "bids": [
    { "price": "0.50", "size": "8173.32" },
    { "price": "0.49", "size": "1075.97" }
  ],
  "asks": [
    { "price": "0.52", "size": "87.44" },
    { "price": "0.53", "size": "847.55" }
  ],
  "min_order_size": "5",
  "tick_size": "0.01",
  "neg_risk": false,
  "last_trade_price": "0.520"
}
```

The order book is well-structured with 34 bid levels and 27 ask levels for this market — deep liquidity that provides realistic simulation data.

### 4.4 CLOB API — Prices History

The `/prices-history` endpoint returned an **empty `history` array** for the tested condition ID:
```json
{ "history": [] }
```

This is likely because:
1. The condition ID maps to a relatively new or low-volume market
2. The `fidelity=60` parameter may need different values
3. Historical data may only be available for certain high-profile markets

> [!NOTE]  
> For the paper trader, price history charts may need to use the Gamma API's `oneDayPriceChange`, `oneWeekPriceChange`, `oneMonthPriceChange`, and `oneYearPriceChange` fields as fallbacks when `/prices-history` returns empty data.

### 4.5 CLOB API — Server Time

```json
1781934285
```

Returns a Unix timestamp (seconds). Useful for clock synchronization and verifying API availability.

---

## 5. Rate Limit Observations

**No rate-limit headers were observed** on any of the 12 requests. None of the following standard headers appeared:

- `x-ratelimit-limit`
- `x-ratelimit-remaining`
- `x-ratelimit-reset`
- `retry-after`
- `ratelimit-limit` / `ratelimit-remaining` / `ratelimit-reset`

**Implications:**
- The APIs do not expose rate limit quotas via headers
- Rate limiting likely exists server-side but is opaque (may result in 429 responses without warning)
- Our 300ms delay between requests was sufficient — no throttling encountered
- For the paper trader, implementing conservative polling intervals (e.g. 2–5 seconds between market refreshes) is advisable

---

## 6. Key IDs Extracted

These IDs were dynamically extracted during the test run and demonstrate the ID chaining workflow:

| ID Type | Value | Source |
|---------|-------|--------|
| Event ID | `2890` | `GET /events` → first result `.id` |
| Market ID | `540817` | `GET /markets` → first result `.id` |
| Token ID (Yes) | `98022490269692409998126496127597032490334070080325855126491859374983463996227` | Market `.clobTokenIds[0]` |
| Token ID (No) | `53831553061883006530739877284105938919721408776239639687877978808906551086026` | Market `.clobTokenIds[1]` |
| Condition ID | `0x1fad72fae204143ff1c3035e99e7c0f65ea8d5cd9bd1070987bd1a3316f772be` | Market `.conditionId` |

**ID Flow for Paper Trading:**
```
GET /events → event.id
  └→ GET /events/{id} → event.markets[].conditionId, event.markets[].clobTokenIds
      └→ GET /midpoint?token_id={clobTokenId}
      └→ GET /book?token_id={clobTokenId}
      └→ GET /prices-history?market={conditionId}
```

---

## 7. Recommendations for Paper Trading App

### 7.1 API Strategy

| Concern | Recommendation |
|---------|---------------|
| **Primary data source** | Use **Gamma API** for market discovery and metadata |
| **Real-time pricing** | Use **CLOB API** for midpoint, spread, book, last trade |
| **Avoid** | Do **not** use `data-api.polymarket.com` — it's dead (404) |
| **Filtering** | When listing markets, add `closed=false` to the query params to get only tradeable markets |
| **Sorting** | Consider adding `order=volume24hr&ascending=false` to surface the most active markets first |

### 7.2 Data Model Considerations

1. **Parse JSON strings:** `clobTokenIds`, `outcomes`, `outcomePrices`, and `umaResolutionStatuses` are all JSON-encoded strings. Build a normalization layer.

2. **Two token IDs per market:** Each binary (Yes/No) market has two CLOB token IDs. The first maps to "Yes", the second to "No". The paper trader needs to track both.

3. **String → number conversion:** CLOB API returns all prices and sizes as strings. Parse to `Number` or use a decimal library for precision.

4. **Fee awareness:** Markets include a `feeSchedule` object. The current fee structure is:
   - **Rate:** 5% on taker fills only
   - **Rebate rate:** 25% (makers get 25% of the fee back)
   - Paper trades should simulate these fees for realism.

5. **Neg-risk markets:** Some markets have `negRisk=true` and `enableNegRisk=true`, which use a different settlement mechanism. The paper trader should handle both modes.

### 7.3 Polling Strategy

```
Market discovery:  Gamma GET /markets   → every 60 seconds
Price updates:     CLOB GET /midpoint   → every 5 seconds per watched market
Order book:        CLOB GET /book       → every 10 seconds per active trade
Last trade:        CLOB GET /last-trade → on demand (after simulated fill)
Server health:     CLOB GET /time       → every 60 seconds (heartbeat)
```

### 7.4 Error Handling

- All CLOB endpoints should have graceful degradation — if `/midpoint` fails, fall back to `outcomePrices` from the Gamma market data
- Implement exponential backoff for any 429 (rate limit) or 5xx responses
- The `/prices-history` endpoint may return empty arrays — handle gracefully with "No history available" UI state

### 7.5 Architecture Suggestion

```
┌─────────────────────────────────────────┐
│            Paper Trading App            │
├─────────────┬───────────────────────────┤
│  Market     │  Trading Engine           │
│  Discovery  │  (simulated orders)       │
│  Module     │                           │
│  ┌────────┐ │  ┌──────────┐             │
│  │ Gamma  │ │  │ CLOB API │             │
│  │ API    │ │  │ /midpoint│             │
│  │/markets│ │  │ /book    │             │
│  │/events │ │  │ /spread  │             │
│  └────────┘ │  └──────────┘             │
│             │                           │
│  Normalizer │  Fee Calculator           │
│  (parse JSON│  (5% taker, 25% rebate)  │
│   strings)  │                           │
└─────────────┴───────────────────────────┘
```

---

## 8. Known Quirks & Gotchas

1. **`active=true` doesn't mean "open for trading"** — old resolved markets can still have `active=true`. Always check `closed=false` AND `acceptingOrders=true`.

2. **Default sort is by ID (oldest first)** — without explicit sorting params, the Gamma API returns ancient 2021 markets. Use `order=volume24hr&ascending=false` or `order=updatedAt&ascending=false`.

3. **`clobTokenIds` is a JSON string inside JSON** — double-encoded. Must call `JSON.parse()` on it.

4. **Price history can be empty** — the `/prices-history` endpoint returns `{ history: [] }` for some markets. It does not error; it simply has no data.

5. **CLOB prices are strings** — all price/size values in the CLOB API are string-encoded decimals, not numbers.

6. **Event-to-market is 1:many** — a single event can contain multiple markets (e.g., "What will happen before GTA VI?" has markets for Rihanna album, Playboi Carti album, etc.).

7. **Liquidity field discrepancy** — `liquidity` (AMM) vs `liquidityClob` (CLOB) exist separately. For current markets, only `liquidityClob` is relevant since AMM liquidity is typically 0.

---

## 9. Conclusion

The Polymarket public APIs are **production-ready for paper trading**. The Gamma API provides comprehensive market metadata with 80+ fields, and the CLOB API delivers fast, accurate real-time pricing data. The only dead endpoints are on the deprecated Data API, which can be safely ignored.

**Next steps:**
1. Build the market normalizer (handle JSON strings, string→number conversion)
2. Implement the polling service with the recommended intervals
3. Create the simulated order matching engine using CLOB order book data
4. Add fee calculation logic (5% taker fee with 25% rebate)
