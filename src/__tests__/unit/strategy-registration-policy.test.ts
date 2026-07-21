import { describe, expect, it } from 'vitest';
import {
  buildInitialStrategyMetadata,
  CURRENT_REPORT_MEMORY_GENERATION,
  existingStrategyUpdate,
  resolveStrategyReportMemory,
} from '@/lib/strategy-registration-policy';

describe('strategy registration policy', () => {
  it('uses a fresh memory generation after quarantining incorrect v2 reports', () => {
    expect(CURRENT_REPORT_MEMORY_GENERATION).toBe('report-memory-v3');
  });

  it('never lets registration enable real trading or bypass shadow graduation', () => {
    expect(buildInitialStrategyMetadata('real', {
      real_trading_enabled: true,
      require_shadow_graduation: false,
      graduation_source_strategy_id: 'paper-shadow',
      label: 'commander',
    })).toEqual(expect.objectContaining({
      real_trading_enabled: false,
      require_shadow_graduation: true,
      label: 'commander',
    }));
    expect(buildInitialStrategyMetadata('real', {
      graduation_source_strategy_id: 'agent-selected-shadow',
    })).not.toHaveProperty('graduation_source_strategy_id');
  });

  it('keeps existing risk and metadata immutable while allowing schedule changes', () => {
    expect(existingStrategyUpdate({
      riskConfig: { max_trade_pct: 0.02 },
      metadata: { real_trading_enabled: false, owner: 'server' },
      schedule: 'old',
    }, {
      riskConfig: { max_trade_pct: 1 },
      metadata: { real_trading_enabled: true, owner: 'agent' },
      schedule: 'new',
    })).toEqual({ schedule: 'new' });
  });

  it('starts a new report-memory generation once while preserving server metadata', () => {
    const resetAt = new Date('2026-07-20T19:15:00.000Z');
    expect(buildInitialStrategyMetadata('paper', {
      report_memory_generation: CURRENT_REPORT_MEMORY_GENERATION,
      report_memory_reset_at: 'agent-controlled-date',
    }, resetAt)).toEqual(expect.objectContaining({
      report_memory_generation: CURRENT_REPORT_MEMORY_GENERATION,
      report_memory_reset_at: resetAt.toISOString(),
    }));
    expect(existingStrategyUpdate({
      riskConfig: {},
      metadata: { owner: 'server', real_trading_enabled: false },
      schedule: 'old',
    }, {
      metadata: {
        report_memory_generation: CURRENT_REPORT_MEMORY_GENERATION,
        report_memory_reset_at: 'agent-controlled-date',
      },
    }, resetAt)).toEqual({
      metadata: {
        owner: 'server',
        real_trading_enabled: false,
        report_memory_generation: CURRENT_REPORT_MEMORY_GENERATION,
        report_memory_reset_at: resetAt.toISOString(),
      },
    });

    expect(existingStrategyUpdate({
      riskConfig: {},
      metadata: {
        owner: 'server',
        report_memory_generation: CURRENT_REPORT_MEMORY_GENERATION,
        report_memory_reset_at: resetAt.toISOString(),
      },
      schedule: 'old',
    }, {
      metadata: { report_memory_generation: CURRENT_REPORT_MEMORY_GENERATION },
    }, new Date('2026-07-21T00:00:00.000Z'))).toEqual({});
  });

  it('exposes report memory only after the current generation has a valid server cutoff', () => {
    expect(resolveStrategyReportMemory({})).toEqual({
      ready: false,
      generation: CURRENT_REPORT_MEMORY_GENERATION,
      resetAt: null,
    });
    expect(resolveStrategyReportMemory({
      report_memory_generation: CURRENT_REPORT_MEMORY_GENERATION,
      report_memory_reset_at: '2026-07-20T19:15:00.000Z',
    })).toEqual({
      ready: true,
      generation: CURRENT_REPORT_MEMORY_GENERATION,
      resetAt: new Date('2026-07-20T19:15:00.000Z'),
    });
  });
});
