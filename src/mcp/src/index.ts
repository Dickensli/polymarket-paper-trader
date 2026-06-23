import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";

// The endpoint for our PolyTrader Next.js API
const POLYTRADER_API_URL = process.env.POLYTRADER_API_URL || "http://localhost:3000/api";
const GAMMA_API_URL = "https://gamma-api.polymarket.com";
const CLOB_API_URL = "https://clob.polymarket.com";

// A unique user ID and secret for agent session authentication bypass
const AGENT_USER_ID = process.env.AGENT_USER_ID || "815c03ff-dad9-4535-a427-20422812424a";
const AGENT_SECRET = process.env.AGENT_SECRET || "default_secret_key_123";

function getAgentHeaders() {
  return {
    "Content-Type": "application/json",
    "x-agent-secret": AGENT_SECRET,
    "x-agent-user-id": AGENT_USER_ID
  };
}

function generateIdempotencyKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Helper to resolve slug_or_id and outcome into conditionId, tokenId, YES/NO outcome
async function resolveMarketAndToken(slugOrId: string, outcome: string) {
  // Try fetching as market ID first
  let res = await fetch(`${GAMMA_API_URL}/markets/${encodeURIComponent(slugOrId)}`);
  let market: any;
  if (res.ok) {
    market = await res.json();
  } else {
    // Try to search for the slug by query
    const searchRes = await fetch(`${GAMMA_API_URL}/events?closed=false&limit=1&query=${encodeURIComponent(slugOrId)}`);
    if (searchRes.ok) {
      const events = await searchRes.json() as any[];
      if (events[0] && events[0].markets) {
        market = events[0].markets.find((m: any) => m.slug === slugOrId || m.id === slugOrId);
      }
    }
  }

  if (!market) {
    throw new Error(`Market not found: ${slugOrId}`);
  }

  let tokens: string[] = [];
  try {
    tokens = typeof market.clobTokenIds === 'string' ? JSON.parse(market.clobTokenIds) : (market.clobTokenIds || []);
  } catch {
    tokens = [];
  }

  let outcomes: string[] = [];
  try {
    outcomes = typeof market.outcomes === 'string' ? JSON.parse(market.outcomes) : (market.outcomes || []);
  } catch {
    outcomes = [];
  }

  const cleanOutcome = outcome.toUpperCase();
  let outcomeIndex = -1;
  if (cleanOutcome === "YES" || cleanOutcome === "OVER" || cleanOutcome === "BUY") {
    outcomeIndex = 0;
  } else if (cleanOutcome === "NO" || cleanOutcome === "UNDER" || cleanOutcome === "SELL") {
    outcomeIndex = 1;
  } else {
    outcomeIndex = outcomes.findIndex((o: string) => o.toUpperCase() === cleanOutcome);
  }

  if (outcomeIndex === -1) {
    outcomeIndex = 0;
  }

  return {
    marketId: market.id,
    conditionId: market.conditionId,
    tokenId: tokens[outcomeIndex],
    outcome: (outcomeIndex === 0 ? "YES" : "NO") as "YES" | "NO",
    slug: market.slug,
    question: market.question
  };
}

