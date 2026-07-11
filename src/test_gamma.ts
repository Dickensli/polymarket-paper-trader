import { getMarket } from './src/lib/polymarket';
import { getKalshiMarket } from './src/lib/kalshi';

async function main() {
  const m1 = await getMarket('KXBTC15M-26JUL100115-15').catch(e => ({ error: e.message }));
  console.log("Gamma:", m1);

  process.exit(0);
}
main().catch(console.error);
