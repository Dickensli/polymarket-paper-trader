import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Connection singleton for serverless environments
let connection: ReturnType<typeof postgres> | null = null;

function getConnection() {
  if (!connection) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        'DATABASE_URL is not set. Please configure your Supabase PostgreSQL connection string.',
      );
    }
    const poolMax = process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 10;
    connection = postgres(databaseUrl, {
      prepare: false, // Required for PgBouncer/Supabase pooler
      max: poolMax, // connection pool size
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return connection;
}

/**
 * Get the Drizzle ORM database instance.
 * Uses a singleton connection pool suitable for serverless environments.
 */
export function getDb() {
  return drizzle(getConnection(), { schema });
}

/** Type alias for the Drizzle database instance */
export type Database = ReturnType<typeof getDb>;

// Re-export schema for convenience
export * from './schema';
