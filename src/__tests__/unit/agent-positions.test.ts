import { describe, expect, it } from 'vitest';
import { buildAgentPositionSummaries, normalizePositionRows } from '@/lib/agent-positions';

describe('agent position helpers', () => {
  it('normalizes paper and official position row shapes', () => {
    expect(normalizePositionRows([
      {
        id: 'local-1',
        marketQuestion: 'Will rates fall?',
        outcome: 'YES',
        shares: '12.5',
        avgPrice: '0.40',
        currentPrice: '0.52',
      },
      {
        ticker: 'KXTEST',
        side: 'NO',
        count: 3,
        market_value: '1.20',
        unrealized_pnl: '-0.30',
      },
    ])).toMatchObject([
      {
        id: 'local-1',
        market: 'Will rates fall?',
        outcome: 'YES',
        shares: 12.5,
        avgPrice: 0.4,
        currentPrice: 0.52,
        value: 6.5,
        pnl: 1.5,
      },
      {
        market: 'KXTEST',
        outcome: 'NO',
        shares: 3,
        value: 1.2,
        pnl: -0.3,
      },
    ]);

    expect(normalizePositionRows({
      positions: [
        {
          market_id: 'polymarket-slug',
          answer: 'YES',
          quantity: 8,
          current_value: 4,
        },
      ],
    })).toMatchObject([
      {
        market: 'polymarket-slug',
        outcome: 'YES',
        shares: 8,
        value: 4,
      },
    ]);
  });

  it('builds one latest current-position summary per strategy', () => {
    const summaries = buildAgentPositionSummaries([
      {
        id: 'snapshot-new',
        strategy_id: 'strategy-1',
        agent_id: 'agent-1',
        agent_email: 'agent@example.test',
        agent_name: 'Macro Agent',
        strategy_name: 'macro',
        platform: 'kalshi',
        agent_mode: 'paper',
        cash: 990,
        total_value: 1010,
        positions_value: 20,
        pnl: 10,
        captured_at: '2026-07-10T12:00:00.000Z',
        positions: [{ ticker: 'KXTEST', outcome: 'YES', shares: 20, currentPrice: 0.5 }],
      },
      {
        id: 'snapshot-old',
        strategy_id: 'strategy-1',
        agent_id: 'agent-1',
        agent_email: 'agent@example.test',
        agent_name: 'Macro Agent',
        strategy_name: 'macro',
        platform: 'kalshi',
        agent_mode: 'paper',
        cash: 1000,
        total_value: 1000,
        positions_value: 0,
        pnl: 0,
        captured_at: '2026-07-10T11:00:00.000Z',
        positions: [{ ticker: 'OLD', outcome: 'NO', shares: 100, currentPrice: 0.2 }],
      },
      {
        id: 'snapshot-empty',
        strategy_id: 'strategy-2',
        agent_id: 'agent-2',
        strategy_name: 'empty',
        platform: 'polymarket',
        agent_mode: 'real',
        cash: 1000,
        total_value: 1000,
        positions_value: 0,
        pnl: 0,
        captured_at: '2026-07-10T12:00:00.000Z',
        positions: [],
      },
    ]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      key: 'strategy-1',
      agentId: 'agent-1',
      agentLabel: 'Macro Agent',
      strategyName: 'macro',
      positionsValue: 20,
    });
    expect(summaries[0].positions).toHaveLength(1);
    expect(summaries[0].positions[0].market).toBe('KXTEST');
  });
});
