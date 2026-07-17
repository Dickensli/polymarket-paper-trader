#!/usr/bin/env node

import { createRequire } from 'node:module';
import process from 'node:process';

const srcRequire = createRequire(new URL('../../../../src/package.json', import.meta.url));
const postgres = srcRequire('postgres');
const nextEnv = srcRequire('@next/env');

const { loadEnvConfig } = nextEnv;
loadEnvConfig(new URL('../../../../src', import.meta.url).pathname);

function parseIntegerFlag(name, fallback, { min, max }) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function parseOptionalFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function numberOrNull(value) {
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoOrNull(value) {
  return value ? new Date(value).toISOString() : null;
}

const sinceDays = parseIntegerFlag('--since-days', 30, { min: 1, max: 365 });
const limitPerStrategy = parseIntegerFlag('--limit-per-strategy', 20, { min: 1, max: 100 });
const platformFilter = parseOptionalFlag('--platform');
const modeFilter = parseOptionalFlag('--mode');
const strategyFilter = parseOptionalFlag('--strategy-id');

if (platformFilter && !['kalshi', 'polymarket', 'polymarket_us'].includes(platformFilter)) {
  throw new Error('--platform must be kalshi, polymarket, or polymarket_us.');
}
if (modeFilter && !['paper', 'real'].includes(modeFilter)) {
  throw new Error('--mode must be paper or real.');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

const generatedAt = new Date();
const requestedSince = new Date(generatedAt.getTime() - sinceDays * 86_400_000);
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  application_name: 'strategy-prompt-flywheel-readonly',
});

