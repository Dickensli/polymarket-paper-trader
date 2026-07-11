import fetch from "node-fetch";
import fs from "fs";

const POLYTRADER_API_URL = "https://www.polymarkettraders.com/api";
const AGENT_SECRET = "ce7e24f0c6eb56de11c66fc295fb2a804f9a76270f843e4b33d52c920ee295a8";
const AGENT_USER_ID = "dickens_smith_us";

async function searchMarket(query: string) {
    const params = new URLSearchParams();
    params.set("query", query);
    const res = await fetch(`${POLYTRADER_API_URL}/polymarket-us/search?${params.toString()}`, {
        headers: {
            "Content-Type": "application/json",
            "x-agent-secret": AGENT_SECRET,
            "x-agent-platform": "polymarket_us",
        }
    });
    return await res.json();
}

async function main() {
    const queries = [
        "recession 2026", "recession 2027", "Fed rate cut", 
        "Bitcoin above", "Ethereum above", "president 2028", 
        "CPI inflation", "GDP growth"
    ];
    
    let allMarkets: any[] = [];
    for (const query of queries) {
        console.log(`Searching for: ${query}`);
        const data: any = await searchMarket(query);
        if (data && data.events && Array.isArray(data.events)) {
            for (const event of data.events) {
                if (event.markets && Array.isArray(event.markets)) {
                    for (const m of event.markets) {
                         let yes_price = 0;
                         let no_price = 0;
                         try {
                             if (m.outcomePrices) {
                                 const prices = JSON.parse(m.outcomePrices);
                                 yes_price = parseFloat(prices[0]) || 0;
                                 no_price = parseFloat(prices[1]) || 0;
                             }
                         } catch (e) {}

                         allMarkets.push({
                             slug: m.slug,
                             question: m.question,
                             yes_price: yes_price,
                             no_price: no_price,
                             liquidity: m.volume || 0
                         });
                    }
                }
            }
        }
    }
    
    const outputPath = "/usr/local/google/home/dickensli/.gemini/smith/trading_history/cross_platform_arb/poly_markets.json";
    const dir = outputPath.substring(0, outputPath.lastIndexOf("/"));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    fs.writeFileSync(outputPath, JSON.stringify(allMarkets, null, 2));
    console.log(`Saved ${allMarkets.length} markets to ${outputPath}`);
}

main().catch(console.error);
