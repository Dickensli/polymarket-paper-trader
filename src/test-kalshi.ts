import { config } from "dotenv";
import { readFileSync } from "fs";
import { constants, sign as cryptoSign } from "crypto";

config({ path: ".env.local" });

function loadKalshiPrivateKey(): string {
  const useDemo = process.env.KALSHI_USE_DEMO === 'true';
  const pem = useDemo ? process.env.KALSHI_DEMO_PRIVATE_KEY_PEM : process.env.KALSHI_PRIVATE_KEY_PEM;
  if (pem) return pem.replace(/\\n/g, '\n');
  const pathVar = useDemo ? 'KALSHI_DEMO_PRIVATE_KEY_PATH' : 'KALSHI_PRIVATE_KEY_PATH';
  return readFileSync(process.env[pathVar]!, 'utf8');
}

function kalshiSign(method: string, path: string): Record<string, string> {
  const timestamp = Date.now().toString();
  const cleanPath = path.split('?')[0];
  const signedPath = cleanPath.startsWith('/trade-api/v2') ? cleanPath : `/trade-api/v2${cleanPath}`;
  const message = Buffer.from(`${timestamp}${method.toUpperCase()}${signedPath}`, 'utf8');
  const signature = cryptoSign('sha256', message, {
    key: loadKalshiPrivateKey(),
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64');
  const apiKeyId = (process.env.KALSHI_USE_DEMO === 'true') ? process.env.KALSHI_DEMO_API_KEY_ID! : process.env.KALSHI_API_KEY_ID!;
  return {
    'KALSHI-ACCESS-KEY': apiKeyId,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'KALSHI-ACCESS-SIGNATURE': signature,
  };
}

async function run() {
  const baseUrl = 'https://demo-api.kalshi.co/trade-api/v2';
  const res = await fetch(`${baseUrl}/portfolio/positions`, {
    method: 'GET',
    headers: { 'Accept': 'application/json', ...kalshiSign('GET', '/portfolio/positions') }
  });
  console.log(JSON.stringify(await res.json(), null, 2));
}
run();