try {
  await sql`set default_transaction_read_only = on`;

  const strategyRows = await sql`
    select id, strategy_id, platform, agent_mode, status, starting_balance,
           risk_config, schedule, metadata, created_at, updated_at
    from strategies
    where (${platformFilter}::text is null or platform::text = ${platformFilter})
      and (${modeFilter}::text is null or agent_mode::text = ${modeFilter})
      and (${strategyFilter}::text is null or strategy_id = ${strategyFilter})
    order by platform, agent_mode, strategy_id, id
  `;

  const strategyIds = strategyRows.map((row) => row.id);
  if (strategyIds.length === 0) {
    console.log(JSON.stringify({
      generated_at: generatedAt.toISOString(),
      requested_since: requestedSince.toISOString(),
      strategies: [],
    }, null, 2));
    process.exit(0);
  }

  const reportRows = await sql`
    with selected_strategies as (
      select id,
             greatest(
               ${requestedSince}::timestamptz,
               coalesce(
                 nullif(metadata->>'performance_baseline_at', '')::timestamptz,
                 nullif(metadata->>'last_destructive_reset_at', '')::timestamptz,
                 created_at
               )
             ) as effective_since
      from strategies
      where id in ${sql(strategyIds)}
    ), ranked as (
      select ar.*,
             row_number() over (partition by ar.strategy_id order by ar.created_at desc, ar.id desc) as row_num
      from agent_reports ar
      join selected_strategies ss on ss.id = ar.strategy_id
      where ar.created_at >= ss.effective_since
    )
    select strategy_id, filename, title, content, lessons_learned, next_steps,
           portfolio_summary, trade_summary, created_at
    from ranked
    where row_num <= ${limitPerStrategy}
    order by strategy_id, created_at
  `;

  const reportCountRows = await sql`
    with selected_strategies as (
      select id,
             greatest(
               ${requestedSince}::timestamptz,
               coalesce(
                 nullif(metadata->>'performance_baseline_at', '')::timestamptz,
                 nullif(metadata->>'last_destructive_reset_at', '')::timestamptz,
                 created_at
               )
             ) as effective_since
      from strategies
      where id in ${sql(strategyIds)}
    )
    select ar.strategy_id,
           count(*)::int as report_count,
           count(distinct created_at::date)::int as report_days,
           min(created_at) as first_report_at,
           max(created_at) as last_report_at,
           count(*) filter (
             where coalesce(portfolio_summary->'verified'->>'source', '') not in ('', 'unavailable')
           )::int as verified_portfolio_reports,
           count(*) filter (
             where coalesce(trade_summary->'verified'->>'source', '') not in ('', 'unavailable')
           )::int as verified_trade_reports
    from agent_reports ar
    join selected_strategies ss on ss.id = ar.strategy_id
    where ar.created_at >= ss.effective_since
    group by ar.strategy_id
  `;

  const performanceRows = await sql`
    with selected_strategies as (
      select id,
             greatest(
               ${requestedSince}::timestamptz,
               coalesce(
                 nullif(metadata->>'performance_baseline_at', '')::timestamptz,
                 nullif(metadata->>'last_destructive_reset_at', '')::timestamptz,
                 created_at
               )
             ) as effective_since
      from strategies
      where id in ${sql(strategyIds)}
    ), ranked as (
      select ps.*,
             row_number() over (partition by ps.strategy_id order by ps.bucket_at desc, ps.id desc) as row_num
      from strategy_performance_snapshots ps
      join selected_strategies ss on ss.id = ps.strategy_id
      where ps.bucket = 'DAILY'
        and ps.captured_at >= ss.effective_since
    )
    select strategy_id, bucket_at, nav, pnl, return_pct, period_return_pct,
           twr_pct, mwr_pct, net_external_flow, unpriced_positions_count,
           pricing_updated_at, captured_at
    from ranked
    where row_num <= 90
    order by strategy_id, bucket_at
  `;

  const decisionRows = await sql`
    with selected_strategies as (
      select id,
             greatest(
               ${requestedSince}::timestamptz,
               coalesce(
                 nullif(metadata->>'performance_baseline_at', '')::timestamptz,
                 nullif(metadata->>'last_destructive_reset_at', '')::timestamptz,
                 created_at
               )
             ) as effective_since
      from strategies
      where id in ${sql(strategyIds)}
    )
    select sd.strategy_id, sd.status, count(*)::int as count
    from strategy_decisions sd
    join selected_strategies ss on ss.id = sd.strategy_id
    where sd.created_at >= ss.effective_since
    group by sd.strategy_id, sd.status
    order by sd.strategy_id, sd.status
  `;

  const rejectionRows = await sql`
    with selected_strategies as (
      select id,
             greatest(
               ${requestedSince}::timestamptz,
               coalesce(
                 nullif(metadata->>'performance_baseline_at', '')::timestamptz,
                 nullif(metadata->>'last_destructive_reset_at', '')::timestamptz,
                 created_at
               )
             ) as effective_since
      from strategies
      where id in ${sql(strategyIds)}
    )
    select sd.strategy_id, sd.rejection_reasons, sd.created_at
    from strategy_decisions sd
    join selected_strategies ss on ss.id = sd.strategy_id
    where sd.created_at >= ss.effective_since
      and jsonb_array_length(sd.rejection_reasons) > 0
    order by sd.strategy_id, sd.created_at desc
  `;

  const paperTradeRows = await sql`
    with selected_strategies as (
      select id,
             greatest(
               ${requestedSince}::timestamptz,
               coalesce(
                 nullif(metadata->>'performance_baseline_at', '')::timestamptz,
                 nullif(metadata->>'last_destructive_reset_at', '')::timestamptz,
                 created_at
               )
             ) as effective_since
      from strategies
      where id in ${sql(strategyIds)}
    )
    select pt.strategy_id,
           count(*)::int as trade_count,
           count(*) filter (where action = 'BUY')::int as buy_count,
           count(*) filter (where action = 'SELL')::int as sell_count,
           count(distinct market_id)::int as distinct_markets,
           min(executed_at) as first_trade_at,
           max(executed_at) as last_trade_at
    from paper_trades pt
    join selected_strategies ss on ss.id = pt.strategy_id
    where pt.executed_at >= ss.effective_since
    group by pt.strategy_id
  `;

  const runRows = await sql`
    with selected_strategies as (
      select id,
             greatest(
               ${requestedSince}::timestamptz,
               coalesce(
                 nullif(metadata->>'performance_baseline_at', '')::timestamptz,
                 nullif(metadata->>'last_destructive_reset_at', '')::timestamptz,
                 created_at
               )
             ) as effective_since
      from strategies
      where id in ${sql(strategyIds)}
    )
    select sr.strategy_id,
           count(*)::int as run_count,
           count(*) filter (where status = 'completed')::int as completed_runs,
           count(*) filter (where status = 'failed')::int as failed_runs,
           coalesce(sum(trades_executed), 0)::int as reported_trades_executed,
           min(started_at) as first_run_at,
           max(started_at) as last_run_at
    from strategy_runs sr
    join selected_strategies ss on ss.id = sr.strategy_id
    where sr.started_at >= ss.effective_since
    group by sr.strategy_id
  `;

  const latestSnapshotRows = await sql`
    with selected_strategies as (
      select id,
             greatest(
               ${requestedSince}::timestamptz,
               coalesce(
                 nullif(metadata->>'performance_baseline_at', '')::timestamptz,
                 nullif(metadata->>'last_destructive_reset_at', '')::timestamptz,
                 created_at
               )
             ) as effective_since
      from strategies
      where id in ${sql(strategyIds)}
    )
    select distinct on (ps.strategy_id)
           ps.strategy_id, ps.source, ps.cash, ps.positions_value, ps.total_value, ps.pnl, ps.captured_at
    from portfolio_snapshots ps
    join selected_strategies ss on ss.id = ps.strategy_id
    where ps.captured_at >= ss.effective_since
    order by ps.strategy_id, ps.captured_at desc, ps.id desc
  `;

  const groupByStrategy = (rows) => {
    const grouped = new Map();
    for (const row of rows) {
      const key = row.strategy_id;
      const current = grouped.get(key) ?? [];
      current.push(row);
      grouped.set(key, current);
    }
    return grouped;
  };

  const reportsByStrategy = groupByStrategy(reportRows);
  const performanceByStrategy = groupByStrategy(performanceRows);
  const decisionsByStrategy = groupByStrategy(decisionRows);
  const rejectionsByStrategy = groupByStrategy(rejectionRows);
  const reportCountsByStrategy = new Map(reportCountRows.map((row) => [row.strategy_id, row]));
  const tradesByStrategy = new Map(paperTradeRows.map((row) => [row.strategy_id, row]));
  const runsByStrategy = new Map(runRows.map((row) => [row.strategy_id, row]));
  const snapshotsByStrategy = new Map(latestSnapshotRows.map((row) => [row.strategy_id, row]));

  const strategies = strategyRows.map((strategy) => {
    const baselineAt = strategy.metadata?.performance_baseline_at
      ?? strategy.metadata?.last_destructive_reset_at
      ?? strategy.created_at;
    const effectiveSince = new Date(Math.max(requestedSince.getTime(), new Date(baselineAt).getTime()));
    const count = reportCountsByStrategy.get(strategy.id);
    const reportCount = count?.report_count ?? 0;
    const reportSpanDays = count?.first_report_at && count?.last_report_at
      ? (new Date(count.last_report_at).getTime() - new Date(count.first_report_at).getTime()) / 86_400_000
      : 0;
    const trade = tradesByStrategy.get(strategy.id);
    const run = runsByStrategy.get(strategy.id);
    const snapshot = snapshotsByStrategy.get(strategy.id);

    return {
      key: `${strategy.platform}:${strategy.agent_mode}:${strategy.strategy_id}`,
      strategy_id: strategy.strategy_id,
      platform: strategy.platform,
      agent_mode: strategy.agent_mode,
      status: strategy.status,
      starting_balance: numberOrNull(strategy.starting_balance),
      schedule: strategy.schedule,
      risk_config: strategy.risk_config ?? {},
      baseline_at: isoOrNull(baselineAt),
      effective_evidence_since: effectiveSince.toISOString(),
      updated_at: isoOrNull(strategy.updated_at),
      evidence_summary: {
        report_count: reportCount,
        report_days: count?.report_days ?? 0,
        report_span_days: Number(reportSpanDays.toFixed(2)),
        verified_portfolio_reports: count?.verified_portfolio_reports ?? 0,
        verified_trade_reports: count?.verified_trade_reports ?? 0,
        paper_trade_count: trade?.trade_count ?? 0,
        distinct_paper_markets: trade?.distinct_markets ?? 0,
        daily_performance_samples: performanceByStrategy.get(strategy.id)?.length ?? 0,
      },
      run_summary: run ? {
        run_count: run.run_count,
        completed_runs: run.completed_runs,
        failed_runs: run.failed_runs,
        reported_trades_executed: run.reported_trades_executed,
        first_run_at: isoOrNull(run.first_run_at),
        last_run_at: isoOrNull(run.last_run_at),
      } : null,
      paper_trade_summary: trade ? {
        trade_count: trade.trade_count,
        buy_count: trade.buy_count,
        sell_count: trade.sell_count,
        distinct_markets: trade.distinct_markets,
        first_trade_at: isoOrNull(trade.first_trade_at),
        last_trade_at: isoOrNull(trade.last_trade_at),
      } : null,
      latest_portfolio_snapshot: snapshot ? {
        source: snapshot.source,
        cash: numberOrNull(snapshot.cash),
        positions_value: numberOrNull(snapshot.positions_value),
        total_value: numberOrNull(snapshot.total_value),
        pnl: numberOrNull(snapshot.pnl),
        captured_at: isoOrNull(snapshot.captured_at),
      } : null,
      decision_counts: Object.fromEntries(
        (decisionsByStrategy.get(strategy.id) ?? []).map((row) => [row.status, row.count]),
      ),
      recent_rejections: (rejectionsByStrategy.get(strategy.id) ?? [])
        .slice(0, limitPerStrategy)
        .map((row) => ({
          reasons: row.rejection_reasons,
          created_at: isoOrNull(row.created_at),
        })),
      daily_performance: (performanceByStrategy.get(strategy.id) ?? []).map((row) => ({
        bucket_at: isoOrNull(row.bucket_at),
        nav: numberOrNull(row.nav),
        pnl: numberOrNull(row.pnl),
        return_pct: numberOrNull(row.return_pct),
        period_return_pct: numberOrNull(row.period_return_pct),
        twr_pct: numberOrNull(row.twr_pct),
        mwr_pct: numberOrNull(row.mwr_pct),
        net_external_flow: numberOrNull(row.net_external_flow),
        unpriced_positions_count: row.unpriced_positions_count,
        pricing_updated_at: isoOrNull(row.pricing_updated_at),
        captured_at: isoOrNull(row.captured_at),
      })),
      reports: (reportsByStrategy.get(strategy.id) ?? [])
        .filter((row) => new Date(row.created_at) >= effectiveSince)
        .map((row) => ({
          filename: row.filename,
          title: row.title,
          created_at: isoOrNull(row.created_at),
          portfolio_summary: row.portfolio_summary ?? {},
          trade_summary: row.trade_summary ?? {},
          lessons_learned: row.lessons_learned,
          next_steps: row.next_steps,
          content: row.content,
        })),
    };
  });

  console.log(JSON.stringify({
    generated_at: generatedAt.toISOString(),
    requested_since: requestedSince.toISOString(),
    since_days: sinceDays,
    limit_per_strategy: limitPerStrategy,
    filters: {
      platform: platformFilter,
      mode: modeFilter,
      strategy_id: strategyFilter,
    },
    trust_order: [
      'server_verified_report_fields',
      'server_ledger_and_performance',
      'agent_narrative_as_hypothesis_only',
    ],
    strategies,
  }, null, 2));
} finally {
  await sql.end();
}
