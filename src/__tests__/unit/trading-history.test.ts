import { describe, expect, it } from 'vitest';
import { parseTradingHistoryQuery, toCsv } from '@/lib/trading-history';

describe('trading history query', () => {
  it('bounds pagination and parses filters', () => {
    expect(parseTradingHistoryQuery(new URL('https://x.test?type=executions&page=2&page_size=999&strategy_id=s1&market=btc&status=filled').searchParams)).toMatchObject({ type: 'executions', page: 2, pageSize: 100, strategyId: 's1', market: 'btc', status: 'filled' });
  });
  it('escapes CSV cells', () => {
    expect(toCsv([{ market: 'BTC, up?', note: 'a"b' }])).toBe('market,note\r\n"BTC, up?","a""b"');
  });
});
