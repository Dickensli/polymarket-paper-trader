import {
  pgTable,
  uuid,
  varchar,
  text,
  decimal,
  timestamp,
  boolean,
  jsonb,
  integer,
  index,
  uniqueIndex,
  pgEnum,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ─── Enums ──────────────────────────────────────────────────

/** Trade outcome direction */
export const outcomeEnum = pgEnum('outcome', ['YES', 'NO']);

/** Whether the trade is a buy or sell */
export const tradeActionEnum = pgEnum('trade_action', ['BUY', 'SELL']);

/** Order lifecycle status */
export const orderStatusEnum = pgEnum('order_status', [
  'PENDING',
  'FILLED',
  'CANCELLED',
  'REJECTED',
]);

// ─── Users ──────────────────────────────────────────────────

/** Core user table – doubles as the NextAuth user table */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  image: text('image'),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  settings: jsonb('settings').default({
    defaultTradeSize: 100,
    slippageEnabled: false,
    slippageBps: 50,
    theme: "system",
    notifications: true,
  }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── NextAuth Tables ────────────────────────────────────────

/** OAuth accounts linked to users (NextAuth adapter table) */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 255 }).notNull(),
    provider: varchar('provider', { length: 255 }).notNull(),
    providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: varchar('token_type', { length: 255 }),
    scope: varchar('scope', { length: 255 }),
    id_token: text('id_token'),
    session_state: varchar('session_state', { length: 255 }),
  },
  (table) => [
    uniqueIndex('accounts_provider_idx').on(table.provider, table.providerAccountId),
  ],
);

/** Active sessions (NextAuth adapter table) */
export const sessions = pgTable('sessions', {
  sessionToken: varchar('session_token', { length: 255 }).primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { withTimezone: true }).notNull(),
});

/** Email verification tokens (NextAuth adapter table) */
export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: varchar('identifier', { length: 255 }).notNull(),
    token: varchar('token', { length: 255 }).notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.identifier, table.token] }),
  ],
);

// ─── Portfolios ─────────────────────────────────────────────

/** Per-user paper-trading portfolio with cash balance tracking */
export const portfolios = pgTable(
  'portfolios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    balance: decimal('balance', { precision: 18, scale: 2 }).notNull().default('10000.00'),
    initialBalance: decimal('initial_balance', { precision: 18, scale: 2 }).notNull().default('10000.00'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('portfolios_user_idx').on(table.userId)],
);

// ─── Paper Trades ───────────────────────────────────────────

/** Individual paper trade execution records */
export const paperTrades = pgTable(
  'paper_trades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    marketId: varchar('market_id', { length: 255 }).notNull(),
    marketQuestion: text('market_question'),
    tokenId: varchar('token_id', { length: 255 }).notNull(),
    outcome: outcomeEnum('outcome').notNull(),
    action: tradeActionEnum('action').notNull(),
    shares: decimal('shares', { precision: 18, scale: 6 }).notNull(),
    pricePerShare: decimal('price_per_share', { precision: 18, scale: 6 }).notNull(),
    totalCost: decimal('total_cost', { precision: 18, scale: 2 }).notNull(),
    slippageApplied: decimal('slippage_applied', { precision: 18, scale: 6 }).default('0.000000'),
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull().default(''),
    metadata: jsonb('metadata'),
    status: orderStatusEnum('status').notNull().default('FILLED'),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('paper_trades_user_idx').on(table.userId),
    index('paper_trades_portfolio_idx').on(table.portfolioId),
    index('paper_trades_market_idx').on(table.marketId),
    index('paper_trades_executed_idx').on(table.executedAt),
    index('paper_trades_idempotency_idx').on(table.idempotencyKey),
  ],
);

// ─── Positions ──────────────────────────────────────────────

/** Aggregated open/closed positions per market outcome */
export const positions = pgTable(
  'positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    marketId: varchar('market_id', { length: 255 }).notNull(),
    marketQuestion: text('market_question'),
    tokenId: varchar('token_id', { length: 255 }).notNull(),
    outcome: outcomeEnum('outcome').notNull(),
    shares: decimal('shares', { precision: 18, scale: 6 }).notNull(),
    avgEntryPrice: decimal('avg_entry_price', { precision: 18, scale: 6 }).notNull(),
    currentPrice: decimal('current_price', { precision: 18, scale: 6 }).notNull().default('0.5'),
    isOpen: boolean('is_open').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('positions_user_idx').on(table.userId),
    index('positions_portfolio_idx').on(table.portfolioId),
    uniqueIndex('positions_unique_idx').on(table.userId, table.marketId, table.outcome),
  ],
);

