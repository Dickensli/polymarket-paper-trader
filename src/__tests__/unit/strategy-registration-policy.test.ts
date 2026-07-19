import { describe, expect, it } from 'vitest';
import {
  buildInitialStrategyMetadata,
  existingStrategyUpdate,
} from '@/lib/strategy-registration-policy';

describe('strategy registration policy', () => {
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
});
