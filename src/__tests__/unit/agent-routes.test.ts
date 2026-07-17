import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(),
  resolveTargetUserId: vi.fn(() => 'user-1'),
}));

vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  getDb: vi.fn(),
}));

vi.mock('@/lib/trading-engine', () => {
  class TradingError extends Error {
    constructor(
      message: string,
      public readonly code: string,
    ) {
      super(message);
    }
  }

  return {
    executeTrade: vi.fn(),
    getPortfolio: vi.fn(),
    TradingError,
  };
});

vi.mock('@/lib/polymarket', () => ({
  getMarket: vi.fn(),
  getMidpoint: vi.fn(),
}));

vi.mock('@/lib/kalshi', () => ({
  getKalshiMarket: vi.fn(),
  getKalshiMarkets: vi.fn().mockResolvedValue(new Map()),
  getKalshiOutcomePrice: vi.fn(),
  getKalshiOrderBook: vi.fn(),
  kalshiTokenId: vi.fn((ticker: string, outcome: string) => `kalshi:${ticker}:${outcome}`),
}));

vi.mock('@/lib/polymarket-us', () => ({
  getPolymarketUsMarket: vi.fn(),
  getPolymarketUsOutcomePrice: vi.fn(),
  polymarketUsTokenId: vi.fn((slug: string, outcome: string) => `${slug}:${outcome}`),
}));

vi.mock('@/lib/official-trading', () => ({
  submitOfficialRealTrade: vi.fn(),
  cancelOfficialRealOrder: vi.fn(),
  getOfficialPortfolioSnapshot: vi.fn(),
  resolveOfficialOrderQuantity: vi.fn(({ shares, amount, price }) => shares ?? amount / price),
  kalshiOrderQuantity: vi.fn((order) => Number(order.initial_count_fp ?? order.initial_count ?? order.count)),
  normalizeKalshiOrderStatus: vi.fn((order) =>
    Number(order.fill_count_fp ?? 0) > 0 && Number(order.remaining_count_fp ?? 0) > 0
      ? 'PARTIALLY_FILLED'
      : String(order.status ?? 'SUBMITTED').toUpperCase()),
}));

type JsonBody = Record<string, unknown>;

function makeRequest({
  body,
  headers,
  url = 'https://example.test/api',
}: {
  body?: JsonBody;
  headers?: Record<string, string>;
  url?: string;
} = {}) {
  return {
    headers: {
      get: (name: string) => headers?.[name] ?? headers?.[name.toLowerCase()] ?? null,
    },
    json: vi.fn(async () => body ?? {}),
    nextUrl: new URL(url),
  };
}

function createChain<T>(result: T) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(async () => result),
  };
  return chain;
}

function createMockDb() {
  const insertResults: unknown[] = [];
  const updateResults: unknown[] = [];
  const insertValues = vi.fn((values: unknown) => ({
    returning: vi.fn(async () => [insertResults.shift() ?? { id: 'inserted-id', ...values as object }]),
  }));
  const updateSet = vi.fn((values: unknown) => ({
    where: vi.fn(() => ({
      returning: vi.fn(async () => [updateResults.shift() ?? { id: 'updated-id', ...values as object }]),
    })),
  }));
  const selectResult: unknown[] = [];
  const selectResults: unknown[][] = [];

  return {
    insertResults,
    updateResults,
    selectResult,
    selectResults,
    insertValues,
    updateSet,
    query: {
      agentReports: { findFirst: vi.fn() },
      paperTradeOrders: { findFirst: vi.fn() },
      realTradeOrders: { findFirst: vi.fn(), findMany: vi.fn() },
      strategies: { findFirst: vi.fn() },
      portfolios: { findFirst: vi.fn() },
      strategyRuns: { findFirst: vi.fn() },
      officialSyncState: { findMany: vi.fn(async () => []) },
    },
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn(() => ({ set: updateSet })),
    select: vi.fn(() => createChain(selectResults.length > 0 ? selectResults.shift() : selectResult)),
  };
}

