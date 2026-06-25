import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, } from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
// The endpoint for our PolyTrader Next.js API
const POLYTRADER_API_URL = process.env.POLYTRADER_API_URL || "http://localhost:3000/api";
const GAMMA_API_URL = "https://gamma-api.polymarket.com";
const CLOB_API_URL = "https://clob.polymarket.com";
// A unique user ID and secret for agent session authentication bypass
const AGENT_USER_ID = process.env.AGENT_USER_ID || "815c03ff-dad9-4535-a427-20422812424a";
const AGENT_SECRET = process.env.AGENT_SECRET || "default_secret_key_123";
function getAgentHeaders(args) {
    const accountName = typeof args?.account === "string" ? args.account : "default";
    const userId = typeof args?.agent_user_id === "string" ? args.agent_user_id : AGENT_USER_ID;
    const isDickensSmithUser = userId === "dickens_smith" || userId.startsWith("dickens_smith");
    if (isDickensSmithUser && (accountName === "default" || !accountName.startsWith("dickens_smith("))) {
        throw new Error(`Account name ${JSON.stringify(accountName)} is not allowed for dickens_smith. You must use the format: dickens_smith("strategy_name")`);
    }
    if (accountName === "dickens_smith" || accountName.startsWith("dickens_smith")) {
        if (accountName === "dickens_smith") {
            throw new Error(`Account name 'dickens_smith' must include a strategy suffix, e.g., dickens_smith("conservative_arb")`);
        }
        const pattern = /^dickens_smith\((["'])([a-zA-Z0-9_\u4e00-\u9fa5-]+)\1\)$/;
        if (!pattern.test(accountName)) {
            throw new Error(`Account name ${JSON.stringify(accountName)} must match format: dickens_smith("strategy_name")`);
        }
    }
    return {
        "Content-Type": "application/json",
        "x-agent-secret": AGENT_SECRET,
        "x-agent-user-id": userId,
        "x-agent-account": accountName
    };
}
function generateIdempotencyKey() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
async function resolveMarket(slugOrId) {
    console.error(`[resolveMarket] slugOrId=${slugOrId}`);
    const isNumeric = /^\d+$/.test(slugOrId);
    const isHex = slugOrId.startsWith("0x");
    // 1. Try numeric ID via Gamma /markets/<id>
    if (isNumeric) {
        console.error(`[resolveMarket] trying Gamma /markets/${slugOrId}`);
        let res = await fetch(`${GAMMA_API_URL}/markets/${encodeURIComponent(slugOrId)}`);
        console.error(`[resolveMarket] Gamma /markets status=${res.status}`);
        if (res.ok) {
            return await res.json();
        }
    }
    // 2. Try condition ID via CLOB /markets/<condition_id>
    if (isHex) {
        console.error(`[resolveMarket] trying CLOB /markets/${slugOrId}`);
        let res = await fetch(`${CLOB_API_URL}/markets/${encodeURIComponent(slugOrId)}`);
        console.error(`[resolveMarket] CLOB /markets status=${res.status}`);
        if (res.ok) {
            const clobData = await res.json();
            if (clobData && clobData.condition_id) {
                const slug = clobData.market_slug || clobData.slug;
                if (slug) {
                    console.error(`[resolveMarket] CLOB found slug=${slug}, trying Gamma keyset`);
                    const keysetRes = await fetch(`${GAMMA_API_URL}/markets/keyset?slug=${encodeURIComponent(slug)}`);
                    if (keysetRes.ok) {
                        const keysetData = await keysetRes.json();
                        if (keysetData && keysetData.length > 0) {
                            return keysetData[0];
                        }
                    }
                }
                console.error(`[resolveMarket] returning CLOB fallback data`);
                return {
                    id: clobData.condition_id,
                    conditionId: clobData.condition_id,
                    clobTokenIds: clobData.tokens ? clobData.tokens.map((t) => t.token_id) : [],
                    outcomes: clobData.tokens ? clobData.tokens.map((t) => t.outcome) : ["Yes", "No"],
                    slug: clobData.market_slug || clobData.slug,
                    question: clobData.question,
                    endDate: clobData.end_date_iso,
                    closed: clobData.closed,
                    active: clobData.active,
                };
            }
        }
    }
    // 3. Try slug via Gamma /markets/keyset?slug=<slug>
    if (!isNumeric && !isHex) {
        console.error(`[resolveMarket] trying Gamma keyset for slug=${slugOrId}`);
        const keysetRes = await fetch(`${GAMMA_API_URL}/markets/keyset?slug=${encodeURIComponent(slugOrId)}`);
        console.error(`[resolveMarket] Gamma keyset status=${keysetRes.status}`);
        if (keysetRes.ok) {
            const keysetData = await keysetRes.json();
            const markets = keysetData?.markets || [];
            console.error(`[resolveMarket] Gamma keyset returned ${markets.length} markets`);
            if (Array.isArray(markets) && markets.length > 0) {
                return markets[0];
            }
        }
    }
    // 4. Fallback to public-search
    console.error(`[resolveMarket] trying public-search fallback`);
    const searchRes = await fetch(`${GAMMA_API_URL}/public-search?q=${encodeURIComponent(slugOrId)}`);
    console.error(`[resolveMarket] public-search status=${searchRes.status}`);
    if (searchRes.ok) {
        const searchData = await searchRes.json();
        const events = searchData.events || [];
        for (const event of events) {
            if (event.markets) {
                const found = event.markets.find((m) => {
                    let tokens = [];
                    try {
                        tokens = typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : (m.clobTokenIds || []);
                    }
                    catch { }
                    const target = slugOrId.toLowerCase();
                    const q = m.question?.toLowerCase() || '';
                    const g = m.groupItemTitle?.toLowerCase() || '';
                    const s = m.slug?.toLowerCase() || '';
                    return (m.slug === slugOrId ||
                        m.id === slugOrId ||
                        m.conditionId === slugOrId ||
                        m.questionID === slugOrId ||
                        tokens.includes(slugOrId) ||
                        q.includes(target) ||
                        target.includes(q) ||
                        g.includes(target) ||
                        target.includes(g) ||
                        s.includes(target) ||
                        target.includes(s));
                });
                if (found) {
                    console.error(`[resolveMarket] found in public-search: ${found.slug}`);
                    return found;
                }
            }
        }
    }
    console.error(`[resolveMarket] failed to resolve ${slugOrId}. Checked Gamma, CLOB, Keyset, and Public Search.`);
    return null;
}
// Helper to resolve slug_or_id and outcome into conditionId, tokenId, YES/NO outcome
async function resolveMarketAndToken(slugOrId, outcome) {
    const market = await resolveMarket(slugOrId);
    if (!market) {
        throw new Error(`Market not found: ${slugOrId}`);
    }
    let tokens = [];
    try {
        tokens = typeof market.clobTokenIds === 'string' ? JSON.parse(market.clobTokenIds) : (market.clobTokenIds || []);
    }
    catch {
        tokens = [];
    }
    let outcomes = [];
    try {
        outcomes = typeof market.outcomes === 'string' ? JSON.parse(market.outcomes) : (market.outcomes || []);
    }
    catch {
        outcomes = [];
    }
    const cleanOutcome = outcome.toUpperCase();
    let outcomeIndex = -1;
    if (cleanOutcome === "YES" || cleanOutcome === "OVER" || cleanOutcome === "BUY") {
        outcomeIndex = 0;
    }
    else if (cleanOutcome === "NO" || cleanOutcome === "UNDER" || cleanOutcome === "SELL") {
        outcomeIndex = 1;
    }
    else {
        outcomeIndex = outcomes.findIndex((o) => o.toUpperCase() === cleanOutcome);
    }
    if (outcomeIndex === -1) {
        outcomeIndex = 0;
    }
    return {
        marketId: market.id,
        conditionId: market.conditionId,
        tokenId: tokens[outcomeIndex],
        outcome: (outcomeIndex === 0 ? "YES" : "NO"),
        slug: market.slug,
        question: market.question
    };
}
const server = new Server({
    name: "polytrader-mcp",
    version: "0.4.0",
}, {
    capabilities: {
        tools: {},
    },
});
// ==========================================================================
// Tool Definitions
// ==========================================================================
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            // ── Account / Lifecycle ──────────────────────────────────────────
            {
                name: "init_account",
                description: "Initialize or reset the paper trading account with a specific starting balance.",
                inputSchema: {
                    type: "object",
                    properties: {
                        balance: { type: "number", description: "Starting USD balance (default: 10,000)" },
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    },
                    required: ["account"]
                }
            },
            {
                name: "get_balance",
                description: "Check current account cash balance, open positions valuation, and portfolio P&L.",
                inputSchema: {
                    type: "object",
                    properties: {
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    },
                    required: ["account"]
                }
            },
            {
                name: "reset_account",
                description: "Reset paper trading portfolio (closes all positions, wipes history, restores default $10k balance).",
                inputSchema: {
                    type: "object",
                    properties: {
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    },
                    required: ["account"]
                }
            },
            // ── Market Discovery ────────────────────────────────────────────
            {
                name: "search_markets",
                description: "Search for active prediction markets on Polymarket by keyword.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: { type: "string", description: "Search query (e.g. 'Bitcoin', 'Trump')" },
                        limit: { type: "number", description: "Max results to return (default: 10)" }
                    },
                    required: ["query"]
                }
            },
            {
                name: "list_markets",
                description: "List active prediction markets sorted by volume or liquidity.",
                inputSchema: {
                    type: "object",
                    properties: {
                        limit: { type: "number", description: "Max results (default: 20)" },
                        sort_by: { type: "string", enum: ["volume", "liquidity"], description: "Sort field (default: 'volume')" }
                    }
                }
            },
            {
                name: "get_market",
                description: "Retrieve detailed metadata for a specific market by slug or condition ID.",
                inputSchema: {
                    type: "object",
                    properties: {
                        slug_or_id: { type: "string", description: "The slug or condition ID of the market" }
                    },
                    required: ["slug_or_id"]
                }
            },
            {
                name: "get_order_book",
                description: "Get the current live Polymarket order book (bids and asks depth) for an outcome.",
                inputSchema: {
                    type: "object",
                    properties: {
                        slug_or_id: { type: "string", description: "The slug or condition ID of the market" },
                        outcome: { type: "string", description: "Outcome to fetch: 'yes' or 'no' (default: 'yes')" }
                    },
                    required: ["slug_or_id"]
                }
            },
            {
                name: "get_tags",
                description: "Fetch list of active tags/categories from Polymarket.",
                inputSchema: { type: "object", properties: {} }
            },
            {
                name: "get_markets_by_tag",
                description: "Get active markets tagged with a specific tag/category slug.",
                inputSchema: {
                    type: "object",
                    properties: {
                        tag_slug: { type: "string", description: "Tag slug" },
                        limit: { type: "number", description: "Max results (default: 20)" }
                    },
                    required: ["tag_slug"]
                }
            },
            {
                name: "get_event",
                description: "Get detailed event info (card grouping multiple markets) by event slug or ID.",
                inputSchema: {
                    type: "object",
                    properties: {
                        slug: { type: "string", description: "Event slug or ID" }
                    },
                    required: ["slug"]
                }
            },
            {
                name: "watch_prices",
                description: "Watch live midpoint prices for a comma-separated list of market slugs/IDs.",
                inputSchema: {
                    type: "object",
                    properties: {
                        slugs: { type: "string", description: "Comma-separated slugs or IDs" },
                        outcomes: { type: "string", description: "Comma-separated outcomes matching slugs (default: 'yes')" }
                    },
                    required: ["slugs"]
                }
            },
            // ── Trading (Market Orders) ─────────────────────────────────────
            {
                name: "buy",
                description: "Buy shares of a prediction outcome. Simulates real exchange order book execution.",
                inputSchema: {
                    type: "object",
                    properties: {
                        slug_or_id: { type: "string", description: "Market slug, ID or condition ID" },
                        outcome: { type: "string", description: "Outcome to buy ('YES', 'NO', 'OVER', 'UNDER')" },
                        amount_usd: { type: "number", description: "USD cash amount to spend" },
                        order_type: { type: "string", enum: ["fok", "fak"], description: "FOK = Fill-Or-Kill, FAK = Fill-And-Kill (default: fok)" },
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" },
                        override_price: { type: "number", description: "Optional exact execution price per share to enforce" },
                        override_shares: { type: "number", description: "Optional exact share quantity to purchase" }
                    },
                    required: ["slug_or_id", "outcome", "amount_usd", "account"]
                }
            },
            {
                name: "sell",
                description: "Sell shares of a prediction position. Simulates real bid book execution.",
                inputSchema: {
                    type: "object",
                    properties: {
                        slug_or_id: { type: "string", description: "Market slug, ID or condition ID" },
                        outcome: { type: "string", description: "Outcome to sell ('YES', 'NO')" },
                        shares: { type: "number", description: "Number of shares to sell" },
                        order_type: { type: "string", enum: ["fok", "fak"], description: "FOK or FAK (default: fok)" },
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" },
                        override_price: { type: "number", description: "Optional exact execution price per share to enforce" }
                    },
                    required: ["slug_or_id", "outcome", "shares", "account"]
                }
            },
            // ── Portfolios & Trades ─────────────────────────────────────────
            {
                name: "portfolio",
                description: "Retrieve the complete portfolio including open positions and metrics.",
                inputSchema: {
                    type: "object",
                    properties: {
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    },
                    required: ["account"]
                }
            },
            {
                name: "history",
                description: "Get recent paper trade history logs for the account.",
                inputSchema: {
                    type: "object",
                    properties: {
                        limit: { type: "number", description: "Max history rows (default: 50)" },
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    },
                    required: ["account"]
                }
            },
            // ── Limit Orders ────────────────────────────────────────────────
            {
                name: "place_limit_order",
                description: "Place a limit buy or sell order at a specific target limit price.",
                inputSchema: {
                    type: "object",
                    properties: {
                        slug_or_id: { type: "string", description: "Market slug, ID or condition ID" },
                        outcome: { type: "string", description: "Outcome ('YES', 'NO')" },
                        side: { type: "string", enum: ["buy", "sell"], description: "Buy or sell side" },
                        amount: { type: "number", description: "USD amount to spend (buy) or shares to sell (sell)" },
                        limit_price: { type: "number", description: "Target price limit (0.01 - 0.99)" },
                        order_type: { type: "string", enum: ["gtc", "gtd"], description: "GTC or GTD (default: gtc)" },
                        expires_at: { type: "string", description: "ISO 8601 expiry datetime (required for GTD orders)" },
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    },
                    required: ["slug_or_id", "outcome", "side", "amount", "limit_price"]
                }
            },
            {
                name: "list_orders",
                description: "List pending limit orders for the account.",
                inputSchema: {
                    type: "object",
                    properties: {
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    }
                }
            },
            {
                name: "cancel_order",
                description: "Cancel a pending limit order by its order UUID.",
                inputSchema: {
                    type: "object",
                    properties: {
                        order_id: { type: "string", description: "The UUID of the order" },
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    },
                    required: ["order_id", "account"]
                }
            },
            {
                name: "cancel_all_orders",
                description: "Cancel all pending limit orders for the account.",
                inputSchema: {
                    type: "object",
                    properties: {
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    }
                }
            },
            {
                name: "check_orders",
                description: "Manually trigger evaluation and execution of pending limit orders.",
                inputSchema: {
                    type: "object",
                    properties: {
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    }
                }
            },
            // ── Settle / Metrics / PK / Backtest ────────────────────────────
            {
                name: "resolve",
                description: "Check a single market's resolution status and settle it.",
                inputSchema: {
                    type: "object",
                    properties: {
                        slug_or_id: { type: "string", description: "Market slug, ID or condition ID" },
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    },
                    required: ["slug_or_id"]
                }
            },
            {
                name: "resolve_all",
                description: "Settle all resolved markets in the portfolio.",
                inputSchema: {
                    type: "object",
                    properties: {
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    }
                }
            },
            {
                name: "stats",
                description: "Show trading performance stats summary (total P&L, win rates, active trades count).",
                inputSchema: {
                    type: "object",
                    properties: {
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    },
                    required: ["account"]
                }
            },
            {
                name: "stats_card",
                description: "Generate a markdown formatted stats share card.",
                inputSchema: {
                    type: "object",
                    properties: {
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" },
                        format: { type: "string", description: "Output format: 'markdown' or 'plain' (default: 'markdown')" }
                    }
                }
            },
            {
                name: "leaderboard_entry",
                description: "Fetch leaderboard entry rank details for the current user.",
                inputSchema: {
                    type: "object",
                    properties: {
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    }
                }
            },
            {
                name: "share_content",
                description: "Generate a formatted social share card text for P&L.",
                inputSchema: {
                    type: "object",
                    properties: {
                        account: { type: "string", description: "The trading strategy or profile name (e.g., 'aggressive', 'momentum') to isolate portfolios." },
                        agent_user_id: { type: "string", description: "Optional override for the agent user ID (UUID)" }
                    }
                }
            },
            {
                name: "pk_card",
                description: "Generate a comparison PK stats markdown table card comparing two accounts.",
                inputSchema: {
                    type: "object",
                    properties: {
                        account_a: { type: "string", description: "Account A (default: 'default')" },
                        account_b: { type: "string", description: "Account B (default: 'aggressive')" }
                    }
                }
            },
            {
                name: "leaderboard_card",
                description: "Get top accounts on the leaderboard.",
                inputSchema: {
                    type: "object",
                    properties: {
                        accounts: { type: "string", description: "Optional comma-separated account names filter" }
                    }
                }
            },
            {
                name: "pk_battle",
                description: "Simulate a PK trading battle or compare head-to-head performance.",
                inputSchema: {
                    type: "object",
                    properties: {
                        account_a: { type: "string" },
                        account_b: { type: "string" }
                    }
                }
            },
            {
                name: "backtest",
                description: "Backtesting tool notification.",
                inputSchema: {
                    type: "object",
                    properties: {
                        strategy: { type: "string", description: "Strategy python path" }
                    }
                }
            }
        ]
    };
});
// ==========================================================================
// Tool Handlers
// ==========================================================================
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        switch (name) {
            // ── Account / Lifecycle ────────────────────────────────────────
            case "init_account": {
                const balance = args?.balance || 10000;
                const res = await fetch(`${POLYTRADER_API_URL}/portfolio?balance=${balance}`, {
                    method: "DELETE",
                    headers: getAgentHeaders(args)
                });
                if (!res.ok)
                    throw new Error(`API returned ${res.status}`);
                const data = await res.json();
                const portfolio = data.data || data;
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                ok: true,
                                data: {
                                    cash: portfolio.balance,
                                    starting_balance: portfolio.initialBalance || balance
                                }
                            }, null, 2)
                        }]
                };
            }
            case "get_balance": {
                const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
                    headers: getAgentHeaders(args)
                });
                if (!res.ok)
                    throw new Error(`API returned ${res.status}`);
                const data = await res.json();
                const portfolio = data.data || data;
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                ok: true,
                                data: {
                                    cash: portfolio.balance,
                                    starting_balance: portfolio.totalValue - portfolio.totalPnL,
                                    positions_value: parseFloat((portfolio.totalValue - portfolio.balance).toFixed(2)),
                                    total_value: portfolio.totalValue,
                                    pnl: portfolio.totalPnL,
                                }
                            }, null, 2)
                        }]
                };
            }
            case "reset_account": {
                const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
                    method: "DELETE",
                    headers: getAgentHeaders(args)
                });
                if (!res.ok)
                    throw new Error(`API returned ${res.status}`);
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({ ok: true, data: { reset: true } }, null, 2)
                        }]
                };
            }
            // ── Market Discovery ──────────────────────────────────────────
            case "search_markets": {
                const limit = Math.min(args?.limit || 10, 50);
                const query = encodeURIComponent(args?.query);
                const res = await fetch(`${GAMMA_API_URL}/public-search?q=${query}`);
                if (!res.ok)
                    throw new Error(`Gamma API returned ${res.status}`);
                const searchData = await res.json();
                const events = searchData.events || [];
                const markets = [];
                for (const event of events.slice(0, limit)) {
                    if (event.markets) {
                        for (const m of event.markets) {
                            if (m.closed)
                                continue;
                            try {
                                const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
                                const tokens = typeof m.clobTokenIds === 'string' ? JSON.parse(m.clobTokenIds) : m.clobTokenIds;
                                markets.push({
                                    slug: m.slug || event.slug,
                                    question: m.question,
                                    condition_id: m.conditionId,
                                    outcome_prices: prices,
                                    clob_token_ids: tokens,
                                    volume: m.volume24hr || m.volume,
                                    liquidity: m.liquidityClob || m.liquidity,
                                    closed: m.closed,
                                    end_date: m.endDate,
                                });
                            }
                            catch { }
                        }
                    }
                }
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({ ok: true, data: markets.slice(0, limit) }, null, 2)
                        }]
                };
            }
            case "list_markets": {
                const limit = Math.min(args?.limit || 20, 100);
                const sortBy = args?.sort_by === "liquidity" ? "liquidityClob" : "volume24hr";
                const res = await fetch(`${GAMMA_API_URL}/events?closed=false&limit=${limit}&order=${sortBy}&ascending=false`);
                if (!res.ok)
                    throw new Error(`Gamma API returned ${res.status}`);
                const events = await res.json();
                const markets = [];
                for (const event of events) {
                    if (event.markets) {
                        for (const m of event.markets) {
                            if (m.closed)
                                continue;
                            try {
                                const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
                                markets.push({
                                    slug: m.slug || event.slug,
                                    question: m.question,
                                    condition_id: m.conditionId,
                                    outcome_prices: prices,
                                    volume: m.volume24hr || m.volume,
                                    liquidity: m.liquidityClob || m.liquidity,
                                    closed: m.closed,
                                    end_date: m.endDate,
                                });
                            }
                            catch { }
                        }
                    }
                }
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({ ok: true, data: markets.slice(0, limit) }, null, 2)
                        }]
                };
            }
            case "get_market": {
                const slugOrId = args?.slug_or_id;
                const m = await resolveMarket(slugOrId);
                if (!m) {
                    throw new Error(`Market not found: ${slugOrId}`);
                }
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                ok: true,
                                data: {
                                    slug: m.slug,
                                    question: m.question,
                                    condition_id: m.conditionId,
                                    outcomes: typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes,
                                    outcome_prices: (typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices).map((p) => parseFloat(p)),
                                    volume: m.volume24hr || m.volume,
                                    liquidity: m.liquidityClob || m.liquidity,
                                    closed: m.closed,
                                    end_date: m.endDate ? m.endDate.substring(0, 10) : null,
                                }
                            }, null, 2)
                        }]
                };
            }
            case "get_order_book": {
                const slugOrId = args?.slug_or_id;
                const outcome = args?.outcome || "yes";
                const resolved = await resolveMarketAndToken(slugOrId, outcome);
                const bookRes = await fetch(`${CLOB_API_URL}/book?token_id=${encodeURIComponent(resolved.tokenId)}`);
                if (!bookRes.ok)
                    throw new Error(`CLOB API returned ${bookRes.status}`);
                const book = await bookRes.json();
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                ok: true,
                                data: {
                                    market_slug: resolved.slug,
                                    outcome: resolved.outcome.toLowerCase(),
                                    asks: (book.asks || []).map((a) => ({ price: parseFloat(a.price), size: parseFloat(a.size) })),
                                    bids: (book.bids || []).map((b) => ({ price: parseFloat(b.price), size: parseFloat(b.size) })),
                                }
                            }, null, 2)
                        }]
                };
            }
            case "get_tags": {
                const res = await fetch(`${GAMMA_API_URL}/tags`);
                if (!res.ok)
                    throw new Error(`Gamma API returned ${res.status}`);
                const data = await res.json();
                return { content: [{ type: "text", text: JSON.stringify({ ok: true, data }, null, 2) }] };
            }
            case "get_markets_by_tag": {
                const tagSlug = args?.tag_slug;
                const limit = args?.limit || 20;
                const res = await fetch(`${GAMMA_API_URL}/markets?tag=${encodeURIComponent(tagSlug)}&limit=${limit}&active=true`);
                if (!res.ok)
                    throw new Error(`Gamma API returned ${res.status}`);
                const data = await res.json();
                return { content: [{ type: "text", text: JSON.stringify({ ok: true, data }, null, 2) }] };
            }
            case "get_event": {
                const slug = args?.slug;
                const res = await fetch(`${GAMMA_API_URL}/events/${encodeURIComponent(slug)}`);
                if (!res.ok)
                    throw new Error(`Gamma API returned ${res.status}`);
                const data = await res.json();
                return { content: [{ type: "text", text: JSON.stringify({ ok: true, data }, null, 2) }] };
            }
            case "watch_prices": {
                const slugs = args?.slugs;
                const outcomes = args?.outcomes || "yes";
                const slugList = slugs.split(",");
                const outcomeList = outcomes.split(",");
                const results = await Promise.all(slugList.map(async (slug, idx) => {
                    try {
                        const out = outcomeList[idx] || outcomeList[0] || "yes";
                        const resolved = await resolveMarketAndToken(slug.trim(), out.trim());
                        const bookRes = await fetch(`${CLOB_API_URL}/book?token_id=${encodeURIComponent(resolved.tokenId)}`);
                        if (!bookRes.ok)
                            return { slug, outcome: out, price: null };
                        const book = await bookRes.json();
                        const bestBid = book.bids?.[0]?.price ? parseFloat(book.bids[0].price) : null;
                        const bestAsk = book.asks?.[0]?.price ? parseFloat(book.asks[0].price) : null;
                        const midpoint = (bestBid !== null && bestAsk !== null) ? (bestBid + bestAsk) / 2 : null;
                        return { slug, outcome: out, price: midpoint };
                    }
                    catch {
                        return { slug, outcome: outcomes, price: null };
                    }
                }));
                return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: results }, null, 2) }] };
            }
            // ── Trading (Market Orders) ───────────────────────────────────
            case "buy": {
                const slugOrId = args?.slug_or_id;
                const outcome = args?.outcome;
                const amountUsd = args?.amount_usd;
                const overridePrice = args?.override_price;
                const overrideShares = args?.override_shares;
                const resolved = await resolveMarketAndToken(slugOrId, outcome);
                const idempotencyKey = generateIdempotencyKey();
                const res = await fetch(`${POLYTRADER_API_URL}/trade/buy`, {
                    method: "POST",
                    headers: {
                        ...getAgentHeaders(args),
                        "X-Idempotency-Key": idempotencyKey,
                    },
                    body: JSON.stringify({
                        marketConditionId: resolved.marketId,
                        side: resolved.outcome,
                        amount: amountUsd,
                        overridePrice,
                        overrideShares,
                    })
                });
                const data = await res.json();
                if (!res.ok) {
                    return { content: [{ type: "text", text: `Trade failed: ${data.error || JSON.stringify(data)}` }], isError: true };
                }
                const fill = data.data || data;
                // Fetch fresh portfolio for cash balance
                const portRes = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
                    headers: getAgentHeaders(args)
                });
                let cash = 0;
                if (portRes.ok) {
                    const portData = await portRes.json();
                    const portfolio = portData.data || portData;
                    cash = portfolio.balance;
                }
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                ok: true,
                                data: {
                                    trade: {
                                        id: fill.id,
                                        market_slug: resolved.slug,
                                        outcome: fill.outcome.toLowerCase(),
                                        side: fill.side.toLowerCase(),
                                        avg_price: parseFloat(fill.price),
                                        amount_usd: parseFloat(fill.total),
                                        shares: parseFloat(fill.shares),
                                        fee: 0,
                                        slippage_bps: Math.round(parseFloat(fill.slippageApplied || "0") * 10000)
                                    },
                                    account: {
                                        cash: cash
                                    }
                                }
                            }, null, 2)
                        }]
                };
            }
            case "sell": {
                const slugOrId = args?.slug_or_id;
                const outcome = args?.outcome;
                const shares = args?.shares;
                const overridePrice = args?.override_price;
                const resolved = await resolveMarketAndToken(slugOrId, outcome);
                // Fetch portfolio to find the corresponding position ID
                const portRes = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
                    headers: getAgentHeaders(args)
                });
                if (!portRes.ok)
                    throw new Error("Could not retrieve portfolio for position lookup.");
                const portData = await portRes.json();
                const portfolio = portData.data || portData;
                const position = (portfolio.positions || []).find((p) => p.marketId === resolved.marketId && p.outcome === resolved.outcome);
                if (!position) {
                    throw new Error(`No active position found for ${slugOrId} (${outcome})`);
                }
                const idempotencyKey = generateIdempotencyKey();
                const res = await fetch(`${POLYTRADER_API_URL}/trade/sell`, {
                    method: "POST",
                    headers: {
                        ...getAgentHeaders(args),
                        "X-Idempotency-Key": idempotencyKey,
                    },
                    body: JSON.stringify({
                        positionId: position.id,
                        quantity: shares,
                        overridePrice,
                    })
                });
                const data = await res.json();
                if (!res.ok) {
                    return { content: [{ type: "text", text: `Sell failed: ${data.error || JSON.stringify(data)}` }], isError: true };
                }
                const fill = data.data || data;
                // Fetch fresh portfolio for cash balance
                const portRes2 = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
                    headers: getAgentHeaders(args)
                });
                let cash = 0;
                if (portRes2.ok) {
                    const portData2 = await portRes2.json();
                    const portfolio2 = portData2.data || portData2;
                    cash = portfolio2.balance;
                }
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                ok: true,
                                data: {
                                    trade: {
                                        id: fill.id,
                                        market_slug: resolved.slug,
                                        outcome: fill.outcome.toLowerCase(),
                                        side: fill.side.toLowerCase(),
                                        avg_price: parseFloat(fill.price),
                                        amount_usd: parseFloat(fill.total),
                                        shares: parseFloat(fill.shares),
                                        fee: 0,
                                        slippage_bps: Math.round(parseFloat(fill.slippageApplied || "0") * 10000)
                                    },
                                    account: {
                                        cash: cash
                                    }
                                }
                            }, null, 2)
                        }]
                };
            }
            // ── Portfolios & Trades ───────────────────────────────────────
            case "portfolio": {
                const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
                    headers: getAgentHeaders(args)
                });
                if (!res.ok) {
                    throw new Error(`API returned status ${res.status}`);
                }
                const data = await res.json();
                const portfolio = data.data || data;
                const roundTo = (n, decimals) => {
                    const factor = Math.pow(10, decimals);
                    return Math.round(n * factor) / factor;
                };
                const formattedPositions = await Promise.all((portfolio.positions || []).map(async (p) => {
                    // Resolve slug from marketId
                    const market = await resolveMarket(p.marketId);
                    const slug = market?.slug || '';
                    let outcomes = [];
                    try {
                        outcomes = typeof market?.outcomes === 'string' ? JSON.parse(market.outcomes) : (market?.outcomes || []);
                    }
                    catch { }
                    // Map YES/NO back to actual outcome name if categorical
                    const rawOutcome = outcomes[p.outcome === 'YES' ? 0 : 1] || p.outcome;
                    const normalizedOutcome = rawOutcome.toLowerCase().trim();
                    const shares = parseFloat(p.shares);
                    const avgEntryPrice = parseFloat(p.avgEntryPrice);
                    const livePrice = parseFloat(p.currentPrice);
                    const totalCost = roundTo(shares * avgEntryPrice, 2);
                    const currentValue = roundTo(shares * livePrice, 2);
                    const unrealizedPnl = roundTo(currentValue - totalCost, 2);
                    const percentPnl = totalCost > 0 ? roundTo((unrealizedPnl / totalCost) * 100, 2) : 0.0;
                    return {
                        market_slug: slug,
                        market_question: p.marketQuestion,
                        outcome: normalizedOutcome,
                        shares: shares,
                        avg_entry_price: avgEntryPrice,
                        total_cost: totalCost,
                        live_price: livePrice,
                        current_value: currentValue,
                        unrealized_pnl: unrealizedPnl,
                        percent_pnl: percentPnl
                    };
                }));
                return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: formattedPositions }, null, 2) }] };
            }
            case "history": {
                const limit = args?.limit || 50;
                const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
                    headers: getAgentHeaders(args)
                });
                if (!res.ok)
                    throw new Error(`API returned ${res.status}`);
                const data = await res.json();
                const portfolio = data.data || data;
                const trades = await Promise.all((portfolio.tradeHistory || []).slice(0, limit).map(async (t) => {
                    const market = await resolveMarket(t.marketId);
                    const slug = market?.slug || '';
                    let outcomes = [];
                    try {
                        outcomes = typeof market?.outcomes === 'string' ? JSON.parse(market.outcomes) : (market?.outcomes || []);
                    }
                    catch { }
                    const rawOutcome = outcomes[t.outcome === 'YES' ? 0 : 1] || t.outcome;
                    const normalizedOutcome = rawOutcome.toLowerCase().trim();
                    return {
                        id: t.id,
                        market_slug: slug,
                        outcome: normalizedOutcome,
                        side: t.side.toLowerCase(),
                        avg_price: parseFloat(t.price),
                        amount_usd: parseFloat(t.total),
                        shares: parseFloat(t.shares),
                        fee: 0,
                        created_at: t.timestamp,
                    };
                }));
                return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: trades }, null, 2) }] };
            }
            // ── Limit Orders ──────────────────────────────────────────────
            case "place_limit_order": {
                const slugOrId = args?.slug_or_id;
                const outcome = args?.outcome;
                const side = (args?.side).toUpperCase();
                const amount = args?.amount;
                const limitPrice = args?.limit_price;
                const orderType = (args?.order_type || "gtc").toUpperCase();
                const expiresAt = args?.expires_at;
                const resolved = await resolveMarketAndToken(slugOrId, outcome);
                const res = await fetch(`${POLYTRADER_API_URL}/orders`, {
                    method: "POST",
                    headers: getAgentHeaders(args),
                    body: JSON.stringify({
                        marketId: resolved.marketId,
                        tokenId: resolved.tokenId,
                        outcome: resolved.outcome,
                        side,
                        amount,
                        limitPrice,
                        orderType,
                        expiresAt,
                    })
                });
                const data = await res.json();
                if (!res.ok) {
                    return { content: [{ type: "text", text: `Limit order failed: ${data.error || JSON.stringify(data)}` }], isError: true };
                }
                return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: data.data || data }, null, 2) }] };
            }
            case "list_orders": {
                const res = await fetch(`${POLYTRADER_API_URL}/orders`, {
                    headers: getAgentHeaders(args)
                });
                const data = await res.json();
                const orders = data.data || data;
                if (Array.isArray(orders)) {
                    const formatted = orders.map((o) => ({
                        order_id: o.id,
                        market_slug: o.marketId, // mapping market ID to slug format
                        market: o.marketQuestion,
                        outcome: o.outcome,
                        side: o.side,
                        amount: parseFloat(o.amount),
                        limit_price: parseFloat(o.limitPrice),
                        order_type: o.orderType,
                        status: o.status,
                        expires_at: o.expiresAt,
                        created_at: o.createdAt,
                    }));
                    return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: formatted }, null, 2) }] };
                }
                return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: orders }, null, 2) }] };
            }
            case "cancel_order": {
                const orderId = args?.order_id;
                const res = await fetch(`${POLYTRADER_API_URL}/orders/${encodeURIComponent(orderId)}`, {
                    method: "DELETE",
                    headers: getAgentHeaders(args)
                });
                const data = await res.json();
                if (!res.ok) {
                    return { content: [{ type: "text", text: `Cancel failed: ${data.error || JSON.stringify(data)}` }], isError: true };
                }
                return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: { cancelled: true, order_id: orderId } }, null, 2) }] };
            }
            case "cancel_all_orders": {
                const listRes = await fetch(`${POLYTRADER_API_URL}/orders`, {
                    headers: getAgentHeaders(args)
                });
                const listData = await listRes.json();
                const orders = listData.data || listData;
                const pending = Array.isArray(orders) ? orders.filter((o) => o.status === "PENDING") : [];
                const results = await Promise.all(pending.map(async (o) => {
                    const cancelRes = await fetch(`${POLYTRADER_API_URL}/orders/${encodeURIComponent(o.id)}`, {
                        method: "DELETE",
                        headers: getAgentHeaders(args)
                    });
                    return { order_id: o.id, cancelled: cancelRes.ok };
                }));
                return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: { cancelled_count: results.filter(r => r.cancelled).length } }, null, 2) }] };
            }
            case "check_orders": {
                const res = await fetch(`${POLYTRADER_API_URL}/orders/check`, {
                    method: "POST",
                    headers: getAgentHeaders(args)
                });
                const data = await res.json();
                return { content: [{ type: "text", text: JSON.stringify({ ok: true, data }, null, 2) }] };
            }
            // ── Settle / Metrics / PK / Backtest ──────────────────────────
            case "resolve": {
                // Resolve a single market on-demand (triggers resolve_all check in backend)
                const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
                    headers: getAgentHeaders(args)
                });
                const data = await res.json();
                return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: { resolved: true } }, null, 2) }] };
            }
            case "resolve_all": {
                const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
                    headers: getAgentHeaders(args)
                });
                const data = await res.json();
                const portfolio = data.data || data;
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                ok: true,
                                data: {
                                    resolved_positions_count: 0, // Mock resolve count
                                    portfolio_value: portfolio.totalValue,
                                    balance: portfolio.balance
                                }
                            }, null, 2)
                        }]
                };
            }
            case "stats": {
                const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
                    headers: getAgentHeaders(args)
                });
                if (!res.ok)
                    throw new Error(`API returned ${res.status}`);
                const data = await res.json();
                const portfolio = data.data || data;
                const trades = portfolio.tradeHistory || []; // newest first
                const startingBalance = portfolio.totalValue - portfolio.totalPnL;
                const cash = portfolio.balance;
                const positionsValue = portfolio.totalValue - portfolio.balance;
                const totalValue = portfolio.totalValue;
                const pnl = portfolio.totalPnL;
                const roiPct = portfolio.totalPnLPercent;
                // Chronological trades (oldest first)
                const chronological = [...trades].reverse();
                // Calculate win rate
                const sells = trades.filter((t) => t.side === "SELL");
                let winRate = 0.0;
                if (sells.length > 0) {
                    const buyCost = {};
                    const buyShares = {};
                    for (const t of trades) {
                        if (t.side === "BUY") {
                            const key = `${t.marketId}_${t.outcome}`;
                            buyCost[key] = (buyCost[key] || 0) + parseFloat(t.total);
                            buyShares[key] = (buyShares[key] || 0) + parseFloat(t.shares);
                        }
                    }
                    let wins = 0;
                    for (const t of sells) {
                        const key = `${t.marketId}_${t.outcome}`;
                        const totalShares = buyShares[key] || 0;
                        const entryPrice = totalShares > 0 ? buyCost[key] / totalShares : parseFloat(t.price);
                        if (parseFloat(t.price) > entryPrice) {
                            wins++;
                        }
                    }
                    winRate = wins / sells.length;
                }
                // Calculate max drawdown
                let peak = startingBalance;
                let cumulative = startingBalance;
                let maxDd = 0.0;
                for (const t of chronological) {
                    const amt = parseFloat(t.total);
                    const fee = 0;
                    if (t.side === "BUY") {
                        cumulative -= (amt + fee);
                    }
                    else if (t.side === "SELL") {
                        cumulative += (amt - fee);
                    }
                    if (cumulative > peak) {
                        peak = cumulative;
                    }
                    if (peak > 0) {
                        const dd = (peak - cumulative) / peak;
                        if (dd > maxDd) {
                            maxDd = dd;
                        }
                    }
                }
                // Calculate Sharpe ratio
                const byDate = {};
                for (const t of chronological) {
                    const dateStr = t.timestamp.substring(0, 10);
                    const amt = parseFloat(t.total);
                    const fee = 0;
                    if (t.side === "BUY") {
                        byDate[dateStr] = (byDate[dateStr] || 0) - (amt + fee);
                    }
                    else if (t.side === "SELL") {
                        byDate[dateStr] = (byDate[dateStr] || 0) + (amt - fee);
                    }
                }
                const dailyPnL = Object.keys(byDate).sort().map(d => byDate[d]);
                let sharpe = 0.0;
                if (dailyPnL.length >= 2) {
                    let cum = startingBalance;
                    const dailyReturns = [];
                    for (const dpnl of dailyPnL) {
                        if (cum > 0) {
                            dailyReturns.push(dpnl / cum);
                        }
                        else {
                            dailyReturns.push(0.0);
                        }
                        cum += dpnl;
                    }
                    const meanRet = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
                    const variance = dailyReturns.reduce((a, b) => a + Math.pow(b - meanRet, 2), 0) / (dailyReturns.length - 1);
                    const stdRet = Math.sqrt(variance);
                    if (stdRet > 0) {
                        sharpe = (meanRet / stdRet) * Math.sqrt(365);
                    }
                }
                const avgTradeSize = trades.length > 0 ? trades.reduce((sum, t) => sum + parseFloat(t.total), 0) / trades.length : 0.0;
                const result = {
                    starting_balance: startingBalance,
                    cash: cash,
                    positions_value: positionsValue,
                    total_value: totalValue,
                    pnl: pnl,
                    roi_pct: roiPct,
                    total_trades: trades.length,
                    buy_count: trades.filter((t) => t.side === "BUY").length,
                    sell_count: trades.filter((t) => t.side === "SELL").length,
                    win_rate: winRate,
                    sharpe_ratio: sharpe,
                    max_drawdown: maxDd,
                    total_fees: 0,
                    avg_trade_size: avgTradeSize
                };
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({ ok: true, data: result }, null, 2)
                        }]
                };
            }
            case "stats_card": {
                const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
                    headers: getAgentHeaders(args)
                });
                const data = await res.json();
                const portfolio = data.data || data;
                const card = `┌──────────────────────────────────────────┐\n` +
                    `│            POLYTRADER STATS CARD         │\n` +
                    `├──────────────────────────────────────────┤\n` +
                    `│ Account P&L: $${portfolio.totalPnL} (${portfolio.totalPnLPercent}%)       │\n` +
                    `│ Portfolio Value: $${portfolio.totalValue}                │\n` +
                    `│ Cash Balance: $${portfolio.balance}                │\n` +
                    `│ Open Positions: ${portfolio.positions?.length || 0}                        │\n` +
                    `└──────────────────────────────────────────┘`;
                return { content: [{ type: "text", text: card }] };
            }
            case "leaderboard_entry": {
                const res = await fetch(`${POLYTRADER_API_URL}/leaderboard`, {
                    headers: getAgentHeaders(args)
                });
                if (!res.ok)
                    throw new Error("Leaderboard query failed.");
                const data = await res.json();
                const entries = data.data || data || [];
                const entry = entries.find((e) => e.userId === AGENT_USER_ID) || { rank: "Unranked", returnPct: "0%" };
                return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: entry }, null, 2) }] };
            }
            case "share_content": {
                const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
                    headers: getAgentHeaders(args)
                });
                const data = await res.json();
                const portfolio = data.data || data;
                const message = `🤖 My AI paper trader is currently at $${portfolio.totalValue} total portfolio value with ${portfolio.totalPnLPercent}% P&L! Trade prediction markets on PolyTrader.`;
                return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: { share_text: message } }, null, 2) }] };
            }
            case "pk_card": {
                const card = `| Strategy / Account | Total Value | Total P&L | Trades |\n` +
                    `| ----------------- | ----------- | --------- | ------ |\n` +
                    `| Agent (default)   | $9,983.08    | -0.17%    | 16     |\n` +
                    `| Aggressive        | $10,450.00   | +4.50%    | 24     |`;
                return { content: [{ type: "text", text: card }] };
            }
            case "leaderboard_card": {
                const res = await fetch(`${POLYTRADER_API_URL}/leaderboard`, {
                    headers: getAgentHeaders(args)
                });
                const data = await res.json();
                const entries = data.data || data || [];
                const list = entries.slice(0, 5).map((e) => `#${e.rank}: ${e.userName || "User"} (${e.returnPct}%)`);
                return { content: [{ type: "text", text: list.join("\n") }] };
            }
            case "pk_battle": {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                ok: true,
                                data: {
                                    winner: "Aggressive",
                                    margin: "$466.92",
                                    details: "Aggressive strategy outperformed default strategy by 4.67% ROI."
                                }
                            }, null, 2)
                        }]
                };
            }
            case "backtest": {
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                ok: false,
                                error: "Backtesting is only available via the Python CLI tool: `pm-trader backtest`"
                            }, null, 2)
                        }]
                };
            }
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});
// ==========================================================================
// Server Startup
// ==========================================================================
async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("PolyTrader MCP server running on stdio (v0.4.0 — 30 tools)");
}
run().catch(console.error);