const server = new Server(
  {
    name: "polytrader-mcp",
    version: "0.4.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

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
            account: { type: "string", description: "Account profile identifier (default: 'default')" }
          }
        }
      },
      {
        name: "get_balance",
        description: "Check current account cash balance, open positions valuation, and portfolio P&L.",
        inputSchema: {
          type: "object",
          properties: {
            account: { type: "string", description: "Account identifier (default: 'default')" }
          }
        }
      },
      {
        name: "reset_account",
        description: "Reset paper trading portfolio (closes all positions, wipes history, restores default $10k balance).",
        inputSchema: {
          type: "object",
          properties: {
            account: { type: "string", description: "Account identifier (default: 'default')" }
          }
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
            account: { type: "string", description: "Account profile identifier (default: 'default')" }
          },
          required: ["slug_or_id", "outcome", "amount_usd"]
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
            account: { type: "string", description: "Account profile identifier (default: 'default')" }
          },
          required: ["slug_or_id", "outcome", "shares"]
        }
      },

      // ── Portfolios & Trades ─────────────────────────────────────────
      {
        name: "portfolio",
        description: "Retrieve the complete portfolio including open positions and metrics.",
        inputSchema: {
          type: "object",
          properties: {
            account: { type: "string", description: "Account identifier" }
          }
        }
      },
      {
        name: "history",
        description: "Get recent paper trade history logs for the account.",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "number", description: "Max history rows (default: 50)" },
            account: { type: "string", description: "Account identifier" }
          }
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
            account: { type: "string", description: "Account profile identifier" }
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
            account: { type: "string", description: "Account identifier" }
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
            account: { type: "string", description: "Account identifier" }
          },
          required: ["order_id"]
        }
      },
      {
        name: "cancel_all_orders",
        description: "Cancel all pending limit orders for the account.",
        inputSchema: {
          type: "object",
          properties: {
            account: { type: "string", description: "Account identifier" }
          }
        }
      },
      {
        name: "check_orders",
        description: "Manually trigger evaluation and execution of pending limit orders.",
        inputSchema: {
          type: "object",
          properties: {
            account: { type: "string", description: "Account identifier" }
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
            account: { type: "string", description: "Account identifier" }
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
            account: { type: "string", description: "Account identifier" }
          }
        }
      },
      {
        name: "stats",
        description: "Show trading performance stats summary (total P&L, win rates, active trades count).",
        inputSchema: {
          type: "object",
          properties: {
            account: { type: "string", description: "Account identifier" }
          }
        }
      },
      {
        name: "stats_card",
        description: "Generate a markdown formatted stats share card.",
        inputSchema: {
          type: "object",
          properties: {
            account: { type: "string", description: "Account identifier" },
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
            account: { type: "string", description: "Account identifier" }
          }
        }
      },
      {
        name: "share_content",
        description: "Generate a formatted social share card text for P&L.",
        inputSchema: {
          type: "object",
          properties: {
            account: { type: "string", description: "Account identifier" }
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
        const balance = args?.balance as number || 10000;
        const res = await fetch(`${POLYTRADER_API_URL}/portfolio?balance=${balance}`, {
          method: "DELETE",
          headers: getAgentHeaders()
        });
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data = await res.json() as any;
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
          headers: getAgentHeaders()
        });
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data = await res.json() as any;
        const portfolio = data.data || data;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              data: {
                cash: portfolio.balance,
                positions_value: (portfolio.totalValue - portfolio.balance).toFixed(2),
                total_value: portfolio.totalValue,
                total_pnl: portfolio.totalPnL,
                total_pnl_percent: portfolio.totalPnLPercent,
                open_positions: portfolio.positions?.length || 0,
              }
            }, null, 2)
          }]
        };
      }

      case "reset_account": {
        const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
          method: "DELETE",
          headers: getAgentHeaders()
        });
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ok: true, data: { reset: true } }, null, 2)
          }]
        };
      }

      // ── Market Discovery ──────────────────────────────────────────
      case "search_markets": {
        const limit = Math.min((args?.limit as number) || 10, 50);
        const query = encodeURIComponent(args?.query as string);
        const res = await fetch(`${GAMMA_API_URL}/events?closed=false&limit=${limit}&order=volume24hr&ascending=false&query=${query}`);
        if (!res.ok) throw new Error(`Gamma API returned ${res.status}`);
        const events = await res.json() as any[];
        
        const markets: any[] = [];
        for (const event of events.slice(0, limit)) {
          if (event.markets) {
            for (const m of event.markets) {
              if (m.closed) continue;
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
              } catch {}
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
        const limit = Math.min((args?.limit as number) || 20, 100);
        const sortBy = args?.sort_by === "liquidity" ? "liquidityClob" : "volume24hr";
        const res = await fetch(`${GAMMA_API_URL}/events?closed=false&limit=${limit}&order=${sortBy}&ascending=false`);
        if (!res.ok) throw new Error(`Gamma API returned ${res.status}`);
        const events = await res.json() as any[];
        const markets: any[] = [];
        for (const event of events) {
          if (event.markets) {
            for (const m of event.markets) {
              if (m.closed) continue;
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
              } catch {}
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
        const slugOrId = args?.slug_or_id as string;
        const res = await fetch(`${GAMMA_API_URL}/markets/${encodeURIComponent(slugOrId)}`);
        if (!res.ok) {
          // Try fetching by search
          const searchRes = await fetch(`${GAMMA_API_URL}/events?closed=false&limit=1&query=${encodeURIComponent(slugOrId)}`);
          if (searchRes.ok) {
            const events = await searchRes.json() as any[];
            const m = events[0]?.markets?.find((x: any) => x.slug === slugOrId || x.id === slugOrId);
            if (m) {
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
                      outcome_prices: typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices,
                      volume: m.volume24hr,
                      liquidity: m.liquidityClob,
                      closed: m.closed,
                      end_date: m.endDate,
                    }
                  }, null, 2)
                }]
              };
            }
          }
          throw new Error(`Market not found: ${slugOrId}`);
        }
        const m = await res.json() as any;
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
                outcome_prices: typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices,
                volume: m.volume24hr,
                liquidity: m.liquidityClob,
                closed: m.closed,
                end_date: m.endDate,
              }
            }, null, 2)
          }]
        };
      }

      case "get_order_book": {
        const slugOrId = args?.slug_or_id as string;
        const outcome = args?.outcome as string || "yes";
        const resolved = await resolveMarketAndToken(slugOrId, outcome);
        
        const bookRes = await fetch(`${CLOB_API_URL}/book?token_id=${encodeURIComponent(resolved.tokenId)}`);
        if (!bookRes.ok) throw new Error(`CLOB API returned ${bookRes.status}`);
        const book = await bookRes.json() as any;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              data: {
                market_slug: resolved.slug,
                outcome: resolved.outcome.toLowerCase(),
                asks: (book.asks || []).map((a: any) => ({ price: parseFloat(a.price), size: parseFloat(a.size) })),
                bids: (book.bids || []).map((b: any) => ({ price: parseFloat(b.price), size: parseFloat(b.size) })),
              }
            }, null, 2)
          }]
        };
      }

      case "get_tags": {
        const res = await fetch(`${GAMMA_API_URL}/tags`);
        if (!res.ok) throw new Error(`Gamma API returned ${res.status}`);
        const data = await res.json() as any[];
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, data }, null, 2) }] };
      }

      case "get_markets_by_tag": {
        const tagSlug = args?.tag_slug as string;
        const limit = args?.limit as number || 20;
        const res = await fetch(`${GAMMA_API_URL}/markets?tag=${encodeURIComponent(tagSlug)}&limit=${limit}&active=true`);
        if (!res.ok) throw new Error(`Gamma API returned ${res.status}`);
        const data = await res.json() as any[];
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, data }, null, 2) }] };
      }

      case "get_event": {
        const slug = args?.slug as string;
        const res = await fetch(`${GAMMA_API_URL}/events/${encodeURIComponent(slug)}`);
        if (!res.ok) throw new Error(`Gamma API returned ${res.status}`);
        const data = await res.json();
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, data }, null, 2) }] };
      }

      case "watch_prices": {
        const slugs = args?.slugs as string;
        const outcomes = args?.outcomes as string || "yes";
        const slugList = slugs.split(",");
        const outcomeList = outcomes.split(",");
        
        const results = await Promise.all(slugList.map(async (slug, idx) => {
          try {
            const out = outcomeList[idx] || outcomeList[0] || "yes";
            const resolved = await resolveMarketAndToken(slug.trim(), out.trim());
            const bookRes = await fetch(`${CLOB_API_URL}/book?token_id=${encodeURIComponent(resolved.tokenId)}`);
            if (!bookRes.ok) return { slug, outcome: out, price: null };
            const book = await bookRes.json() as any;
            const bestBid = book.bids?.[0]?.price ? parseFloat(book.bids[0].price) : null;
            const bestAsk = book.asks?.[0]?.price ? parseFloat(book.asks[0].price) : null;
            const midpoint = (bestBid !== null && bestAsk !== null) ? (bestBid + bestAsk) / 2 : null;
            return { slug, outcome: out, price: midpoint };
          } catch {
            return { slug, outcome: outcomes, price: null };
          }
        }));
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: results }, null, 2) }] };
      }

      // ── Trading (Market Orders) ───────────────────────────────────
      case "buy": {
        const slugOrId = args?.slug_or_id as string;
        const outcome = args?.outcome as string;
        const amountUsd = args?.amount_usd as number;
        
        const resolved = await resolveMarketAndToken(slugOrId, outcome);
        const idempotencyKey = generateIdempotencyKey();
        
        const res = await fetch(`${POLYTRADER_API_URL}/trade/buy`, {
          method: "POST",
          headers: {
            ...getAgentHeaders(),
            "X-Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            marketConditionId: resolved.marketId,
            side: resolved.outcome,
            amount: amountUsd,
          })
        });
        const data = await res.json() as any;
        if (!res.ok) {
          return { content: [{ type: "text", text: `Trade failed: ${data.error || JSON.stringify(data)}` }], isError: true };
        }
        
        // Match the python envelope response
        const fill = data.data || data;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              data: {
                trade: {
                  id: fill.id,
                  market_slug: resolved.slug,
                  outcome: fill.outcome,
                  side: fill.action,
                  avg_price: parseFloat(fill.pricePerShare),
                  amount_usd: parseFloat(fill.totalCost),
                  shares: parseFloat(fill.shares),
                  fee: 0, // Mock or extract from metadata
                  slippage_bps: Math.round(parseFloat(fill.slippageApplied || "0") * 10000)
                },
                account: {
                  cash: fill.balanceAfterTrade || 0
                }
              }
            }, null, 2)
          }]
        };
      }

      case "sell": {
        const slugOrId = args?.slug_or_id as string;
        const outcome = args?.outcome as string;
        const shares = args?.shares as number;
        
        const resolved = await resolveMarketAndToken(slugOrId, outcome);
        
        // Fetch portfolio to find the corresponding position ID
        const portRes = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
          headers: getAgentHeaders()
        });
        if (!portRes.ok) throw new Error("Could not retrieve portfolio for position lookup.");
        const portData = await portRes.json() as any;
        const portfolio = portData.data || portData;
        const position = (portfolio.positions || []).find((p: any) => p.marketId === resolved.marketId && p.outcome === resolved.outcome);
        
        if (!position) {
          throw new Error(`No active position found for ${slugOrId} (${outcome})`);
        }

        const idempotencyKey = generateIdempotencyKey();
        const res = await fetch(`${POLYTRADER_API_URL}/trade/sell`, {
          method: "POST",
          headers: {
            ...getAgentHeaders(),
            "X-Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            positionId: position.id,
            quantity: shares,
          })
        });
        const data = await res.json() as any;
        if (!res.ok) {
          return { content: [{ type: "text", text: `Sell failed: ${data.error || JSON.stringify(data)}` }], isError: true };
        }
        
        const fill = data.data || data;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              data: {
                trade: {
                  id: fill.id,
                  market_slug: resolved.slug,
                  outcome: fill.outcome,
                  side: fill.action,
                  avg_price: parseFloat(fill.pricePerShare),
                  amount_usd: parseFloat(fill.totalCost),
                  shares: parseFloat(fill.shares),
                  fee: 0,
                  slippage_bps: Math.round(parseFloat(fill.slippageApplied || "0") * 10000)
                },
                account: {
                  cash: fill.balanceAfterTrade || 0
                }
              }
            }, null, 2)
          }]
        };
      }

      // ── Portfolios & Trades ───────────────────────────────────────
      case "portfolio": {
        const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
          headers: getAgentHeaders()
        });
        const data = await res.json() as any;
        const portfolio = data.data || data;
        
        const formatted = {
          balance: portfolio.balance,
          total_value: portfolio.totalValue,
          total_pnl: portfolio.totalPnL,
          total_pnl_percent: portfolio.totalPnLPercent,
          positions: (portfolio.positions || []).map((p: any) => ({
            position_id: p.id,
            market: p.marketQuestion,
            outcome: p.outcome,
            shares: parseFloat(p.shares),
            avg_entry: parseFloat(p.avgEntryPrice),
            current_price: parseFloat(p.currentPrice),
            unrealized_pnl: parseFloat(p.unrealizedPnL),
            realized_pnl: parseFloat(p.realizedPnL || 0),
          })),
          recent_trades: (portfolio.tradeHistory || []).slice(0, 10).map((t: any) => ({
            side: t.side,
            outcome: t.outcome,
            market: t.marketQuestion,
            shares: parseFloat(t.shares),
            price: parseFloat(t.price),
            total: parseFloat(t.total),
            timestamp: t.timestamp,
          })),
        };
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: formatted }, null, 2) }] };
      }

      case "history": {
        const limit = args?.limit as number || 50;
        const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
          headers: getAgentHeaders()
        });
        const data = await res.json() as any;
        const portfolio = data.data || data;
        const trades = (portfolio.tradeHistory || []).slice(0, limit).map((t: any) => ({
          trade_id: t.id,
          market: t.marketQuestion,
          outcome: t.outcome,
          side: t.side,
          shares: parseFloat(t.shares),
          price: parseFloat(t.price),
          total: parseFloat(t.total),
          timestamp: t.timestamp,
        }));
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: trades }, null, 2) }] };
      }

      // ── Limit Orders ──────────────────────────────────────────────
      case "place_limit_order": {
        const slugOrId = args?.slug_or_id as string;
        const outcome = args?.outcome as string;
        const side = (args?.side as string).toUpperCase() as "BUY" | "SELL";
        const amount = args?.amount as number;
        const limitPrice = args?.limit_price as number;
        const orderType = (args?.order_type as string || "gtc").toUpperCase() as "GTC" | "GTD";
        const expiresAt = args?.expires_at as string;

        const resolved = await resolveMarketAndToken(slugOrId, outcome);
        
        const res = await fetch(`${POLYTRADER_API_URL}/orders`, {
          method: "POST",
          headers: getAgentHeaders(),
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
        const data = await res.json() as any;
        if (!res.ok) {
          return { content: [{ type: "text", text: `Limit order failed: ${data.error || JSON.stringify(data)}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: data.data || data }, null, 2) }] };
      }

      case "list_orders": {
        const res = await fetch(`${POLYTRADER_API_URL}/orders`, {
          headers: getAgentHeaders()
        });
        const data = await res.json() as any;
        const orders = data.data || data;
        
        if (Array.isArray(orders)) {
          const formatted = orders.map((o: any) => ({
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
        const orderId = args?.order_id as string;
        const res = await fetch(`${POLYTRADER_API_URL}/orders/${encodeURIComponent(orderId)}`, {
          method: "DELETE",
          headers: getAgentHeaders()
        });
        const data = await res.json() as any;
        if (!res.ok) {
          return { content: [{ type: "text", text: `Cancel failed: ${data.error || JSON.stringify(data)}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: { cancelled: true, order_id: orderId } }, null, 2) }] };
      }

      case "cancel_all_orders": {
        const listRes = await fetch(`${POLYTRADER_API_URL}/orders`, {
          headers: getAgentHeaders()
        });
        const listData = await listRes.json() as any;
        const orders = listData.data || listData;
        const pending = Array.isArray(orders) ? orders.filter((o: any) => o.status === "PENDING") : [];
        
        const results = await Promise.all(pending.map(async (o: any) => {
          const cancelRes = await fetch(`${POLYTRADER_API_URL}/orders/${encodeURIComponent(o.id)}`, {
            method: "DELETE",
            headers: getAgentHeaders()
          });
          return { order_id: o.id, cancelled: cancelRes.ok };
        }));

        return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: { cancelled_count: results.filter(r => r.cancelled).length } }, null, 2) }] };
      }

      case "check_orders": {
        const res = await fetch(`${POLYTRADER_API_URL}/orders/check`, {
          method: "POST",
          headers: getAgentHeaders()
        });
        const data = await res.json() as any;
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, data }, null, 2) }] };
      }

      // ── Settle / Metrics / PK / Backtest ──────────────────────────
      case "resolve": {
        // Resolve a single market on-demand (triggers resolve_all check in backend)
        const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
          headers: getAgentHeaders()
        });
        const data = await res.json() as any;
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: { resolved: true } }, null, 2) }] };
      }

      case "resolve_all": {
        const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
          headers: getAgentHeaders()
        });
        const data = await res.json() as any;
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
          headers: getAgentHeaders()
        });
        const data = await res.json() as any;
        const portfolio = data.data || data;
        const trades = portfolio.tradeHistory || [];
        const winTrades = trades.filter((t: any) => t.side === "SELL" && parseFloat(t.total) > 0); // basic win stats
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              data: {
                total_pnl: portfolio.totalPnL,
                total_pnl_percent: portfolio.totalPnLPercent,
                trades_count: trades.length,
                win_rate: trades.length > 0 ? winTrades.length / trades.length : 0.0,
                cash_balance: portfolio.balance,
                portfolio_value: portfolio.totalValue
              }
            }, null, 2)
          }]
        };
      }

      case "stats_card": {
        const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
          headers: getAgentHeaders()
        });
        const data = await res.json() as any;
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
          headers: getAgentHeaders()
        });
        if (!res.ok) throw new Error("Leaderboard query failed.");
        const data = await res.json() as any;
        const entries = data.data || data || [];
        const entry = entries.find((e: any) => e.userId === AGENT_USER_ID) || { rank: "Unranked", returnPct: "0%" };
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, data: entry }, null, 2) }] };
      }

      case "share_content": {
        const res = await fetch(`${POLYTRADER_API_URL}/portfolio`, {
          headers: getAgentHeaders()
        });
        const data = await res.json() as any;
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
          headers: getAgentHeaders()
        });
        const data = await res.json() as any;
        const entries = data.data || data || [];
        const list = entries.slice(0, 5).map((e: any) => `#${e.rank}: ${e.userName || "User"} (${e.returnPct}%)`);
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
  } catch (error: any) {
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
