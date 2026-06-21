import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";

// The endpoint for our PolyTrader Next.js API
// You can pass it as an environment variable or default to localhost
const POLYTRADER_API_URL = process.env.POLYTRADER_API_URL || "http://localhost:3000/api";
const GAMMA_API_URL = "https://gamma-api.polymarket.com";

// A unique user ID for this agent's paper trading session
const AGENT_USER_ID = process.env.AGENT_USER_ID || "ai-agent-001";

const server = new Server(
  {
    name: "polytrader-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_balance",
        description: "Check cash balance and portfolio value",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "search_markets",
        description: "Find Polymarket markets by keyword",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search term" },
            limit: { type: "number", description: "Max results" }
          },
          required: ["query"]
        },
      },
      {
        name: "buy",
        description: "Buy shares in a prediction market on PolyTrader",
        inputSchema: {
          type: "object",
          properties: {
            marketId: { type: "string" },
            outcome: { type: "string", description: "'YES' or 'NO'" },
            shares: { type: "number", description: "Number of shares to buy" }
          },
          required: ["marketId", "outcome", "shares"]
        },
      },
      {
        name: "portfolio",
        description: "Get all open positions",
        inputSchema: { type: "object", properties: {} },
      }
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_balance": {
        const res = await fetch(`${POLYTRADER_API_URL}/portfolio?userId=${AGENT_USER_ID}`);
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data = await res.json() as any;
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "search_markets": {
        const res = await fetch(`${GAMMA_API_URL}/events?query=${encodeURIComponent(args?.query as string)}`);
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data = await res.json() as any;
        return { content: [{ type: "text", text: JSON.stringify(data.slice(0, args?.limit || 5), null, 2) }] };
      }

      case "buy": {
        const res = await fetch(`${POLYTRADER_API_URL}/trade/buy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: AGENT_USER_ID,
            marketId: args?.marketId,
            outcome: args?.outcome,
            shares: args?.shares,
            // In a real scenario we'd query Gamma API first to get latest price
            price: 0.50 
          })
        });
        const data = await res.json() as any;
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "portfolio": {
        const res = await fetch(`${POLYTRADER_API_URL}/portfolio?userId=${AGENT_USER_ID}`);
        const data = await res.json() as any;
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
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

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("PolyTrader MCP server running on stdio");
}

run().catch(console.error);
