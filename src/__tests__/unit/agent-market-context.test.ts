import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/kalshi', () => ({
  getKalshiMarket: vi.fn(),
  getKalshiMarkets: vi.fn(),
  getKalshiOutcomePriceFromMarket: vi.fn(() => 0.5),
}));
vi.mock('@/lib/polymarket-us', () => ({
  getPolymarketUsMarket: vi.fn(),
  getPolymarketUsOutcomePrice: vi.fn(async () => 0.5),
}));
vi.mock('@/lib/polymarket', () => ({ getMarket: vi.fn() }));

import { getKalshiMarket, getKalshiMarkets } from '@/lib/kalshi';
import { getMarket } from '@/lib/polymarket';
import { getPolymarketUsMarket } from '@/lib/polymarket-us';
import {
  enrichPositionRowsWithMarkets,
  enrichSettledRowsWithMarkets,
  getAgentMarketContext,
} from '@/lib/agent-market-context';

describe('agent open-order market context', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enriches Kalshi tickers', async () => {
    vi.mocked(getKalshiMarket).mockResolvedValue({
      title: 'Bitcoin up this interval?',
      status: 'open',
      close_time: '2026-07-12T20:30:00Z',
    });
    await expect(getAgentMarketContext('kalshi', 'KXBTC15M-TEST')).resolves.toMatchObject({
      ticker: 'KXBTC15M-TEST',
      market_title: 'Bitcoin up this interval?',
      market_status: 'open',
    });
  });

  it('falls back on a Kalshi transport failure without hiding mapping errors', async () => {
    vi.mocked(getKalshiMarket).mockRejectedValue(new Error('venue unavailable'));
    await expect(getAgentMarketContext('kalshi', 'KXUNAVAILABLE')).resolves.toMatchObject({
      ticker: 'KXUNAVAILABLE',
      market_title: null,
      yes_price: null,
    });
  });

  it('uses readable Kalshi titles for current and settled position rows', async () => {
    vi.mocked(getKalshiMarket).mockResolvedValue({ title: 'Bitcoin up this interval?', status: 'finalized' });
    vi.mocked(getKalshiMarkets).mockResolvedValue(new Map([
      ['KXBTC15M-TEST', { title: 'Bitcoin up this interval?', status: 'finalized' }],
    ]));
    await expect(enrichPositionRowsWithMarkets('kalshi', [{ ticker: 'KXBTC15M-TEST' }])).resolves.toMatchObject([
      { ticker: 'KXBTC15M-TEST', marketQuestion: 'Bitcoin up this interval?' },
    ]);
    await expect(enrichSettledRowsWithMarkets([{
      platform: 'kalshi',
      market_id: 'KXBTC15M-TEST',
      market: 'KXBTC15M-TEST',
    }])).resolves.toMatchObject([
      { market: 'Bitcoin up this interval?' },
    ]);
    expect(getKalshiMarkets).toHaveBeenCalledWith(['KXBTC15M-TEST']);
  });

  it('batch-enriches Kalshi settled rows and safely preserves missing tickers', async () => {
    vi.mocked(getKalshiMarkets).mockResolvedValue(new Map([
      ['KXBTC15M-FIRST', { ticker: 'KXBTC15M-FIRST', title: 'BTC price up in next 15 mins?' }],
      ['KXETH15M-SECOND', { ticker: 'KXETH15M-SECOND', title: 'ETH price up in next 15 mins?' }],
    ]));

    await expect(enrichSettledRowsWithMarkets([
      { platform: 'kalshi', market_id: 'KXBTC15M-FIRST', market: 'KXBTC15M-FIRST' },
      { platform: 'kalshi', market_id: 'KXETH15M-SECOND', market: 'KXETH15M-SECOND' },
      { platform: 'kalshi', market_id: 'KXSOL15M-MISSING', market: 'KXSOL15M-MISSING' },
    ])).resolves.toEqual([
      { platform: 'kalshi', market_id: 'KXBTC15M-FIRST', market: 'BTC price up in next 15 mins?' },
      { platform: 'kalshi', market_id: 'KXETH15M-SECOND', market: 'ETH price up in next 15 mins?' },
      { platform: 'kalshi', market_id: 'KXSOL15M-MISSING', market: 'KXSOL15M-MISSING' },
    ]);
    expect(getKalshiMarkets).toHaveBeenCalledTimes(1);
    expect(getKalshiMarket).not.toHaveBeenCalled();
  });

  it('enriches Polymarket US slugs', async () => {
    vi.mocked(getPolymarketUsMarket).mockResolvedValue({
      id: 42,
      slug: 'btc-up-us',
      title: 'Will Bitcoin rise?',
      outcome: 'YES',
      active: false,
      closed: true,
    });
    await expect(getAgentMarketContext('polymarket_us', 'btc-up-us')).resolves.toMatchObject({
      market_id: '42',
      market_slug: 'btc-up-us',
      market_title: 'Will Bitcoin rise?',
      market_status: 'closed',
      settlement_result: 'YES',
    });
  });

  it('enriches Polymarket International market ids', async () => {
    vi.mocked(getMarket).mockResolvedValue({
      id: 'poly-1',
      slug: 'btc-up-intl',
      question: 'Will Bitcoin rise internationally?',
      active: true,
      closed: false,
      endDate: '2026-07-13T00:00:00Z',
    } as never);
    await expect(getAgentMarketContext('polymarket', 'poly-1')).resolves.toMatchObject({
      market_id: 'poly-1',
      market_slug: 'btc-up-intl',
      market_title: 'Will Bitcoin rise internationally?',
      market_status: 'active',
      close_time: '2026-07-13T00:00:00Z',
    });
  });

  it('calculates Kalshi cost basis from canonical exposure instead of legacy action', async () => {
    vi.mocked(getKalshiMarket).mockResolvedValue({ title: 'WTI Crude Oil', status: 'open' });
    
    const positions = [
      { ticker: 'KXWTI-TEST', position_fp: '60', total_traded_dollars: '999', market_exposure_dollars: '30' }
    ];
    const fills = [
      {
        strategyId: 'strat-1',
        marketId: 'KXWTI-TEST',
        outcome: 'YES',
        side: 'BUY',
        quantity: 100,
        price: 0.4,
        fee: 1,
        filledAt: '2026-07-14T08:10:00Z'
      },
      {
        strategyId: 'strat-1',
        marketId: 'KXWTI-TEST',
        // A canonical NO exposure offsets the existing YES lots regardless
        // of the deprecated action value.
        outcome: 'NO',
        side: 'SELL',
        quantity: 40,
        price: 0.6,
        fee: 0,
        filledAt: '2026-07-14T12:00:00Z'
      }
    ];

    const result = await enrichPositionRowsWithMarkets('kalshi', positions, fills);
    expect(result).toMatchObject([
      {
        ticker: 'KXWTI-TEST',
        shares: 60,
        outcome: 'YES',
        avgPrice: 0.41,
        value: 30,
      }
    ]);
    expect((result as Array<{ pnl: number }>)[0].pnl).toBeCloseTo(5.4);
  });

  it('treats SELL NO canonical YES exposure as an added YES lot', async () => {
    vi.mocked(getKalshiMarket).mockResolvedValue({ title: 'Test market', status: 'open' });
    const result = await enrichPositionRowsWithMarkets('kalshi', [
      { ticker: 'KXTEST', position_fp: '10', total_traded_dollars: '0' },
    ], [{
      marketId: 'KXTEST', outcome: 'YES', side: 'SELL', quantity: 10,
      price: 0.6, fee: 0, filledAt: '2026-07-14T12:00:00Z',
    }]);

    expect(result).toMatchObject([{ outcome: 'YES', shares: 10, avgPrice: 0.6, pnl: -1 }]);
  });
});
