import fetch from "node-fetch";

const POLYTRADER_API_URL = "https://www.polymarkettraders.com/api";
const AGENT_SECRET = "ce7e24f0c6eb56de11c66fc295fb2a804f9a76270f843e4b33d52c920ee295a8";
const AGENT_USER_ID = "dickens_smith_us";

function generateIdempotencyKey() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

async function buy(slug: string, outcome: string, amount: number) {
    const idempotencyKey = generateIdempotencyKey();
    const res = await fetch(`${POLYTRADER_API_URL}/agent/trades`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-agent-secret": AGENT_SECRET,
            "x-agent-account-id": AGENT_USER_ID,
            "x-agent-strategy-id": "cross_platform_arb",
            "x-agent-platform": "polymarket_us",
            "x-idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
            strategy_id: "cross_platform_arb",
            slug: slug,
            outcome: outcome,
            side: "BUY",
            amount: amount,
            client_order_id: idempotencyKey,
        }),
    });
    const data = await res.json();
    console.log(`Executed buy(${slug}, ${outcome}, ${amount}):`, JSON.stringify(data));
}

async function main() {
    console.log("Rerunning missing trades...");
    await buy("cbpac-usfed-2026-cut", "YES", 168.75);
    await new Promise(r => setTimeout(r, 2000));
    await buy("cpc-btc-150k-07-31-2026", "NO", 360.0);
}

main().catch(console.error);
