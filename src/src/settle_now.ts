import { runResolutionCheck } from './worker/jobs/resolution-handler';
import { getDb } from './lib/db';

async function main() {
  console.log('Manually triggering resolution check...');
  const count = await runResolutionCheck();
  console.log(`Settled ${count} positions.`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
