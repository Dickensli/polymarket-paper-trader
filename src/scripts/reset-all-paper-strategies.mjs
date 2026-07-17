import postgres from 'postgres';
import nextEnv from '@next/env';

const CONFIRM_FLAG = '--confirm-reset-all-paper';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

if (!process.argv.includes(CONFIRM_FLAG)) {
  console.error(`Refusing destructive reset. Re-run with ${CONFIRM_FLAG}.`);
  process.exit(2);
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
});

const RESET_BALANCE = '10000.00';
const resetAt = new Date();
const hourly = new Date(resetAt); hourly.setUTCMinutes(0, 0, 0);
const daily = new Date(resetAt); daily.setUTCHours(0, 0, 0, 0);

let paperStrategies = [];
try {
  paperStrategies = await sql`
    select id, user_id, strategy_id, platform, status, metadata
    from strategies
    where agent_mode = 'paper'
    order by platform, strategy_id, id
  `;
  if (paperStrategies.length === 0) {
    console.log(JSON.stringify({ reset_at: resetAt.toISOString(), strategies: 0, reports_deleted: 0 }));
    process.exit(0);
  }

  const strategyIds = paperStrategies.map((row) => row.id);
  const userIds = [...new Set(paperStrategies.map((row) => row.user_id))];
  const priorStatuses = new Map(paperStrategies.map((row) => [row.id, row.status]));

  // Commit the pause first so concurrent agent requests observe it before the
  // destructive transaction starts.
  await sql`update strategies set status = 'paused', updated_at = ${resetAt} where id in ${sql(strategyIds)}`;

  let reportsDeleted = 0;
  try {
    await sql.begin(async (tx) => {
      await tx`
        update portfolios
        set balance = ${RESET_BALANCE}, initial_balance = ${RESET_BALANCE}, updated_at = ${resetAt}
        where user_id in ${tx(userIds)}
      `;

      await tx`delete from limit_orders where user_id in ${tx(userIds)}`;
      await tx`delete from paper_trade_orders where strategy_id in ${tx(strategyIds)} or user_id in ${tx(userIds)}`;
      await tx`delete from strategy_decisions where strategy_id in ${tx(strategyIds)}`;
      await tx`delete from portfolio_snapshots where strategy_id in ${tx(strategyIds)}`;
      await tx`delete from strategy_performance_snapshots where strategy_id in ${tx(strategyIds)}`;
      await tx`delete from strategy_capital_flows where strategy_id in ${tx(strategyIds)}`;
      await tx`delete from reconciliation_logs where strategy_id in ${tx(strategyIds)}`;
      await tx`delete from positions where user_id in ${tx(userIds)}`;
      await tx`delete from paper_trades where strategy_id in ${tx(strategyIds)} or user_id in ${tx(userIds)}`;
      await tx`delete from ledger_entries where user_id in ${tx(userIds)}`;
      await tx`delete from strategy_runs where strategy_id in ${tx(strategyIds)}`;
      await tx`delete from leaderboard_snapshots where user_id in ${tx(userIds)}`;

      const deletedReports = await tx`delete from agent_reports returning id`;
      reportsDeleted = deletedReports.length;

      for (const strategy of paperStrategies) {
        const metadata = {
          ...(strategy.metadata ?? {}),
          performance_baseline_at: resetAt.toISOString(),
          last_destructive_reset_at: resetAt.toISOString(),
          reset_balance: 10000,
        };
        await tx`
          update strategies
          set starting_balance = ${RESET_BALANCE}, metadata = ${tx.json(metadata)}, updated_at = ${resetAt}
          where id = ${strategy.id}
        `;
        await tx`
          insert into strategy_performance_snapshots (
            strategy_id, user_id, platform, agent_mode, bucket, bucket_at,
            cash, positions_value, nav, pnl, return_pct, period_return_pct,
            twr_pct, mwr_pct, net_external_flow, unpriced_positions_count,
            pricing_updated_at, captured_at
          ) values
          (${strategy.id}, ${strategy.user_id}, ${strategy.platform}, 'paper', 'HOURLY', ${hourly},
           10000, 0, 10000, 0, 0, 0, 0, null, 0, 0, ${resetAt}, ${resetAt}),
          (${strategy.id}, ${strategy.user_id}, ${strategy.platform}, 'paper', 'DAILY', ${daily},
           10000, 0, 10000, 0, 0, 0, 0, null, 0, 0, ${resetAt}, ${resetAt})
        `;
      }
    });
  } finally {
    for (const strategy of paperStrategies) {
      await sql`
        update strategies
        set status = ${priorStatuses.get(strategy.id)}, updated_at = ${new Date()}
        where id = ${strategy.id}
      `;
    }
  }

  const verification = await sql`
    select s.id, s.strategy_id, s.platform, s.status, s.starting_balance,
           p.balance, p.initial_balance,
           (select count(*)::int from positions pos where pos.user_id=s.user_id and pos.is_open=true) as open_positions,
           (select count(*)::int from paper_trades pt where pt.strategy_id=s.id) as trades,
           (select count(*)::int from strategy_performance_snapshots ps where ps.strategy_id=s.id) as performance_points
    from strategies s
    join portfolios p on p.user_id=s.user_id
    where s.agent_mode='paper'
    order by s.platform, s.strategy_id, s.id
  `;
  const [{ reports }] = await sql`select count(*)::int as reports from agent_reports`;
  console.log(JSON.stringify({
    reset_at: resetAt.toISOString(),
    strategies: verification.length,
    reports_deleted: reportsDeleted,
    reports_remaining: reports,
    verification,
  }, null, 2));
} finally {
  await sql.end();
}
