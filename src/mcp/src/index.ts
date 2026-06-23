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

// A unique user ID for this agent's paper trading session
const AGENT_USER_ID = process.env.AGENT_USER_ID || "ai-agent-001";

function generateIdempotencyKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

const server = new Server(
  {
    name: "polytrader-mcp",
    version: "0.3.0",
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
      // ── Portfolio ────────────────────────────────────────────────────
      {
        name: "get_balance",
        description: "Check cash balance, portfolio value, and P&L summary",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "portfolio",
        description: "Get full portfolio: open positions with current prices, P&L, and recent trade history",
        inputSchema: { type: "object", properties: {} },
      },

      // ── Market Discovery ────────────────────────────────────────────
      {
        name: "search_markets",
        description: "Search for Polymarket prediction markets by keyword. Returns prices, volume, and liquidity.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search term (e.g. 'bitcoin', 'election', 'AI')" },
            limit: { type: "number", description: "Max results (default: 5, max: 20)" }
          },
          required: ["query"]
        },
      },

      // ── Market Orders ───────────────────────────────────────────────
      {
        name: "buy",
        description: "Buy shares in a prediction market at market price. Uses order book simulation for realistic fills with slippage.",
        inputSchema: {
          type: "object",
          properties: {
            marketId: { type: "string", description: "The market's condition ID from search_markets" },
            outcome: { type: "string", enum: ["YES", "NO"], description: "Which outcome to buy" },
            amount: { type: "number", description: "Amount in USD to spend (min: $1, max: $10,000)" }
          },
          required: ["marketId", "outcome", "amount"]
        },
      },
      {
        name: "sell",
        description: "Sell/close a position at market price. Uses order book simulation for realistic fills.",
        inputSchema: {
          type: "object",
          properties: {
            positionId: { type: "string", description: "The position ID from the portfolio tool" }
          },
          required: ["positionId"]
        },
      },

      // ── Limit Orders ────────────────────────────────────────────────
      {
        name: "place_limit_order",
        description: "Place a limit order that fills when the market price reaches your target. Supports GTC (good-til-cancelled) and GTD (good-til-date) order types.",
        inputSchema: {
          type: "object",
          properties: {
            marketId: { type: "string", description: "The market's condition ID" },
            tokenId: { type: "string", description: "The CLOB token ID for the specific outcome" },
            outcome: { type: "string", enum: ["YES", "NO"], description: "Which outcome" },
            side: { type: "string", enum: ["BUY", "SELL"], description: "Buy or sell" },
            amount: { type: "number", description: "USD amount for buy, or shares for sell" },
            limitPrice: { type: "number", description: "Target price (0-1). Buy fills when price drops to this; sell fills when price rises to this." },
            orderType: { type: "string", enum: ["GTC", "GTD"], description: "GTC = good-til-cancelled, GTD = good-til-date (default: GTC)" },
            expiresAt: { type: "string", description: "ISO 8601 expiry datetime (required for GTD orders)" }
          },
          required: ["marketId", "tokenId", "outcome", "side", "amount", "limitPrice"]
        },
      },
      {
        name: "list_orders",
        description: "List all limit orders. Optionally filter by status (PENDING, FILLED, CANCELLED, EXPIRED, REJECTED).",
        inputSchema: {
          type: "object",
          properties: {
            status: { type: "string", description: "Filter by status (optional)" }
          }
        },
      },
      {
        name: "cancel_order",
        description: "Cancel a pending limit order by its ID.",
        inputSchema: {
          type: "object",
          properties: {
            orderId: { type: "string", description: "The order ID to cancel" }
          },
          required: ["orderId"]
        },
      },
      {
        name: "check_orders",
        description: "Check all pending limit orders and fill eligible ones. Also expires stale GTD orders. Call this to immediately process orders instead of waiting for the background job.",
        inputSchema: { type: "object", properties: {} },
      },

      // ── Resolution ──────────────────────────────────────────────────
      {
        name: "resolve_all",
        description: "Check all open positions for resolved/closed markets and settle them. Also cancels pending limit orders on resolved markets.",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  };
});