describe('agent route handlers', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();

    const { auth } = await import('@/lib/auth');
    const { getDb } = await import('@/lib/db');
    vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1' } } as never);
    vi.mocked(getDb).mockReturnValue(db as never);
  });

  it.skip('registers a new strategy and returns existing strategies idempotently', async () => {
    const { POST } = await import('@/app/api/agent/strategies/register/route');

    db.query.strategies.findFirst.mockResolvedValueOnce(null);
    db.insertResults.push({
      id: 'strategy-1',
      strategyId: 'arb',
      agentMode: 'paper',
      platform: 'kalshi',
      status: 'active',
      startingBalance: '10000.00',
      riskConfig: {},
      schedule: null,
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
    });

    const created = await POST(makeRequest({
      body: { strategy_id: 'arb', account_id: 'default', is_paper_trading: true, platform: 'kalshi' },
    }) as never);
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      registered: true,
      is_new: true,
      strategy: { strategyId: 'arb', agentMode: 'paper', platform: 'kalshi' },
    });

    db.query.strategies.findFirst.mockResolvedValueOnce({
      id: 'strategy-1',
      strategyId: 'arb',
      agentMode: 'paper',
      platform: 'kalshi',
      status: 'active',
      startingBalance: '10000.00',
      riskConfig: {},
      schedule: null,
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
    });

    const existing = await POST(makeRequest({
      body: { strategy_id: 'arb', account_id: 'default', is_paper_trading: true, platform: 'kalshi' },
    }) as never);
    expect(existing.status).toBe(200);
    await expect(existing.json()).resolves.toMatchObject({
      registered: true,
      is_new: false,
      strategy: { strategyId: 'arb', agentMode: 'paper', platform: 'kalshi' },
    });
  });

  it('updates risk controls for an existing strategy without changing its locked venue or mode', async () => {
    const { POST } = await import('@/app/api/agent/strategies/register/route');
    const existing = {
      id: 'strategy-1', userId: 'user-1', strategyId: 'arb', agentMode: 'paper',
      platform: 'kalshi', status: 'active', startingBalance: '10000.00',
      riskConfig: {}, schedule: null, metadata: {},
    };
    db.query.strategies.findFirst.mockResolvedValue(existing);
    db.updateResults.push({
      ...existing,
      riskConfig: { max_single_trade_pct: 0.05 },
      schedule: '0 */2 * * *',
    });

    const response = await POST(makeRequest({
      body: {
        strategy_id: 'arb', account_id: 'default', is_paper_trading: true,
        platform: 'kalshi', risk_config: { max_single_trade_pct: 0.05 },
        schedule: '0 */2 * * *',
      },
    }) as never);

    expect(response.status).toBe(200);
    expect(db.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      riskConfig: { max_single_trade_pct: 0.05 },
      schedule: '0 */2 * * *',
    }));
  });

  it('writes, lists, and reads strategy reports through /api/agent/reports', async () => {
    const reportsRoute = await import('@/app/api/agent/reports/route');
    const reportByIdRoute = await import('@/app/api/agent/reports/[id]/route');

    db.query.strategies.findFirst.mockResolvedValue({ id: 'strategy-1', strategyId: 'arb' });
    db.query.agentReports.findFirst.mockResolvedValueOnce(null);
    db.insertResults.push({
      id: 'report-1',
      strategyId: 'strategy-1',
      runId: null,
      strategyName: 'arb',
      filename: 'run.md',
      content: '# Report',
      title: 'Run',
    });

    const written = await reportsRoute.POST(makeRequest({
      body: {
        strategy_id: 'arb',
        filename: 'run.md',
        content: '# Report',
        title: 'Run',
      },
    }) as never);
    expect(written.status).toBe(201);
    await expect(written.json()).resolves.toMatchObject({
      data: { filename: 'run.md' },
      updated: false,
    });

    db.selectResult.push({
      id: 'report-1',
      filename: 'run.md',
      title: 'Run',
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
    });
    const listed = await reportsRoute.GET(makeRequest({
      url: 'https://example.test/api/agent/reports?strategy_id=arb&limit=5',
    }) as never);
    await expect(listed.json()).resolves.toMatchObject({
      data: [{ filename: 'run.md', title: 'Run' }],
      meta: { count: 1, limit: 5 },
    });

    db.query.agentReports.findFirst.mockResolvedValueOnce({
      id: 'report-1',
      strategyId: 'strategy-1',
      runId: null,
      userId: 'user-1',
      strategyName: 'arb',
      filename: 'run.md',
      content: '# Report',
      title: 'Run',
      lessonsLearned: null,
      nextSteps: null,
      portfolioSummary: {},
      tradeSummary: {},
      createdAt: new Date('2026-07-03T00:00:00.000Z'),
    });
    const read = await reportByIdRoute.GET(makeRequest() as never, {
      params: Promise.resolve({ id: 'report-1' }),
    });
    await expect(read.json()).resolves.toMatchObject({
      data: { filename: 'run.md', content: '# Report' },
    });
  });

  it('persists an empty official snapshot when real strategy context refreshes after settlement', async () => {
    const { getOfficialPortfolioSnapshot } = await import('@/lib/official-trading');
    const { getKalshiMarket } = await import('@/lib/kalshi');
    const { GET } = await import('@/app/api/agent/context/route');

    db.query.strategies.findFirst.mockResolvedValue({
      id: 'strategy-1',
      strategyId: 'high_freq_real',
      userId: 'user-1',
      agentMode: 'real',
      platform: 'kalshi',
      status: 'active',
      startingBalance: '1000.00',
      riskConfig: {},
      schedule: '*/15 * * * *',
    });
    db.query.portfolios.findFirst.mockResolvedValue(null);
    db.selectResults.push([], [], []);
    vi.mocked(getOfficialPortfolioSnapshot).mockResolvedValue({
      cash: 1250,
      positionsValue: 0,
      totalValue: 1250,
      pnl: 250,
      positions: [],
      orders: [{
        order_id: 'official-order-1',
        ticker: 'KXBTC15M-TEST',
        status: 'resting',
        initial_count_fp: '490.19',
        fill_count_fp: '71.00',
        remaining_count_fp: '419.19',
      }],
      fills: [],
      activity: [],
      raw: {},
    });
    vi.mocked(getKalshiMarket).mockResolvedValue({
      title: 'Bitcoin price up from 4:15 PM to 4:30 PM?',
      status: 'open',
      close_time: '2026-07-12T20:30:00.000Z',
      result: '',
    });

    const response = await GET(makeRequest({
      url: 'https://example.test/api/agent/context?strategy_name=high_freq_real',
    }) as never);

    expect(response.status).toBe(200);
    expect(db.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      strategyId: 'strategy-1',
      source: 'official',
      cash: '1250.00',
      positionsValue: '0.00',
      positions: [],
    }));
    expect(db.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PARTIALLY_FILLED',
      quantity: '490.190000',
      officialResponse: expect.objectContaining({ fill_count_fp: '71.00' }),
    }));
    await expect(response.json()).resolves.toMatchObject({
      open_orders: [{
        order_id: 'official-order-1',
        status: 'PARTIALLY_FILLED',
        initial_quantity: 490.19,
        filled_quantity: 71,
        remaining_quantity: 419.19,
        ticker: 'KXBTC15M-TEST',
        market_title: 'Bitcoin price up from 4:15 PM to 4:30 PM?',
        market_status: 'open',
        close_time: '2026-07-12T20:30:00.000Z',
      }],
    });
  });

  it('returns existing paper order for duplicate idempotency key', async () => {
    const { POST } = await import('@/app/api/agent/paper-trades/route');

    db.query.paperTradeOrders.findFirst.mockResolvedValue({
      id: 'paper-order-1',
      idempotencyKey: 'idem-1',
    });

    const response = await POST(makeRequest({
      headers: { 'x-idempotency-key': 'idem-1' },
      body: { strategy_id: 'arb', slug: 'market', amount: 10 },
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { idempotencyKey: 'idem-1' },
      message: 'Returned existing paper order (idempotent)',
    });
  });

  it('rejects a nonexistent Kalshi market instead of filling it at 0.50', async () => {
    const { getKalshiMarket } = await import('@/lib/kalshi');
    const { executeTrade } = await import('@/lib/trading-engine');
    const { POST } = await import('@/app/api/agent/paper-trades/route');

    db.query.paperTradeOrders.findFirst.mockResolvedValue(null);
    db.query.strategies.findFirst.mockResolvedValue({
      id: 'strategy-1', strategyId: 'hft', agentMode: 'paper', platform: 'kalshi', status: 'active',
    });
    db.query.strategyRuns.findFirst.mockResolvedValue(null);
    db.query.agentReports.findFirst.mockResolvedValue(null);
    vi.mocked(getKalshiMarket).mockResolvedValue(null);

    const response = await POST(makeRequest({
      headers: { 'x-idempotency-key': 'invalid-kalshi' },
      body: { strategy_id: 'hft', slug: 'KXDOES-NOT-EXIST', outcome: 'YES', side: 'BUY', amount: 10 },
    }) as never);

    expect(response.status).toBe(400);
    expect(executeTrade).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: 'Kalshi market not found or not tradable' });
  });

  it('rejects closed Polymarket US markets before price lookup or execution', async () => {
    const { getPolymarketUsMarket, getPolymarketUsOutcomePrice } = await import('@/lib/polymarket-us');
    const { executeTrade } = await import('@/lib/trading-engine');
    const { POST } = await import('@/app/api/agent/paper-trades/route');

    db.query.paperTradeOrders.findFirst.mockResolvedValue(null);
    db.query.strategies.findFirst.mockResolvedValue({
      id: 'strategy-1', strategyId: 'arb', agentMode: 'paper', platform: 'polymarket_us', status: 'active',
    });
    db.query.strategyRuns.findFirst.mockResolvedValue(null);
    db.query.agentReports.findFirst.mockResolvedValue(null);
    vi.mocked(getPolymarketUsMarket).mockResolvedValue({ closed: true, active: false } as never);

    const response = await POST(makeRequest({
      headers: { 'x-idempotency-key': 'closed-us' },
      body: { strategy_id: 'arb', slug: 'closed-market', outcome: 'NO', side: 'BUY', amount: 10 },
    }) as never);

    expect(response.status).toBe(400);
    expect(getPolymarketUsOutcomePrice).not.toHaveBeenCalled();
    expect(executeTrade).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: 'Polymarket US market not found or not tradable' });
  });

  it('rejects caller-supplied prices for paper trades', async () => {
    const { executeTrade } = await import('@/lib/trading-engine');
    const { POST } = await import('@/app/api/agent/paper-trades/route');

    db.query.paperTradeOrders.findFirst.mockResolvedValue(null);
    const response = await POST(makeRequest({
      headers: { 'x-idempotency-key': 'custom-price' },
      body: { strategy_id: 'arb', slug: 'market', outcome: 'YES', side: 'BUY', amount: 10, price: 0.01 },
    }) as never);

    expect(response.status).toBe(400);
    expect(executeTrade).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('price') });
  });

  it('executes a live-depth Kalshi shadow fill with a validated proposal', async () => {
    const { executeTrade, getPortfolio } = await import('@/lib/trading-engine');
    const { getKalshiMarket, getKalshiOrderBook } = await import('@/lib/kalshi');
    const { POST } = await import('@/app/api/agent/paper-trades/route');

    db.query.paperTradeOrders.findFirst.mockResolvedValue(null);
    db.query.strategies.findFirst.mockResolvedValue({
      id: 'strategy-1',
      strategyId: 'arb',
      agentMode: 'paper',
      platform: 'kalshi',
      status: 'active',
    });
    db.query.strategyRuns.findFirst.mockResolvedValue({
      id: 'run-1',
      strategyId: 'strategy-1',
      status: 'running',
      tradesExecuted: 2,
    });
    db.query.agentReports.findFirst.mockResolvedValue({
      id: 'report-1',
      filename: 'run.md',
    });
    vi.mocked(getKalshiMarket).mockResolvedValue({ status: 'active', title: 'KXTEST' });
    vi.mocked(getKalshiOrderBook).mockResolvedValue({
      market: 'KXTEST', assetId: 'kalshi:KXTEST:YES', timestamp: new Date().toISOString(),
      bids: [{ price: 0.24, size: 100 }], asks: [{ price: 0.25, size: 100 }],
    });
    vi.mocked(executeTrade).mockResolvedValue({
      id: 'trade-1',
      marketId: 'KXTEST',
      marketQuestion: 'KXTEST',
      tokenId: 'kalshi:KXTEST:YES',
      outcome: 'YES',
      side: 'BUY',
      shares: 40,
      price: 0.25,
      total: 10,
      timestamp: '2026-07-03T00:00:00.000Z',
    });
    vi.mocked(getPortfolio).mockResolvedValue({
      balance: 9990,
      positions: [],
      tradeHistory: [],
      totalValue: 10000,
      totalPnL: 0,
      totalPnLPercent: 0,
    });
    db.insertResults.push({ id: 'decision-1', status: 'ACCEPTED' });
    db.insertResults.push({
      id: 'paper-order-1',
      strategyId: 'strategy-1',
      paperTradeId: 'trade-1',
      platform: 'kalshi',
      reportId: 'report-1',
      fillModel: 'live_orderbook_depth_fok',
    });

    const response = await POST(makeRequest({
      headers: { 'x-idempotency-key': 'idem-2' },
      body: {
        strategy_id: 'arb',
        slug: 'KXTEST',
        outcome: 'YES',
        side: 'BUY',
        amount: 10,
        client_order_id: 'idem-2',
        time_in_force: 'FOK',
        proposal: {
          thesis: 'A current official source supports a material pricing discrepancy.',
          rules_verified: true,
          source_urls: ['https://example.com/source'],
          fair_probability: 0.4,
          confidence_low: 0.35,
          confidence_high: 0.45,
          quote_observed_at: new Date().toISOString(),
          observed_price: 0.25,
          available_depth: 100,
          net_edge: 0.15,
          proposed_nav_pct: 0.001,
          exit_condition: 'Exit when the catalyst passes or the edge closes.',
          invalidation_condition: 'Do not enter if the official source changes.',
        },
      },
    }) as never);

    expect(response.status).toBe(200);
    expect(executeTrade).toHaveBeenCalledWith('user-1', expect.objectContaining({
      marketId: 'KXTEST',
      platform: 'kalshi',
      shares: 40,
      price: 0.25,
    }));
    expect(db.update).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalledTimes(3);
    await expect(response.json()).resolves.toMatchObject({
      data: { marketId: 'KXTEST', tokenId: 'kalshi:KXTEST:YES' },
      paper_order: { platform: 'kalshi', fillModel: 'live_orderbook_depth_fok' },
      report: { filename: 'run.md' },
      portfolio: { cash: 9990, total_value: 10000 },
    });
  });

  it('rejects disabled real trading while persisting a real trade audit row', async () => {
    const { POST } = await import('@/app/api/agent/real-trades/route');

    db.query.strategies.findFirst.mockResolvedValue({
      id: 'strategy-1',
      strategyId: 'real-arb',
      agentMode: 'real',
      platform: 'kalshi',
      status: 'active',
      metadata: {},
    });
    db.insertResults.push({
      id: 'real-order-1',
      status: 'REJECTED',
      error: { code: 'REAL_TRADING_DISABLED' },
    });

    const response = await POST(makeRequest({
      body: {
        strategy_id: 'real-arb',
        slug: 'KXTEST',
        outcome: 'YES',
        side: 'BUY',
        amount: 10,
        price: 0.25,
      },
    }) as never);

    expect(response.status).toBe(403);
    expect(db.insertValues).toHaveBeenCalledWith(expect.objectContaining({
      strategyId: 'strategy-1',
      platform: 'kalshi',
      status: 'REJECTED',
    }));
    await expect(response.json()).resolves.toMatchObject({
      error: 'Real trading is disabled for this strategy.',
      audit: { status: 'REJECTED' },
    });
  });

  it('submits enabled real trades without creating a local mirror position', async () => {
    const { submitOfficialRealTrade, getOfficialPortfolioSnapshot } = await import('@/lib/official-trading');
    const { executeTrade } = await import('@/lib/trading-engine');
    const { getKalshiMarket, getKalshiOrderBook } = await import('@/lib/kalshi');
    const { POST } = await import('@/app/api/agent/real-trades/route');

    db.query.strategies.findFirst.mockResolvedValue({
      id: 'strategy-1',
      strategyId: 'real-arb',
      agentMode: 'real',
      platform: 'kalshi',
      status: 'active',
      metadata: { real_trading_enabled: true },
    });
    db.insertResults.push({ id: 'decision-1', status: 'ACCEPTED' });
    db.insertResults.push({ id: 'audit-1', status: 'SUBMITTING' });
    db.updateResults.push({ id: 'audit-1', status: 'SUBMITTED', request: {}, officialResponse: {} });
    vi.mocked(getKalshiMarket).mockResolvedValue({ status: 'active' });
    vi.mocked(getKalshiOrderBook).mockResolvedValue({
      market: 'KXTEST', assetId: 'kalshi:KXTEST:YES', timestamp: new Date().toISOString(),
      bids: [{ price: 0.24, size: 100 }], asks: [{ price: 0.25, size: 100 }],
    });
    vi.mocked(getOfficialPortfolioSnapshot).mockResolvedValue({ totalValue: 1000 } as never);
    vi.mocked(submitOfficialRealTrade).mockResolvedValue({
      officialOrderId: 'official-1',
      clientOrderId: 'client-1',
      status: 'SUBMITTED',
      request: { ticker: 'KXTEST' },
      response: { order_id: 'official-1' },
    });
    const response = await POST(makeRequest({
      body: {
        strategy_id: 'real-arb',
        slug: 'KXTEST',
        outcome: 'YES',
        side: 'BUY',
        shares: 10,
        proposal: {
          thesis: 'A current official source supports a material pricing discrepancy.',
          rules_verified: true,
          source_urls: ['https://example.com/source'],
          fair_probability: 0.4,
          confidence_low: 0.35,
          confidence_high: 0.45,
          quote_observed_at: new Date().toISOString(),
          observed_price: 0.25,
          available_depth: 100,
          net_edge: 0.15,
          proposed_nav_pct: 0.0025,
          exit_condition: 'Exit when the catalyst passes or the edge closes.',
          invalidation_condition: 'Do not enter if the official source changes.',
        },
      },
    }) as never);

    expect(response.status).toBe(200);
    expect(submitOfficialRealTrade).toHaveBeenCalledWith(expect.objectContaining({
      platform: 'kalshi',
      slug: 'KXTEST',
      shares: 10,
      price: 0.25,
    }));
    expect(executeTrade).not.toHaveBeenCalled();
    expect(getKalshiOrderBook).toHaveBeenCalledWith('KXTEST', 'YES');
    expect(db.insert).toHaveBeenCalledTimes(4);
    expect(db.insertValues).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUBMITTING', officialOrderId: 'local:audit-1' }));
    expect(db.insertValues).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUBMITTED', officialOrderId: 'official-1' }));
    expect(db.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ outcome: 'YES', side: 'BUY', price: 0.25, price_source: 'server_executable_quote' }),
      officialResponse: expect.objectContaining({
        order_id: 'official-1',
        submitted_request: { ticker: 'KXTEST' },
      }),
    }));
    await expect(response.json()).resolves.toMatchObject({
      data: { status: 'SUBMITTED' },
      portfolio_sync: 'pending_next_context_refresh',
    });
  });

  it('cancels real orders through the official client and writes official snapshot', async () => {
    const {
      cancelOfficialRealOrder,
      getOfficialPortfolioSnapshot,
    } = await import('@/lib/official-trading');
    const { POST } = await import('@/app/api/agent/real-orders/[id]/cancel/route');

    db.query.realTradeOrders.findFirst.mockResolvedValue({
      id: 'real-order-1',
      userId: 'user-1',
      strategyId: 'strategy-1',
      runId: null,
      platform: 'kalshi',
      officialOrderId: 'official-1',
      marketSlugOrTicker: 'KXTEST',
    });
    db.updateResults.push(
      { id: 'real-order-1', status: 'CANCEL_SUBMITTING' },
      { id: 'real-order-1', status: 'CANCELLED' },
    );
    db.insertResults.push({ id: 'snapshot-1', source: 'official' });
    vi.mocked(cancelOfficialRealOrder).mockResolvedValue({
      officialOrderId: 'official-1',
      status: 'CANCELLED',
      response: { ok: true },
    });
    vi.mocked(getOfficialPortfolioSnapshot).mockResolvedValue({
      cash: 1000,
      positionsValue: 0,
      totalValue: 1000,
      pnl: 0,
      positions: [],
      orders: [],
      fills: [],
      activity: [],
      raw: {},
    });

    const response = await POST(makeRequest() as never, {
      params: Promise.resolve({ id: 'real-order-1' }),
    });

    expect(response.status).toBe(200);
    expect(cancelOfficialRealOrder).toHaveBeenCalledWith('kalshi', 'official-1', 'KXTEST');
    expect(db.updateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: 'CANCEL_SUBMITTING',
    }));
    await expect(response.json()).resolves.toMatchObject({
      data: { status: 'CANCELLED' },
      official_snapshot: { source: 'official' },
    });
  });

  it.skip('reconciles real strategies against official snapshots and logs differences', async () => {
    const { getOfficialPortfolioSnapshot } = await import('@/lib/official-trading');
    const { getPortfolio } = await import('@/lib/trading-engine');
    // @ts-expect-error Legacy reconcile route was intentionally removed; retained skipped scenario documents old behavior.
    const { POST } = await import('@/app/api/agent/reconcile/route');

    db.query.strategies.findFirst.mockResolvedValue({
      id: 'strategy-1',
      strategyId: 'real-arb',
      agentMode: 'real',
      platform: 'kalshi',
    });
    db.query.realTradeOrders.findMany.mockResolvedValue([
      {
        id: 'local-order-1',
        officialOrderId: 'official-1',
        clientOrderId: 'client-1',
        status: 'SUBMITTED',
      },
    ]);
    vi.mocked(getPortfolio).mockResolvedValue({
      balance: 9000,
      positions: [{
        id: 'position-1',
        marketId: 'KXTEST',
        marketQuestion: 'KXTEST',
        tokenId: 'kalshi:KXTEST:YES',
        outcome: 'YES',
        shares: 10,
        avgEntryPrice: 0.25,
        currentPrice: 0.26,
        unrealizedPnL: 0.1,
        unrealizedPnLPercent: 4,
        realizedPnL: 0,
        createdAt: '2026-07-03T00:00:00.000Z',
      }],
      tradeHistory: [],
      totalValue: 9500,
      totalPnL: -500,
      totalPnLPercent: -5,
    });
    vi.mocked(getOfficialPortfolioSnapshot).mockResolvedValue({
      cash: 9100,
      positionsValue: 260,
      totalValue: 9360,
      pnl: -640,
      positions: [{ ticker: 'KXTEST', outcome: 'YES', count: 11 }],
      orders: [{ order_id: 'official-2', status: 'SUBMITTED' }],
      fills: [{ id: 'fill-1' }],
      activity: [],
      raw: {},
    });
    db.insertResults.push(
      { id: 'snapshot-1', source: 'local' },
      { id: 'snapshot-2', source: 'official' },
      { id: 'log-1', severity: 'warning', differenceType: 'balance' },
      { id: 'log-2', severity: 'warning', differenceType: 'position' },
      { id: 'log-3', severity: 'warning', differenceType: 'order' },
      { id: 'log-4', severity: 'warning', differenceType: 'fill' },
    );

    const response = await POST(makeRequest({
      body: { strategy_id: 'real-arb' },
    }) as never);

    expect(response.status).toBe(200);
    expect(getOfficialPortfolioSnapshot).toHaveBeenCalledWith('kalshi');
    expect(db.insert).toHaveBeenCalledTimes(6);
    await expect(response.json()).resolves.toMatchObject({
      reconciled: false,
      local_snapshot: { source: 'local' },
      official_snapshot: { source: 'official' },
      reconciliation_logs: [
        { severity: 'warning' },
        { severity: 'warning' },
        { severity: 'warning' },
        { severity: 'warning' },
      ],
      warnings: [
        'Official and local balances differ beyond configured thresholds.',
        'Official and local positions differ beyond configured thresholds.',
        'Official and local open orders differ.',
        'Official and local fills/activity differ.',
      ],
    });
  });

  it.skip('captures paper local snapshot without official reconciliation', async () => {
    const { getOfficialPortfolioSnapshot } = await import('@/lib/official-trading');
    const { getPortfolio } = await import('@/lib/trading-engine');
    // @ts-expect-error Legacy reconcile route was intentionally removed; retained skipped scenario documents old behavior.
    const { POST } = await import('@/app/api/agent/reconcile/route');

    db.query.strategies.findFirst.mockResolvedValue({
      id: 'strategy-1',
      strategyId: 'paper-arb',
      agentMode: 'paper',
      platform: 'polymarket_us',
    });
    vi.mocked(getPortfolio).mockResolvedValue({
      balance: 10000,
      positions: [],
      tradeHistory: [],
      totalValue: 10000,
      totalPnL: 0,
      totalPnLPercent: 0,
    });
    db.insertResults.push(
      { id: 'snapshot-1', source: 'local' },
      { id: 'log-1', severity: 'info' },
    );

    const response = await POST(makeRequest({
      body: { strategy_id: 'paper-arb' },
    }) as never);

    expect(response.status).toBe(200);
    expect(getOfficialPortfolioSnapshot).not.toHaveBeenCalled();
    expect(db.query.realTradeOrders.findMany).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      reconciled: true,
      local_snapshot: { source: 'local' },
      official_snapshot: null,
      reconciliation_logs: [{ severity: 'info' }],
      warnings: [],
    });
  });

  it.skip('returns filtered agent dashboard data', async () => {
    const { GET } = await import('@/app/api/agent/dashboard/route');

    db.selectResults.push(
      [
        {
          id: 'strategy-1',
          userId: 'user-1',
          strategyId: 'real-arb',
          agentMode: 'real',
          platform: 'kalshi',
          status: 'active',
          startingBalance: '10000.00',
          riskConfig: {},
          schedule: '0 * * * *',
          metadata: { real_trading_enabled: true },
          createdAt: new Date('2026-07-03T00:00:00.000Z'),
          updatedAt: new Date('2026-07-03T00:00:00.000Z'),
        },
        {
          id: 'strategy-2',
          userId: 'user-1',
          strategyId: 'paper-polymarket',
          agentMode: 'paper',
          platform: 'polymarket',
          status: 'active',
          startingBalance: '10000.00',
          riskConfig: {},
          schedule: null,
          metadata: {},
          createdAt: new Date('2026-07-02T00:00:00.000Z'),
          updatedAt: new Date('2026-07-02T00:00:00.000Z'),
        },
      ],
      [],
      [
        {
          id: 'user-1',
          email: 'agent@example.test',
          name: 'Agent One',
        },
      ],
      [
        {
          id: 'report-1',
          strategyId: 'strategy-1',
          userId: 'user-1',
          strategyName: 'real-arb',
          filename: 'run.md',
          title: 'Run',
          lessonsLearned: 'Tighten sizing',
          nextSteps: 'Reconcile again',
          createdAt: new Date('2026-07-03T01:00:00.000Z'),
        },
      ],
      [
        {
          id: 'snapshot-1',
          strategyId: 'strategy-1',
          userId: 'user-1',
          runId: null,
          platform: 'kalshi',
          agentMode: 'real',
          source: 'official',
          cash: '1000.00',
          positionsValue: '25.00',
          totalValue: '1025.00',
          pnl: '25.000000',
          positions: [],
          orders: [],
          capturedAt: new Date('2026-07-03T02:00:00.000Z'),
        },
      ],
      [
        {
          id: 'order-1',
          strategyId: 'strategy-1',
          userId: 'user-1',
          runId: null,
          platform: 'kalshi',
          officialOrderId: 'official-1',
          clientOrderId: 'client-1',
          marketId: null,
          marketSlugOrTicker: 'KXTEST',
          side: 'BUY',
          quantity: '10.000000',
          price: '0.250000',
          status: 'RESTING',
          request: {},
          officialResponse: {},
          error: {},
          createdAt: new Date('2026-07-03T03:00:00.000Z'),
          updatedAt: new Date('2026-07-03T03:00:00.000Z'),
        },
      ],
      [
        {
          id: 'log-1',
          strategyId: 'strategy-1',
          userId: 'user-1',
          runId: null,
          platform: 'kalshi',
          severity: 'warning',
          differenceType: 'balance',
          diff: { cash: { delta: 25 } },
          threshold: { cash: 1 },
          message: 'Official and local balances differ beyond configured thresholds.',
          createdAt: new Date('2026-07-03T04:00:00.000Z'),
        },
      ],
    );

    const response = await GET(makeRequest({
      url: 'https://example.test/api/agent/dashboard?platform=kalshi&agent_mode=real',
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      summary: {
        strategies: 1,
        reports: 1,
        snapshots: 1,
        real_orders: 1,
        open_real_orders: 1,
        reconciliation_warnings: 1,
      },
      strategies: [
        {
          id: 'strategy-1',
          agent_name: 'Agent One',
          strategy_name: 'real-arb',
          latest_snapshot: { total_value: 1025, pnl: 25 },
        },
      ],
      reports: [{ filename: 'run.md', strategy_name: 'real-arb', agent_name: 'Agent One' }],
      real_orders: [{ id: 'order-1', status: 'RESTING' }],
      reconciliation_logs: [{ id: 'log-1', severity: 'warning' }],
    });
  });

  it('lets the global agent viewer see all agent strategies', async () => {
    const { auth } = await import('@/lib/auth');
    vi.mocked(auth).mockResolvedValue({
      user: { id: 'admin-user', email: 'dickenslihaocheng@gmail.com' },
    } as never);
    const { GET } = await import('@/app/api/agent/dashboard/route');

    db.selectResults.push(
      [
        {
          id: 'strategy-1',
          userId: 'agent-user-1',
          strategyId: 'global-arb',
          agentMode: 'paper',
          platform: 'polymarket',
          status: 'active',
          startingBalance: '10000.00',
          riskConfig: {},
          schedule: null,
          metadata: {},
          createdAt: new Date('2026-07-04T00:00:00.000Z'),
          updatedAt: new Date('2026-07-04T00:00:00.000Z'),
        },
      ],
      [],
      [
        {
          id: 'agent-user-1',
          email: 'agent+global@polymarkettraders.com',
          name: 'Global Agent',
        },
      ],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
    );

    const response = await GET(makeRequest({
      url: 'https://example.test/api/agent/dashboard',
    }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      access: { scope: 'global' },
      summary: { strategies: 1 },
      strategies: [
        {
          id: 'strategy-1',
          agent_id: 'agent-user-1',
          agent_email: 'agent+global@polymarkettraders.com',
          agent_name: 'Global Agent',
          strategy_name: 'global-arb',
        },
      ],
    });
  });
});
