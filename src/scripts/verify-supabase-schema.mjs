import postgres from 'postgres';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const requiredTables = [
  'accounts',
  'agent_reports',
  'event_cache',
  'leaderboard_snapshots',
  'ledger_entries',
  'limit_orders',
  'market_cache',
  'official_cash_ledger_entries',
  'official_order_events',
  'official_settlement_allocations',
  'official_settlements',
  'official_sync_state',
  'official_trade_fills',
  'paper_trade_orders',
  'paper_trades',
  'portfolio_snapshots',
  'portfolios',
  'positions',
  'real_trade_orders',
  'reconciliation_logs',
  'sessions',
  'strategies',
  'strategy_runs',
  'strategy_capital_flows',
  'strategy_decisions',
  'strategy_performance_snapshots',
  'users',
  'verification_tokens',
];

const requiredEnums = {
  agent_mode: ['paper', 'real'],
  order_status: ['PENDING', 'FILLED', 'CANCELLED', 'REJECTED'],
  outcome: ['YES', 'NO'],
  platform: ['polymarket', 'kalshi', 'polymarket_us'],
  strategy_status: ['active', 'paused', 'disabled'],
  trade_action: ['BUY', 'SELL'],
};

const requiredColumns = {
  agent_reports: ['id', 'strategy_id', 'run_id', 'user_id', 'strategy_name', 'filename', 'content'],
  leaderboard_snapshots: ['id', 'user_id', 'user_name', 'platform', 'total_pnl', 'return_pct', 'portfolio_value', 'rank', 'period'],
  strategies: ['id', 'user_id', 'strategy_id', 'agent_mode', 'platform', 'status', 'starting_balance'],
  paper_trade_orders: ['id', 'strategy_id', 'user_id', 'run_id', 'report_id', 'paper_trade_id'],
  paper_trades: ['id', 'strategy_id', 'run_id', 'report_id', 'user_id', 'portfolio_id'],
  positions: ['id', 'risk_group_id', 'market_id', 'user_id'],
  strategy_decisions: ['id', 'strategy_id', 'user_id', 'status', 'server_quote'],
  users: ['id', 'email', 'name', 'settings', 'color'],
};

const forbiddenColumns = {
  agent_reports: ['account'],
  strategies: ['strategy_name'],
};

const requiredIndexes = [
  'agent_reports_strategy_uuid_idx',
  'agent_reports_strategy_name_idx',
  'agent_reports_unique_idx',
  'strategies_id_idx',
  'strategies_unique_idx',
  'paper_trade_orders_report_idx',
  'paper_trades_report_idx',
  'leaderboard_platform_idx',
  'positions_risk_group_idx',
  'strategy_decisions_strategy_idx',
];

function fail(message) {
  console.error(`Schema verification failed: ${message}`);
  process.exitCode = 1;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required. Point it at local Postgres or Supabase cloud.');
  }

  const runSmoke = process.argv.includes('--smoke');
  const sql = postgres(databaseUrl, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  });

  try {
    const [{ database_name: databaseName }] = await sql`
      select current_database() as database_name
    `;
    console.log(`Connected to database: ${databaseName}`);

    const tables = await sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    const tableNames = new Set(tables.map((row) => row.table_name));
    for (const table of requiredTables) {
      if (!tableNames.has(table)) fail(`missing table public.${table}`);
    }

    const enumRows = await sql`
      select t.typname as enum_name, e.enumlabel as enum_value
      from pg_type t
      join pg_enum e on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
      order by t.typname, e.enumsortorder
    `;
    const enumMap = new Map();
    for (const row of enumRows) {
      enumMap.set(row.enum_name, [...(enumMap.get(row.enum_name) ?? []), row.enum_value]);
    }
    for (const [enumName, expectedValues] of Object.entries(requiredEnums)) {
      const actualValues = enumMap.get(enumName) ?? [];
      if (actualValues.join(',') !== expectedValues.join(',')) {
        fail(`enum ${enumName} is ${actualValues.join(',') || '<missing>'}`);
      }
    }

    const columnRows = await sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
    `;
    const columnsByTable = new Map();
    for (const row of columnRows) {
      columnsByTable.set(row.table_name, [...(columnsByTable.get(row.table_name) ?? []), row.column_name]);
    }
    for (const [table, columns] of Object.entries(requiredColumns)) {
      const actual = new Set(columnsByTable.get(table) ?? []);
      for (const column of columns) {
        if (!actual.has(column)) fail(`missing column public.${table}.${column}`);
      }
    }
    for (const [table, columns] of Object.entries(forbiddenColumns)) {
      const actual = new Set(columnsByTable.get(table) ?? []);
      for (const column of columns) {
        if (actual.has(column)) fail(`legacy column still exists public.${table}.${column}`);
      }
    }

    const indexRows = await sql`
      select indexname
      from pg_indexes
      where schemaname = 'public'
    `;
    const indexNames = new Set(indexRows.map((row) => row.indexname));
    for (const index of requiredIndexes) {
      if (!indexNames.has(index)) fail(`missing index public.${index}`);
    }

    if (runSmoke) {
      await sql.begin(async (tx) => {
        const [user] = await tx`
          insert into users (email, name)
          values ('schema-smoke@polytrader.local', 'Schema Smoke')
          returning id
        `;
        const [portfolio] = await tx`
          insert into portfolios (user_id)
          values (${user.id})
          returning id, balance
        `;
        const [strategy] = await tx`
          insert into strategies (user_id, strategy_id, agent_mode, platform)
          values (${user.id}, 'schema_smoke', 'paper', 'polymarket')
          returning id, strategy_id
        `;
        const [report] = await tx`
          insert into agent_reports (strategy_id, user_id, strategy_name, filename, content)
          values (${strategy.id}, ${user.id}, ${strategy.strategy_id}, 'smoke.md', 'ok')
          returning id
        `;
        await tx`
          insert into paper_trades (
            strategy_id, report_id, user_id, portfolio_id, market_id, token_id,
            outcome, action, shares, price_per_share, total_cost
          )
          values (
            ${strategy.id}, ${report.id}, ${user.id}, ${portfolio.id}, 'smoke-market', 'smoke-token',
            'YES', 'BUY', '1.000000', '0.500000', '0.50'
          )
        `;
        throw new Error('ROLLBACK_SCHEMA_SMOKE');
      }).catch((error) => {
        if (error.message !== 'ROLLBACK_SCHEMA_SMOKE') throw error;
      });
      console.log('Smoke transaction passed and was rolled back.');
    }

    if (process.exitCode) process.exit(process.exitCode);
    console.log('Schema verification passed.');
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
