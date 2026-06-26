import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
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
    const account = typeof args?.account === "string" ? args.account : "default";
    const userId = typeof args?.agent_user_id === "string" ? args.agent_user_id : AGENT_USER_ID;
    return {
        "Content-Type": "application/json",
        "x-agent-secret": AGENT_SECRET,
        "x-agent-user-id": userId,
        "x-agent-account": account,
        "x-agent-platform": "kalshi",
        ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
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
    account: { type: "string", description: "Strategy/profile name to isolate Kalshi paper portfolios." },
    agent_user_id: { type: "string", description: "Optional agent user ID override." },
};
const server = new Server({ name: "kalshi-paper-trader-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: "init_account",
            description: "Initialize or reset a Kalshi paper trading account with a starting balance.",
            inputSchema: {
                type: "object",
                properties: { balance: { type: "number", description: "Starting USD balance, default 10000." }, ...accountProps },
                required: ["account"],
            },
        },
        {
            name: "get_balance",
            description: "Get Kalshi paper cash, positions value, total value, and P&L.",
            inputSchema: { type: "object", properties: accountProps, required: ["account"] },
        },
        {
            name: "search_markets",
            description: "Search/list Kalshi markets through the PolyTrader Kalshi proxy API.",
            inputSchema: {
                type: "object",
                properties: {
                    search: { type: "string" },
                    status: { type: "string" },
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
            description: "Buy YES or NO shares in a Kalshi paper market.",
            inputSchema: {
                type: "object",
                properties: {
                    ticker: { type: "string" },
                    outcome: { type: "string", enum: ["YES", "NO"] },
                    amount: { type: "number", description: "Dollar amount to spend." },
                    shares: { type: "number", description: "Optional exact shares to buy." },
                    price: { type: "number", description: "Optional override execution price, 0-1." },
                    ...accountProps,
                },
                required: ["ticker", "account"],
            },
        },
        {
            name: "sell",
            description: "Sell Kalshi paper shares by positionId or ticker/outcome.",
            inputSchema: {
                type: "object",
                properties: {
                    positionId: { type: "string" },
                    ticker: { type: "string" },
                    outcome: { type: "string", enum: ["YES", "NO"] },
                    quantity: { anyOf: [{ type: "number" }, { type: "string", enum: ["ALL"] }] },
                    price: { type: "number", description: "Optional override execution price, 0-1." },
                    ...accountProps,
                },
                required: ["account"],
            },
        },
        {
            name: "portfolio",
            description: "Get the complete Kalshi paper portfolio including positions and trade history.",
            inputSchema: { type: "object", properties: accountProps, required: ["account"] },
        },
        {
            name: "history",
            description: "Get recent Kalshi paper trade history.",
            inputSchema: { type: "object", properties: { limit: { type: "number" }, ...accountProps }, required: ["account"] },
        },
        {
            name: "stats",
            description: "Summarize Kalshi paper trading performance.",
            inputSchema: { type: "object", properties: accountProps, required: ["account"] },
        },
    ],
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    switch (name) {
        case "init_account": {
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
            for (const key of ["search", "status", "limit", "cursor"]) {
                const value = args[key];
                if (value !== undefined)
                    params.set(key, String(value));
            }
            const data = await callPolyTrader(`/kalshi/markets?${params.toString()}`);
            return json({ ok: true, data });
        }
        case "get_market": {
            const data = await callPolyTrader(`/kalshi/markets/${encodeURIComponent(String(args.ticker))}`);
            return json({ ok: true, data: data.data ?? data });
        }
        case "buy": {
            const idempotencyKey = generateIdempotencyKey();
            const data = await callPolyTrader("/kalshi/trade/buy", {
                method: "POST",
                headers: getAgentHeaders(args, idempotencyKey),
                body: JSON.stringify({
                    ticker: args.ticker,
                    outcome: args.outcome || "YES",
                    amount: args.amount,
                    shares: args.shares,
                    price: args.price,
                }),
            });
            return json({ ok: true, data: data.data ?? data, idempotency_key: idempotencyKey });
        }
        case "sell": {
            const idempotencyKey = generateIdempotencyKey();
            const data = await callPolyTrader("/kalshi/trade/sell", {
                method: "POST",
                headers: getAgentHeaders(args, idempotencyKey),
                body: JSON.stringify({
                    positionId: args.positionId,
                    ticker: args.ticker,
                    outcome: args.outcome || "YES",
                    quantity: args.quantity || "ALL",
                    price: args.price,
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
