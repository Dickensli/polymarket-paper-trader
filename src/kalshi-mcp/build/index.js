import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
function log(msg) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ${msg}`);
    try {
        fs.appendFileSync('/tmp/kalshi-mcp-debug.log', `[${timestamp}] ${msg}\n`);
    }
    catch (e) { }
}
const STRATEGY_WHITELIST_RAW = process.env.STRATEGY_WHITELIST;
if (!STRATEGY_WHITELIST_RAW) {
    log("FATAL ERROR: STRATEGY_WHITELIST environment variable is required.");
    process.exit(1);
}
const whitelist = STRATEGY_WHITELIST_RAW.split(",").map(s => s.trim()).filter(Boolean);
if (whitelist.length === 0) {
    log("FATAL ERROR: STRATEGY_WHITELIST environment variable cannot be empty.");
    process.exit(1);
}
log(`[Harness] Whitelist initialized with strategies: ${JSON.stringify(whitelist)}`);
const POLYTRADER_API_URL = process.env.POLYTRADER_API_URL || "http://localhost:3000/api";
const KALSHI_BASE_URL = process.env.KALSHI_MARKET_DATA_BASE_URL || process.env.KALSHI_BASE_URL || (process.env.KALSHI_MARKET_DATA_ENV?.toLowerCase() === "demo"
    ? "https://demo-api.kalshi.co/trade-api/v2"
    : "https://external-api.kalshi.com/trade-api/v2");
const AGENT_USER_ID = process.env.AGENT_USER_ID || "815c03ff-dad9-4535-a427-20422812424a";
const AGENT_SECRET = process.env.AGENT_SECRET || "default_secret_key_123";
function generateIdempotencyKey() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
function getAgentHeaders(args, idempotencyKey) {
    const strategyId = typeof args?.strategy_id === "string" ? args.strategy_id :
        (typeof args?.account === "string" ? args.account : "default");
    const accountId = AGENT_USER_ID;
    return {
        "Content-Type": "application/json",
        "x-agent-secret": AGENT_SECRET,
        "x-agent-account-id": accountId,
        "x-agent-strategy-id": strategyId,
        "x-agent-platform": "kalshi",
        ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
    };
}
function getPublicHeaders() {
    return {
        "Content-Type": "application/json",
        "x-agent-secret": AGENT_SECRET,
        "x-agent-platform": "kalshi",
    };
}
async function callPolyTrader(path, init = {}) {
    const res = await fetch(`${POLYTRADER_API_URL}${path}`, init);
    const text = await res.text();
    let body;
    try {
        body = text ? JSON.parse(text) : {};
    }
    catch {
        body = text;
    }
    if (!res.ok) {
        throw new Error(`PolyTrader API ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    }
    return body;
}
async function callKalshiPublic(path) {
    const res = await fetch(`${KALSHI_BASE_URL}${path}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok)
        throw new Error(`Kalshi public API ${res.status}: ${text}`);
    return body;
}
function json(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
const accountProps = {
    strategy_id: { type: "string", description: "Strategy name to isolate Kalshi paper portfolios." },
};
const proposalSchema = {
    type: "object",
    description: "Structured entry thesis audited against fresh server quotes. Required for BUY orders.",
    properties: {
        thesis: { type: "string" },
        rules_verified: { type: "boolean", const: true },
        source_urls: { type: "array", items: { type: "string" }, minItems: 1 },
        fair_probability: { type: "number", minimum: 0.001, maximum: 0.999 },
        confidence_low: { type: "number", minimum: 0, maximum: 1 },
        confidence_high: { type: "number", minimum: 0, maximum: 1 },
        quote_observed_at: { type: "string", description: "Fresh ISO-8601 timestamp." },
        observed_price: { type: "number", minimum: 0.001, maximum: 0.999 },
        available_depth: { type: "number", exclusiveMinimum: 0 },
        net_edge: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        proposed_nav_pct: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        exit_condition: { type: "string" },
        invalidation_condition: { type: "string" },
    },
    required: ["thesis", "rules_verified", "source_urls", "fair_probability", "confidence_low", "confidence_high", "quote_observed_at", "observed_price", "available_depth", "net_edge", "proposed_nav_pct", "exit_condition", "invalidation_condition"],
};
function requireDestructiveResetConfirmation(args) {
    if (args.confirm_destructive_reset !== true) {
        throw new Error("init_account is destructive and requires confirm_destructive_reset=true. " +
            "Use portfolio/get_balance for normal account inspection.");
    }
    const resetSecret = process.env.AGENT_RESET_SECRET;
    if (!resetSecret || args.reset_authorization !== resetSecret) {
        throw new Error("init_account requires a valid, human-issued reset_authorization token.");
    }
}
const server = new Server({ name: "kalshi-paper-trader-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "init_account",
            description: "Initialize or reset a Kalshi paper trading account with a starting balance.",
            inputSchema: {
                type: "object",
                properties: {
                    balance: { type: "number", description: "Starting USD balance, default 10000." },
                    confirm_destructive_reset: {
                        type: "boolean",
                        description: "Must be true to confirm wiping all paper trades, positions, and ledger entries.",
                    },
                    reset_reason: { type: "string", description: "Human-readable reason for the destructive reset." },
                    reset_authorization: { type: "string", description: "Short-lived human-issued authorization matching the server reset secret." },
                    ...accountProps,
                },
                required: ["strategy_id", "confirm_destructive_reset", "reset_reason", "reset_authorization"],
            },
        },
        {
            name: "get_balance",
            description: "Get Kalshi strategy cash, positions value, total value, and P&L from server-side state.",
            inputSchema: { type: "object", properties: accountProps, required: ["strategy_id"] },
        },
        {
            name: "search_markets",
            description: "Search/list Kalshi markets. Prefer series_ticker or event_ticker for precise filtering; use search only when the series ticker is unknown. Always set mve_filter='exclude' unless you specifically need multivariate/combo markets.",
            inputSchema: {
                type: "object",
                properties: {
                    search: { type: "string", description: "Full-text keyword search. Noisy — prefer series_ticker when possible." },
                    series_ticker: { type: "string", description: "Filter by series ticker (e.g. KXFED, KXCPI, KXINX, KXBTC). Preferred over text search for precision." },
                    event_ticker: { type: "string", description: "Filter by event ticker." },
                    tickers: { type: "string", description: "Comma-separated list of specific market tickers to fetch." },
                    status: { type: "string", description: "Filter by status: unopened, open, closed, settled" },
                    mve_filter: { type: "string", enum: ["exclude", "only"], description: "'exclude' removes multivariate/esports combo markets (recommended). 'only' returns only MVE markets." },
                    min_close_ts: { type: "number", description: "Filter markets closing after this Unix timestamp (seconds). Find near-expiry markets." },
                    max_close_ts: { type: "number", description: "Filter markets closing before this Unix timestamp (seconds)." },
                    limit: { type: "number" },
                    cursor: { type: "string" },
                },
            },
        },
        {
            name: "get_market",
            description: "Get one Kalshi market ticker and normalized YES/NO prices.",
            inputSchema: { type: "object", properties: { ticker: { type: "string" } }, required: ["ticker"] },
        },
        {
            name: "buy",
            description: "Buy YES or NO shares in a Kalshi market. MARKET ORDERS ONLY. You MUST NOT specify a limit price. Limit orders are strictly forbidden. The server routes to paper simulation or Kalshi real trading based on the registered strategy mode.",
            inputSchema: {
                type: "object",
                properties: {
                    ticker: { type: "string" },
                    outcome: { type: "string", enum: ["YES", "NO"] },
                    amount: { type: "number", description: "Dollar amount to spend." },
                    shares: { type: "number", description: "Optional exact shares to buy." },
                    proposal: proposalSchema,
                    ...accountProps,
                },
                required: ["ticker", "strategy_id", "proposal"],
            },
        },
        {
            name: "sell",
            description: "Sell Kalshi shares by ticker/outcome. MARKET ORDERS ONLY. You MUST NOT specify a limit price. Limit orders are strictly forbidden. The server routes to paper simulation or Kalshi real trading based on the registered strategy mode.",
            inputSchema: {
                type: "object",
                properties: {
                    ticker: { type: "string" },
                    outcome: { type: "string", enum: ["YES", "NO"] },
                    quantity: { type: "number", description: "Explicit shares to sell." },
                    ...accountProps,
                },
                required: ["ticker", "outcome", "quantity", "strategy_id"],
            },
        },
        {
            name: "portfolio",
            description: "Get the complete Kalshi strategy portfolio including positions and trade history.",
            inputSchema: { type: "object", properties: accountProps, required: ["strategy_id"] },
        },
        {
            name: "history",
            description: "Get recent Kalshi strategy trade history.",
            inputSchema: { type: "object", properties: { limit: { type: "number" }, ...accountProps }, required: ["strategy_id"] },
        },
        {
            name: "stats",
            description: "Summarize Kalshi strategy trading performance.",
            inputSchema: { type: "object", properties: accountProps, required: ["strategy_id"] },
        },
        {
            name: "get_candlesticks",
            description: "Get price candlestick data for a Kalshi market. Returns OHLC data.",
            inputSchema: {
                type: "object",
                properties: {
                    ticker: { type: "string", description: "Market ticker." },
                    period_interval: { type: "number", description: "Candle period in minutes. Valid: 1, 60, 1440. Default 60." },
                    start_ts: { type: "number", description: "Start timestamp (unix seconds)." },
                    end_ts: { type: "number", description: "End timestamp (unix seconds)." },
                },
                required: ["ticker"],
            },
        },
        {
            name: "get_orderbook",
            description: "Get an outcome-normalized executable order book for a Kalshi market.",
            inputSchema: {
                type: "object",
                properties: {
                    ticker: { type: "string", description: "Market ticker." },
                    outcome: { type: "string", enum: ["YES", "NO"], description: "Outcome book to normalize." },
                },
                required: ["ticker", "outcome"],
            },
        },
        {
            name: "get_event",
            description: "Get details of a Kalshi event (which contains multiple markets). Use with_nested_markets=true to include all markets in a single call.",
            inputSchema: {
                type: "object",
                properties: {
                    event_ticker: { type: "string", description: "Event ticker." },
                    with_nested_markets: { type: "boolean", description: "If true, include all markets within the event response. Saves extra API calls. Default false." },
                },
                required: ["event_ticker"],
            },
        },
        {
            name: "search_events",
            description: "Search/list Kalshi events. Use series_ticker for structured discovery. Excludes multivariate events by default — use GET /events/multivariate for those.",
            inputSchema: {
                type: "object",
                properties: {
                    search: { type: "string", description: "Full-text keyword search for events." },
                    status: { type: "string", description: "Filter by event status: unopened, open, closed, settled." },
                    series_ticker: { type: "string", description: "Filter by series ticker." },
                    tickers: { type: "string", description: "Comma-separated list of specific event tickers to fetch." },
                    with_nested_markets: { type: "boolean", description: "If true, include all markets within each event. Default false." },
                    min_close_ts: { type: "number", description: "Filter events with markets closing after this Unix timestamp." },
                    limit: { type: "number", description: "Max results to return (max 200)." },
                    cursor: { type: "string", description: "Pagination cursor." },
                },
            },
        },
        {
            name: "list_series",
            description: "List available Kalshi series. Use this to discover series tickers (e.g. KXFED, KXCPI, KXINX) before searching for markets. Filter by category for targeted discovery.",
            inputSchema: {
                type: "object",
                properties: {
                    category: { type: "string", description: "Filter by category name (e.g. 'Economics', 'Politics', 'Crypto', 'Weather')." },
                    tags: { type: "string", description: "Filter by tags." },
                    include_volume: { type: "boolean", description: "If true, includes total volume traded across all events in each series. Helps prioritize liquid markets." },
                    include_product_metadata: { type: "boolean", description: "If true, includes settlement source info." },
                    limit: { type: "number", description: "Max results to return." },
                    cursor: { type: "string", description: "Pagination cursor." },
                },
            },
        },
        {
            name: "get_public_trades",
            description: "Get recent public trades for a Kalshi market. Use min_ts to filter to recent activity.",
            inputSchema: {
                type: "object",
                properties: {
                    ticker: { type: "string", description: "Market ticker to filter trades." },
                    min_ts: { type: "number", description: "Filter trades after this Unix timestamp (seconds). Useful for recent activity." },
                    max_ts: { type: "number", description: "Filter trades before this Unix timestamp (seconds)." },
                    limit: { type: "number", description: "Max results to return (max 1000)." },
                    cursor: { type: "string", description: "Pagination cursor." },
                },
            },
        },
        // ── Agent Reports (Retro) ──────────────────────────────────────
        {
            name: "save_report",
            description: "Save a trading session report for later retrieval. Use at the end of every session to persist strategy reflections, lessons learned, and next steps.",
            inputSchema: {
                type: "object",
                properties: {
                    content: { type: "string", description: "Markdown report content" },
                    filename: { type: "string", description: "Report filename, e.g. 2026-07-02T14:00:00.md" },
                    ...accountProps,
                },
                required: ["strategy_id", "content", "filename"],
            },
        },
        {
            name: "list_reports",
            description: "List recent session reports for a strategy account. Use during bootstrap to find the latest report to read.",
            inputSchema: {
                type: "object",
                properties: {
                    limit: { type: "number", description: "Max reports to return (default 3)" },
                    ...accountProps,
                },
                required: ["strategy_id"],
            },
        },
        {
            name: "read_report",
            description: "Read the full content of a specific session report. Use during bootstrap to restore strategy context from the previous session.",
            inputSchema: {
                type: "object",
                properties: {
                    filename: { type: "string", description: "Report filename to read" },
                    ...accountProps,
                },
                required: ["strategy_id", "filename"],
            },
        },
        // ── Backtesting ────────────────────────────────────────────────
        {
            name: "backtest",
            description: "Run a what-if backtest replay. Provide a set of hypothetical trades with entry/exit prices to compute simulated P&L, ROI, Sharpe ratio, win rate, and max drawdown.",
            inputSchema: {
                type: "object",
                properties: {
                    trades: {
                        type: "array",
                        description: "Array of hypothetical trades to simulate.",
                        items: {
                            type: "object",
                            properties: {
                                market: { type: "string", description: "Market ticker" },
                                outcome: { type: "string", enum: ["YES", "NO"], description: "Outcome side" },
                                side: { type: "string", enum: ["BUY", "SELL"], description: "Trade direction" },
                                amount: { type: "number", description: "USD amount" },
                                entry_price: { type: "number", description: "Entry price (0-1)" },
                                exit_price: { type: "number", description: "Exit price (0-1)" },
                            },
                            required: ["market", "outcome", "amount", "entry_price", "exit_price"],
                        },
                    },
                    balance: { type: "number", description: "Starting balance (default 10000)" },
                    ...accountProps,
                },
                required: ["strategy_id", "trades"],
            },
        },
        // ── Agent Strategy ─────────────────────────────────────────────
        {
            name: "register_strategy",
            description: "Register a strategy identity on the server. Locks in agent_mode and platform; set is_paper_trading=false for real Kalshi trading. Safe to call repeatedly (idempotent). Call this first on your initial run.",
            inputSchema: {
                type: "object",
                properties: {
                    strategy_id: { type: "string", description: "Stable strategy name, e.g. 'conservative_arb'" },
                    is_paper_trading: { type: "boolean", description: "Whether to run in paper trading mode. Set false to register this strategy for real Kalshi trading.", default: true },
                    platform: { type: "string", description: "Target platform: 'polymarket', 'kalshi', or 'polymarket_us'", default: "kalshi" },
                    balance: { type: "number", description: "Starting paper balance in USD", default: 10000 },
                    risk_config: { type: "object", description: "Server-enforced risk ratios, e.g. max_single_trade_pct, max_market_exposure_pct, min_cash_reserve_pct" },
                    schedule: { type: "string", description: "Cron schedule recorded for strategy auditing" },
                },
                required: ["strategy_id"],
            },
        },
        {
            name: "get_strategy_context",
            description: "Get authoritative current strategy context including registration, portfolio, positions, and recent trades. Trading bootstrap intentionally excludes prior reports because reports are output-only audit artifacts.",
            inputSchema: {
                type: "object",
                properties: {
                    strategy_id: { type: "string", description: "Strategy name to get context for" },
                },
                required: ["strategy_id"],
            },
        },
        {
            name: "get_graduation_status",
            description: "Read the server-computed Kalshi shadow graduation scorecard. This notification-only scorecard never blocks or pauses paper trading and never enables real trading automatically.",
            inputSchema: {
                type: "object",
                properties: {
                    strategy_id: { type: "string", description: "The currently assigned strategy ID." },
                    source_strategy_id: { type: "string", description: "Optional paper strategy whose scorecard backs a real strategy." },
                },
                required: ["strategy_id"],
            },
        },
        {
            name: "cancel_real_order",
            description: "Cancel a real Kalshi order by local real_trade_orders UUID.",
            inputSchema: {
                type: "object",
                properties: {
                    order_id: { type: "string", description: "Local real_trade_orders UUID" },
                    strategy_id: { type: "string", description: "Registered strategy name" },
                },
                required: ["order_id", "strategy_id"],
            },
        },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    switch (name) {
        case "init_account": {
            requireDestructiveResetConfirmation(args);
            const balance = Number(args.balance || 10000);
            const data = await callPolyTrader(`/kalshi/portfolio?balance=${encodeURIComponent(String(balance))}`, {
                method: "DELETE",
                headers: getAgentHeaders(args),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        case "get_balance":
        case "portfolio": {
            const data = await callPolyTrader("/kalshi/portfolio", { headers: getAgentHeaders(args) });
            const portfolio = data.data ?? data;
            if (name === "portfolio")
                return json({ ok: true, data: portfolio });
            return json({
                ok: true,
                data: {
                    cash: portfolio.balance,
                    positions_value: Number((portfolio.totalValue - portfolio.balance).toFixed(2)),
                    total_value: portfolio.totalValue,
                    pnl: portfolio.totalPnL,
                    pnl_percent: portfolio.totalPnLPercent,
                    open_positions: portfolio.positions?.length || 0,
                },
            });
        }
        case "search_markets": {
            const params = new URLSearchParams();
            for (const key of ["search", "series_ticker", "event_ticker", "tickers", "status", "mve_filter", "min_close_ts", "max_close_ts", "limit", "cursor"]) {
                let value = args[key];
                if (value !== undefined) {
                    if (key === "status" && String(value).toLowerCase() === "active") {
                        value = "open";
                    }
                    params.set(key, String(value));
                }
            }
            const data = await callPolyTrader(`/kalshi/markets?${params.toString()}`, {
                headers: getPublicHeaders(),
            });
            return json({ ok: true, data });
        }
        case "get_market": {
            const data = await callPolyTrader(`/kalshi/markets/${encodeURIComponent(String(args.ticker))}`, {
                headers: getPublicHeaders(),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        case "buy": {
            const idempotencyKey = generateIdempotencyKey();
            const data = await callPolyTrader("/agent/trades", {
                method: "POST",
                headers: getAgentHeaders(args, idempotencyKey),
                body: JSON.stringify({
                    strategy_id: args.strategy_id,
                    slug: args.ticker || args.slug,
                    outcome: args.outcome || "YES",
                    side: "BUY",
                    amount: args.amount,
                    shares: args.shares,
                    proposal: args.proposal,
                    time_in_force: "FOK",
                    client_order_id: idempotencyKey,
                }),
            });
            return json({ ok: true, data: data.data ?? data, idempotency_key: idempotencyKey });
        }
        case "sell": {
            const idempotencyKey = generateIdempotencyKey();
            const quantity = Number(args.quantity);
            if (!Number.isFinite(quantity) || quantity <= 0) {
                throw new Error("sell requires an explicit positive numeric quantity");
            }
            const data = await callPolyTrader("/agent/trades", {
                method: "POST",
                headers: getAgentHeaders(args, idempotencyKey),
                body: JSON.stringify({
                    strategy_id: args.strategy_id,
                    slug: args.ticker,
                    outcome: args.outcome || "YES",
                    side: "SELL",
                    shares: quantity,
                    client_order_id: idempotencyKey,
                }),
            });
            return json({ ok: true, data: data.data ?? data, idempotency_key: idempotencyKey });
        }
        case "history": {
            const data = await callPolyTrader("/kalshi/portfolio", { headers: getAgentHeaders(args) });
            const limit = Number(args.limit || 50);
            return json({ ok: true, data: (data.data?.tradeHistory || []).slice(0, limit) });
        }
        case "stats": {
            const data = await callPolyTrader("/kalshi/portfolio", { headers: getAgentHeaders(args) });
            const portfolio = data.data ?? data;
            const trades = portfolio.tradeHistory || [];
            return json({
                ok: true,
                data: {
                    total_value: portfolio.totalValue,
                    cash: portfolio.balance,
                    pnl: portfolio.totalPnL,
                    pnl_percent: portfolio.totalPnLPercent,
                    open_positions: portfolio.positions?.length || 0,
                    total_trades: trades.length,
                    buy_count: trades.filter((t) => t.side === "BUY").length,
                    sell_count: trades.filter((t) => t.side === "SELL").length,
                },
            });
        }
        case "get_candlesticks": {
            const ticker = encodeURIComponent(String(args.ticker));
            const params = new URLSearchParams();
            params.set("period_interval", String(args.period_interval || 60));
            if (args.start_ts !== undefined)
                params.set("start_ts", String(args.start_ts));
            if (args.end_ts !== undefined)
                params.set("end_ts", String(args.end_ts));
            const data = await callPolyTrader(`/kalshi/markets/${ticker}/candlesticks?${params.toString()}`, {
                headers: getPublicHeaders(),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        case "get_orderbook": {
            const ticker = encodeURIComponent(String(args.ticker));
            const outcome = encodeURIComponent(String(args.outcome));
            const data = await callPolyTrader(`/kalshi/markets/${ticker}/orderbook?outcome=${outcome}`, {
                headers: getPublicHeaders(),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        case "get_event": {
            const eventTicker = encodeURIComponent(String(args.event_ticker));
            const params = new URLSearchParams();
            if (args.with_nested_markets !== undefined)
                params.set("with_nested_markets", String(args.with_nested_markets));
            const data = await callKalshiPublic(`/events/${eventTicker}?${params.toString()}`);
            return json({ ok: true, data });
        }
        case "search_events": {
            const params = new URLSearchParams();
            for (const key of ["search", "status", "series_ticker", "tickers", "with_nested_markets", "min_close_ts", "limit", "cursor"]) {
                const value = args[key];
                if (value !== undefined)
                    params.set(key, String(value));
            }
            const data = await callKalshiPublic(`/events?${params.toString()}`);
            return json({ ok: true, data });
        }
        case "list_series": {
            const params = new URLSearchParams();
            for (const key of ["category", "tags", "include_volume", "include_product_metadata", "limit", "cursor"]) {
                const value = args[key];
                if (value !== undefined)
                    params.set(key, String(value));
            }
            const data = await callKalshiPublic(`/series?${params.toString()}`);
            return json({ ok: true, data });
        }
        case "get_public_trades": {
            const params = new URLSearchParams();
            for (const key of ["ticker", "min_ts", "max_ts", "limit", "cursor"]) {
                const value = args[key];
                if (value !== undefined)
                    params.set(key, String(value));
            }
            const data = await callKalshiPublic(`/markets/trades?${params.toString()}`);
            return json({ ok: true, data });
        }
        // ── Agent Reports (Retro) ──────────────────────────────────────
        case "save_report": {
            const strategy_id = String(args.strategy_id || args.account);
            const content = String(args.content);
            const filename = String(args.filename);
            if (!strategy_id || strategy_id === "undefined" || !content || !filename) {
                throw new Error("Missing required fields: strategy_id/account, content, filename");
            }
            const data = await callPolyTrader("/agent/reports", {
                method: "POST",
                headers: getAgentHeaders(args),
                body: JSON.stringify({ strategy_id, content, filename }),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        case "list_reports": {
            const strategy_id = String(args.strategy_id || args.account);
            if (!strategy_id || strategy_id === "undefined")
                throw new Error("Missing required field: account");
            const limit = Number(args.limit || 3);
            const data = await callPolyTrader(`/agent/reports?strategy_id=${encodeURIComponent(strategy_id)}&limit=${limit}`, { headers: getAgentHeaders(args) });
            return json({ ok: true, data: data.data ?? data });
        }
        case "read_report": {
            const strategy_id = String(args.strategy_id || args.account);
            const filename = String(args.filename);
            if (!strategy_id || strategy_id === "undefined" || !filename)
                throw new Error("Missing required fields: account, filename");
            const data = await callPolyTrader(`/agent/reports?strategy_id=${encodeURIComponent(strategy_id)}&filename=${encodeURIComponent(filename)}`, { headers: getAgentHeaders(args) });
            return json({ ok: true, data: data.data ?? data });
        }
        // ── Backtesting ────────────────────────────────────────────────
        case "backtest": {
            const trades = args.trades;
            const startingBalance = Number(args.balance || 10000);
            if (!Array.isArray(trades) || trades.length === 0) {
                throw new Error("trades must be a non-empty array");
            }
            const data = await callPolyTrader("/backtest", {
                method: "POST",
                headers: getAgentHeaders(args),
                body: JSON.stringify({ platform: "kalshi", trades, balance: startingBalance }),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        // ── Agent Strategy ─────────────────────────────────────────────
        case "register_strategy": {
            const strategy_id = String(args.strategy_id);
            if (!strategy_id)
                throw new Error("Missing required field: strategy_id");
            if (!whitelist.includes(strategy_id)) {
                throw new Error(`[Harness] Strategy ID '${strategy_id}' is not in the allowed STRATEGY_WHITELIST: ${whitelist.join(', ')}.`);
            }
            const account_id = String(args.account_id || AGENT_USER_ID);
            const data = await callPolyTrader("/agent/strategies/register", {
                method: "POST",
                headers: getAgentHeaders(args),
                body: JSON.stringify({
                    strategy_id,
                    account_id,
                    is_paper_trading: args.is_paper_trading !== false,
                    platform: "kalshi",
                    balance: Number(args.balance || 10000),
                    risk_config: args.risk_config,
                    schedule: args.schedule,
                }),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        case "get_strategy_context": {
            const strategy_id = String(args.strategy_id);
            if (!strategy_id)
                throw new Error("Missing required field: strategy_id");
            const data = await callPolyTrader(`/agent/context?strategy_id=${encodeURIComponent(strategy_id)}&start_run=true&trigger_id=${encodeURIComponent(`smith:${strategy_id}`)}`, { headers: getAgentHeaders(args) });
            return json({ ok: true, data: data.data ?? data });
        }
        case "get_graduation_status": {
            const strategy_id = String(args.strategy_id);
            const source = args.source_strategy_id;
            if (!strategy_id)
                throw new Error("Missing required field: strategy_id");
            const params = new URLSearchParams({ strategy_id });
            if (source)
                params.set("source_strategy_id", String(source));
            const data = await callPolyTrader(`/agent/graduation?${params.toString()}`, {
                headers: getAgentHeaders(args),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        case "cancel_real_order": {
            const orderId = String(args.order_id);
            if (!orderId)
                throw new Error("Missing required field: order_id");
            const data = await callPolyTrader(`/agent/real-orders/${encodeURIComponent(orderId)}/cancel`, {
                method: "POST",
                headers: getAgentHeaders(args),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
});
async function main() {
    log("Starting Kalshi MCP server...");
    process.stdin.on("close", () => {
        log("Stdin closed, exiting...");
        process.exit(0);
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log("Server connected and running.");
    // Keep alive
    await new Promise(() => { });
}
main().catch((err) => {
    log(`Server Fatal Error: ${err.message}`);
    process.exit(1);
});
