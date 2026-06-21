import fs from 'fs';
import path from 'path';
import os from 'os';

const sidecarDir = path.join(os.homedir(), '.gemini/jetski/sidecars/polytrader');

if (!fs.existsSync(sidecarDir)) {
  fs.mkdirSync(sidecarDir, { recursive: true });
}

const config = {
  builtin: "schedule",
  args: [
    "0 9 * * *", // Runs every day at 9:00 AM
    "agentapi",
    "new-conversation",
    "--model=pro",
    "You are the PolyTrader AI agent. Please scan the Polymarket Gamma API using the polytrader skill. If any market presents a strong opportunity according to your Mean Reversion strategy, execute a paper trade. Finally, provide a daily summary of your actions and current portfolio valuation. Since I am connected via GChat, this conversation will automatically notify me in real-time."
  ],
  restart_policy: "always",
  description: "Daily PolyTrader AI Bot (GChat integration)"
};

fs.writeFileSync(
  path.join(sidecarDir, 'sidecar.json'),
  JSON.stringify(config, null, 2)
);

console.log('Sidecar configuration created at', path.join(sidecarDir, 'sidecar.json'));
