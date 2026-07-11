import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
function log(msg) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ${msg}`);
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
        "x-agent-platform": "polymarket_us",
        ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
    };
}
function getPublicHeaders() {
    return {
        "Content-Type": "application/json",
        "x-agent-secret": AGENT_SECRET,
        "x-agent-platform": "polymarket_us",
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
function json(data) {
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
const accountProps = {
    strategy_id: { type: "string", description: "Strategy name to isolate Polymarket US paper portfolios." },
};
function requireDestructiveResetConfirmation(args) {
    if (args.confirm_destructive_reset !== true) {
        throw new Error("init_account is destructive and requires confirm_destructive_reset=true. " +
            "Use portfolio/get_balance for normal account inspection.");
    }
}
const server = new Server({ name: "polymarket-us-paper-trader-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "init_account",
            description: "Initialize or reset a Polymarket US paper trading account with a starting balance.",
            inputSchema: {
                type: "object",
                properties: {
                    balance: { type: "number", description: "Starting USD balance, default 10000." },
                    confirm_destructive_reset: {
                        type: "boolean",
                        description: "Must be true to confirm wiping all paper trades, positions, and ledger entries.",
                    },
                    reset_reason: { type: "string", description: "Human-readable reason for the destructive reset." },
                    ...accountProps,
                },
                required: ["strategy_id", "confirm_destructive_reset"],
            },
        },
        {
            name: "get_balance",
            description: "Get Polymarket US strategy cash, positions value, total value, and P&L from server-side state.",
            inputSchema: { type: "object", properties: accountProps, required: ["strategy_id"] },
        },
        {
            name: "search_markets",
            description: "Search/list Polymarket US markets through the PolyTrader proxy API.",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query string." },
                    status: { type: "string", description: "Filter by market status." },
                    limit: { type: "number", description: "Max results to return." },
                    offset: { type: "number", description: "Pagination offset." },
                    tag_slug: { type: "string", description: "Filter by tag slug." },
                },
            },
        },
        {
            name: "get_market",
            description: "Get one Polymarket US market by slug with normalized YES/NO prices.",
            inputSchema: { type: "object", properties: { slug: { type: "string", description: "Market slug." } }, required: ["slug"] },
        },
        {
            name: "get_market_book",
            description: "Get the order book for a Polymarket US market.",
            inputSchema: {
                type: "object",
                properties: {
                    slug: { type: "string", description: "Market slug." },
                },
                required: ["slug"],
            },
        },
        {
            name: "get_events",
            description: "List Polymarket US events.",
            inputSchema: {
                type: "object",
                properties: {
                    status: { type: "string", description: "Filter by event status." },
                    limit: { type: "number", description: "Max results to return." },
                    offset: { type: "number", description: "Pagination offset." },
                },
            },
        },
        {
            name: "get_event",
            description: "Get details of a Polymarket US event by ID.",
            inputSchema: {
                type: "object",
                properties: {
                    event_id: { type: "string", description: "Event ID." },
                },
                required: ["event_id"],
            },
        },
        {
            name: "buy",
            description: "Buy YES or NO shares in a Polymarket US market. The server routes to paper simulation or real trading based on the registered strategy mode.",
            inputSchema: {
                type: "object",
                properties: {
                    slug: { type: "string", description: "Market slug." },
                    outcome: { type: "string", enum: ["YES", "NO"], description: "Outcome side." },
                    amount: { type: "number", description: "Dollar amount to spend." },
                    shares: { type: "number", description: "Optional exact shares to buy." },
                    price: { type: "number", description: "Optional override execution price, 0-1." },
                    ...accountProps,
                },
                required: ["slug", "strategy_id"],
            },
        },
        {
            name: "sell",
            description: "Sell Polymarket US shares by slug/outcome. The server routes to paper simulation or real trading based on the registered strategy mode.",
            inputSchema: {
                type: "object",
                properties: {
                    positionId: { type: "string", description: "Position ID to sell." },
                    slug: { type: "string", description: "Market slug." },
                    outcome: { type: "string", enum: ["YES", "NO"], description: "Outcome side." },
                    quantity: { anyOf: [{ type: "number" }, { type: "string", enum: ["ALL"] }], description: "Number of shares to sell, or 'ALL'." },
                    price: { type: "number", description: "Optional override execution price, 0-1." },
                    ...accountProps,
                },
                required: ["strategy_id"],
            },
        },
        {
            name: "portfolio",
            description: "Get the complete Polymarket US strategy portfolio including positions and trade history.",
            inputSchema: { type: "object", properties: accountProps, required: ["strategy_id"] },
        },
        {
            name: "history",
            description: "Get recent Polymarket US strategy trade history.",
            inputSchema: { type: "object", properties: { limit: { type: "number" }, ...accountProps }, required: ["strategy_id"] },
        },
        {
            name: "stats",
            description: "Summarize Polymarket US strategy trading performance.",
            inputSchema: { type: "object", properties: accountProps, required: ["strategy_id"] },
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
                                market: { type: "string", description: "Market slug" },
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
                required: ["trades"],
            },
        },
        // ── Agent Strategy ─────────────────────────────────────────────
        {
            name: "register_strategy",
            description: "Register a strategy identity on the server. Locks in agent_mode and platform; set is_paper_trading=false for real Polymarket US trading. Safe to call repeatedly (idempotent). Call this first on your initial run.",
            inputSchema: {
                type: "object",
                properties: {
                    strategy_id: { type: "string", description: "Stable strategy name, e.g. 'conservative_arb'" },
                    account_id: { type: "string", description: "Account ID, defaults to AGENT_USER_ID if not provided." },
                    is_paper_trading: { type: "boolean", description: "Whether to run in paper trading mode. Set false to register this strategy for real Polymarket US trading.", default: true },
                    platform: { type: "string", description: "Target platform: 'polymarket', 'kalshi', or 'polymarket_us'" },
                    balance: { type: "number", description: "Starting paper balance in USD" },
                },
                required: ["strategy_id"],
            },
        },
        {
            name: "get_strategy_context",
            description: "Get full strategy context including registration state, portfolio, positions, recent trades, and reports. Use this at the start of every run to check if setup is needed and to restore cross-session state.",
            inputSchema: {
                type: "object",
                properties: {
                    strategy_id: { type: "string", description: "Strategy name to get context for" },
                },
                required: ["strategy_id"],
            },
        },
        {
            name: "cancel_real_order",
            description: "Cancel a real Polymarket US order by local real_trade_orders UUID.",
            inputSchema: {
                type: "object",
                properties: {
                    order_id: { type: "string", description: "Local real_trade_orders UUID" },
                    strategy_id: { type: "string", description: "Registered strategy name" },
                },
                required: ["order_id"],
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
            const data = await callPolyTrader(`/polymarket-us/portfolio?balance=${encodeURIComponent(String(balance))}`, {
                method: "DELETE",
                headers: getAgentHeaders(args),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        case "get_balance":
        case "portfolio": {
            const data = await callPolyTrader("/polymarket-us/portfolio", { headers: getAgentHeaders(args) });
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
            const query = args.query;
            // If a query string is provided, use the search endpoint; otherwise use the markets listing endpoint
            if (query) {
                const params = new URLSearchParams();
                params.set("query", String(query));
                for (const key of ["status", "limit", "offset", "tag_slug"]) {
                    const value = args[key];
                    if (value !== undefined)
                        params.set(key, String(value));
                }
                const data = await callPolyTrader(`/polymarket-us/search?${params.toString()}`, {
                    headers: getPublicHeaders(),
                });
                return json({ ok: true, data });
            }
            else {
                const params = new URLSearchParams();
                for (const key of ["status", "limit", "offset", "tag_slug"]) {
                    const value = args[key];
                    if (value !== undefined)
                        params.set(key, String(value));
                }
                const data = await callPolyTrader(`/polymarket-us/markets?${params.toString()}`, {
                    headers: getPublicHeaders(),
                });
                return json({ ok: true, data });
            }
        }
        case "get_market": {
            const data = await callPolyTrader(`/polymarket-us/markets/${encodeURIComponent(String(args.slug))}`, {
                headers: getPublicHeaders(),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        case "get_market_book": {
            const data = await callPolyTrader(`/polymarket-us/markets/${encodeURIComponent(String(args.slug))}/book`, {
                headers: getPublicHeaders(),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        case "get_events": {
            const params = new URLSearchParams();
            for (const key of ["status", "limit", "offset"]) {
                const value = args[key];
                if (value !== undefined)
                    params.set(key, String(value));
            }
            const data = await callPolyTrader(`/polymarket-us/events?${params.toString()}`, {
                headers: getPublicHeaders(),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        case "get_event": {
            const eventId = encodeURIComponent(String(args.event_id));
            const data = await callPolyTrader(`/polymarket-us/events/${eventId}`, {
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
                    slug: args.slug,
                    outcome: args.outcome || "YES",
                    side: "BUY",
                    amount: args.amount,
                    shares: args.shares,
                    price: args.price,
                    client_order_id: idempotencyKey,
                }),
            });
            return json({ ok: true, data: data.data ?? data, idempotency_key: idempotencyKey });
        }
        case "sell": {
            const idempotencyKey = generateIdempotencyKey();
            const quantity = args.quantity || "ALL";
            const data = await callPolyTrader("/agent/trades", {
                method: "POST",
                headers: getAgentHeaders(args, idempotencyKey),
                body: JSON.stringify({
                    strategy_id: args.strategy_id,
                    slug: args.slug,
                    outcome: args.outcome || "YES",
                    side: "SELL",
                    shares: typeof quantity === "number" ? quantity : undefined,
                    price: args.price,
                    client_order_id: idempotencyKey,
                }),
            });
            return json({ ok: true, data: data.data ?? data, idempotency_key: idempotencyKey });
        }
        case "history": {
            const data = await callPolyTrader("/polymarket-us/portfolio", { headers: getAgentHeaders(args) });
            const limit = Number(args.limit || 50);
            return json({ ok: true, data: (data.data?.tradeHistory || []).slice(0, limit) });
        }
        case "stats": {
            const data = await callPolyTrader("/polymarket-us/portfolio", { headers: getAgentHeaders(args) });
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
        // ── Agent Reports (Retro) ──────────────────────────────────────
        case "save_report": {
            const strategy_id = String(args.strategy_id);
            const content = String(args.content);
            const filename = String(args.filename);
            if (!strategy_id || !content || !filename) {
                throw new Error("Missing required fields: strategy_id, content, filename");
            }
            const data = await callPolyTrader("/reports", {
                method: "POST",
                headers: getAgentHeaders(args),
                body: JSON.stringify({ strategy_id, content, filename }),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        case "list_reports": {
            const strategy_id = String(args.strategy_id);
            if (!strategy_id)
                throw new Error("Missing required field: account");
            const limit = Number(args.limit || 3);
            const data = await callPolyTrader(`/reports?strategy_id=${encodeURIComponent(strategy_id)}&limit=${limit}`, { headers: getAgentHeaders(args) });
            return json({ ok: true, data: data.data ?? data });
        }
        case "read_report": {
            const strategy_id = String(args.strategy_id);
            const filename = String(args.filename);
            if (!strategy_id || !filename)
                throw new Error("Missing required fields: account, filename");
            const data = await callPolyTrader(`/reports/${encodeURIComponent(filename)}?strategy_id=${encodeURIComponent(strategy_id)}`, { headers: getAgentHeaders(args) });
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
                body: JSON.stringify({ platform: "polymarket_us", trades, balance: startingBalance }),
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
                    platform: args.platform || "polymarket_us",
                    balance: Number(args.balance || 10000),
                }),
            });
            return json({ ok: true, data: data.data ?? data });
        }
        case "get_strategy_context": {
            const strategy_id = String(args.strategy_id);
            if (!strategy_id)
                throw new Error("Missing required field: strategy_id");
            const data = await callPolyTrader(`/agent/context?strategy_id=${encodeURIComponent(strategy_id)}`, { headers: getAgentHeaders(args) });
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
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