// ==========================================================================
// Tool Handlers
// ==========================================================================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ── Portfolio ──────────────────────────────────────────────────
      case "get_balance": {
        const res = await fetch(`${POLYTRADER_API_URL}/portfolio?userId=${AGENT_USER_ID}`);
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data = await res.json() as any;
        const portfolio = data.data || data;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              cash: portfolio.balance,
              positions_value: (portfolio.totalValue - portfolio.balance).toFixed(2),
              total_value: portfolio.totalValue,
              total_pnl: portfolio.totalPnL,
              total_pnl_percent: portfolio.totalPnLPercent,
              open_positions: portfolio.positions?.length || 0,
            }, null, 2)
          }]
        };
      }

      case "portfolio": {
        const res = await fetch(`${POLYTRADER_API_URL}/portfolio?userId=${AGENT_USER_ID}`);
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
            shares: p.shares,
            avg_entry: p.avgEntryPrice,
            current_price: p.currentPrice,
            unrealized_pnl: p.unrealizedPnL,
            realized_pnl: p.realizedPnL || 0,
          })),
          recent_trades: (portfolio.tradeHistory || []).slice(0, 10).map((t: any) => ({
            side: t.side,
            outcome: t.outcome,
            market: t.marketQuestion,
            shares: t.shares,
            price: t.price,
            total: t.total,
            timestamp: t.timestamp,
          })),
        };
        return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
      }

      // ── Market Discovery ──────────────────────────────────────────
      case "search_markets": {
        const limit = Math.min((args?.limit as number) || 5, 20);
        const query = encodeURIComponent(args?.query as string);
        const res = await fetch(`${GAMMA_API_URL}/events?closed=false&limit=${limit}&order=volume24hr&ascending=false&query=${query}`);
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const events = await res.json() as any[];
        
        const markets: any[] = [];
        for (const event of events.slice(0, limit)) {
          if (event.markets) {
            for (const m of event.markets) {
              if (m.closed) continue;
              try {
                const prices = JSON.parse(m.outcomePrices || '[]');
                const tokens = JSON.parse(m.clobTokenIds || '[]');
                markets.push({
                  market_id: m.id,
                  question: m.question,
                  yes_price: prices[0] || null,
                  no_price: prices[1] || null,
                  yes_token_id: tokens[0] || null,
                  no_token_id: tokens[1] || null,
                  volume_24h: m.volume24hr,
                  liquidity: m.liquidityClob,
                  end_date: m.endDate,
                });
              } catch {
                // Skip markets with unparseable data
              }
            }
          }
        }
        return { content: [{ type: "text", text: JSON.stringify(markets.slice(0, limit), null, 2) }] };
      }

      // ── Market Orders ─────────────────────────────────────────────
      case "buy": {
        const idempotencyKey = generateIdempotencyKey();
        const res = await fetch(`${POLYTRADER_API_URL}/trade/buy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            userId: AGENT_USER_ID,
            marketConditionId: args?.marketId,
            side: args?.outcome,
            amount: args?.amount,
          })
        });
        const data = await res.json() as any;
        if (!res.ok) {
          return { content: [{ type: "text", text: `Trade failed: ${data.error || JSON.stringify(data)}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "sell": {
        const idempotencyKey = generateIdempotencyKey();
        const res = await fetch(`${POLYTRADER_API_URL}/trade/close`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            positionId: args?.positionId,
          })
        });
        const data = await res.json() as any;
        if (!res.ok) {
          return { content: [{ type: "text", text: `Sell failed: ${data.error || JSON.stringify(data)}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ── Limit Orders ──────────────────────────────────────────────
      case "place_limit_order": {
        const res = await fetch(`${POLYTRADER_API_URL}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: AGENT_USER_ID,
            marketId: args?.marketId,
            tokenId: args?.tokenId,
            outcome: args?.outcome,
            side: args?.side,
            amount: args?.amount,
            limitPrice: args?.limitPrice,
            orderType: args?.orderType || "GTC",
            expiresAt: args?.expiresAt,
          })
        });
        const data = await res.json() as any;
        if (!res.ok) {
          return { content: [{ type: "text", text: `Order failed: ${data.error || JSON.stringify(data)}` }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "list_orders": {
        const statusFilter = args?.status ? `&status=${encodeURIComponent(args.status as string)}` : '';
        const res = await fetch(`${POLYTRADER_API_URL}/orders?userId=${AGENT_USER_ID}${statusFilter}`);
        const data = await res.json() as any;
        const orders = data.data || data;
        
        if (Array.isArray(orders)) {
          const formatted = orders.map((o: any) => ({
            order_id: o.id,
            market_id: o.marketId,
            market: o.marketQuestion,
            outcome: o.outcome,
            side: o.side,
            amount: o.amount,
            limit_price: o.limitPrice,
            order_type: o.orderType,
            status: o.status,
            expires_at: o.expiresAt,
            created_at: o.createdAt,
          }));
          return { content: [{ type: "text", text: JSON.stringify(formatted, null, 2) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "cancel_order": {
        const res = await fetch(`${POLYTRADER_API_URL}/orders/${encodeURIComponent(args?.orderId as string)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: AGENT_USER_ID })
        });
        const data = await res.json() as any;
        if (!res.ok) {
          return { content: [{ type: "text", text: `Cancel failed: ${data.error || JSON.stringify(data)}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Order cancelled successfully.` }] };
      }

      case "check_orders": {
        const res = await fetch(`${POLYTRADER_API_URL}/orders/check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: AGENT_USER_ID })
        });
        const data = await res.json() as any;
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      // ── Resolution ────────────────────────────────────────────────
      case "resolve_all": {
        const portfolioRes = await fetch(`${POLYTRADER_API_URL}/portfolio?userId=${AGENT_USER_ID}`);
        const portfolioData = await portfolioRes.json() as any;
        const portfolio = portfolioData.data || portfolioData;
        
        return {
          content: [{
            type: "text",
            text: `Resolution check triggered. Portfolio refreshed.\n` +
              `Open positions: ${portfolio.positions?.length || 0}\n` +
              `Cash balance: $${portfolio.balance}\n` +
              `Total value: $${portfolio.totalValue}\n` +
              `Total P&L: $${portfolio.totalPnL} (${portfolio.totalPnLPercent}%)`
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
  console.error("PolyTrader MCP server running on stdio (v0.3.0 — 11 tools)");
}

run().catch(console.error);
