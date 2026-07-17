import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production schema verification coverage', () => {
  const source = readFileSync(new URL('../../scripts/verify-supabase-schema.mjs', import.meta.url), 'utf8');

  it.each([
    'strategy_decisions',
    'strategy_performance_snapshots',
    'strategy_capital_flows',
    'official_trade_fills',
    'official_settlements',
    'official_settlement_allocations',
    'official_cash_ledger_entries',
    'official_sync_state',
  ])('requires table %s', (table) => {
    expect(source).toContain(`'${table}'`);
  });

  it('requires the event-level risk column', () => {
    expect(source).toContain("positions: ['id', 'risk_group_id'");
  });
});