// ─── Ledger (Double-Entry Bookkeeping) ──────────────────────

/** Immutable ledger for tracking all balance-affecting events */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tradeId: uuid('trade_id')
      .references(() => paperTrades.id, { onDelete: 'set null' }),
    accountType: varchar('account_type', { length: 50 }).notNull(), // 'CASH' | 'POSITION' | 'PNL'
    amount: decimal('amount', { precision: 18, scale: 6 }).notNull(), // positive = credit, negative = debit
    balanceAfter: decimal('balance_after', { precision: 18, scale: 6 }),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('ledger_user_idx').on(table.userId),
    index('ledger_trade_idx').on(table.tradeId),
    index('ledger_created_idx').on(table.createdAt),
  ],
);

// ─── Event Cache ────────────────────────────────────────────

/** Locally cached Polymarket events to represent groupings/cards */
export const eventCache = pgTable(
  'event_cache',
  {
    id: varchar('id', { length: 255 }).primaryKey(), // Polymarket event ID
    ticker: varchar('ticker', { length: 255 }),
    slug: varchar('slug', { length: 255 }),
    title: text('title'),
    description: text('description'),
    startDate: timestamp('start_date', { withTimezone: true }),
    creationDate: timestamp('creation_date', { withTimezone: true }),
    endDate: timestamp('end_date', { withTimezone: true }),
    image: text('image'),
    icon: text('icon'),
    active: boolean('active').default(true),
    closed: boolean('closed').default(false),
    archived: boolean('archived').default(false),
    mutuallyExclusive: boolean('mutually_exclusive').default(false),
    category: varchar('category', { length: 255 }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('event_cache_category_idx').on(table.category),
    index('event_cache_slug_idx').on(table.slug),
    index('event_cache_synced_idx').on(table.lastSyncedAt),
  ]
);

// ─── Market Cache ───────────────────────────────────────────

/** Locally cached Polymarket market data to reduce API calls */
export const marketCache = pgTable(
  'market_cache',
  {
    id: varchar('id', { length: 255 }).primaryKey(), // Polymarket market ID
    eventId: varchar('event_id', { length: 255 })
      .references(() => eventCache.id, { onDelete: 'cascade' }),
    question: text('question'),
    conditionId: varchar('condition_id', { length: 255 }),
    outcomes: jsonb('outcomes'), // ['Yes', 'No']
    outcomePrices: jsonb('outcome_prices'), // [0.65, 0.35]
    tokenIds: jsonb('token_ids'), // ['token1', 'token2']
    volume24hr: decimal('volume_24hr', { precision: 18, scale: 2 }),
    liquidity: decimal('liquidity', { precision: 18, scale: 2 }),
    category: varchar('category', { length: 255 }),
    image: text('image'),
    icon: text('icon'),
    closed: boolean('closed').default(false),
    endDate: timestamp('end_date', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('market_cache_category_idx').on(table.category),
    index('market_cache_synced_idx').on(table.lastSyncedAt),
  ],
);

// ─── Leaderboard Snapshots ───────────────────────────────────────────

export const leaderboardSnapshots = pgTable(
  'leaderboard_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userName: varchar('user_name', { length: 255 }),
    totalPnl: decimal('total_pnl', { precision: 18, scale: 6 }).notNull(),
    returnPct: decimal('return_pct', { precision: 10, scale: 4 }).notNull(),
    portfolioValue: decimal('portfolio_value', { precision: 18, scale: 6 }).notNull(),
    rank: integer('rank').notNull(),
    period: varchar('period', { length: 50 }).notNull(), // 'DAILY', 'WEEKLY', 'ALL_TIME'
    snapshotDate: timestamp('snapshot_date', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('leaderboard_period_idx').on(table.period),
    index('leaderboard_user_idx').on(table.userId),
    index('leaderboard_rank_idx').on(table.rank),
  ]
);
