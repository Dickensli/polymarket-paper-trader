import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

function getDeterministicUuid(userId: string, accountName: string): string {
  const hash = crypto.createHash('sha256').update(`${userId}:${accountName}`).digest('hex');
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    '4' + hash.substring(13, 16),
    ((parseInt(hash.substring(16, 18), 16) & 0x3f) | 0x80).toString(16) + hash.substring(18, 20),
    hash.substring(20, 32)
  ].join('-');
}

import { accounts, sessions, users, verificationTokens } from '@/lib/db/schema';

import Resend from 'next-auth/providers/resend';

// Only initialize with database adapter when DATABASE_URL is available
const adapter = process.env.DATABASE_URL
  ? DrizzleAdapter(getDb(), {
      usersTable: users,
      accountsTable: accounts,
      sessionsTable: sessions,
      verificationTokensTable: verificationTokens,
    })
  : undefined;

/**
 * NextAuth.js v5 configuration.
 */
const nextAuthResult = NextAuth({
  adapter,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? '',
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? '',
      allowDangerousEmailAccountLinking: true,
    }),
    Resend({
      from: process.env.EMAIL_FROM || 'noreply@polymarkettraders.com',
      apiKey: process.env.RESEND_API_KEY || process.env.AUTH_RESEND_KEY,
    }),
  ],
  session: {
    strategy: adapter ? 'database' : 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/auth/signin',
  },
  callbacks: {
    async session({ session, user }) {
      if (user && session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
});

export const handlers = nextAuthResult.handlers;
export const signIn = nextAuthResult.signIn;
export const signOut = nextAuthResult.signOut;

import { eq } from 'drizzle-orm';

export const auth = async (...args: any[]) => {
  // Try original session cookie auth first
  const session = await (nextAuthResult.auth as any)(...args);
  if (session) return session;

  // Bypass for agent requests using agent secret
  try {
    const { headers } = await import('next/headers');
    const reqHeaders = await headers();
    const agentSecret = reqHeaders.get('x-agent-secret');
    let targetUserId = reqHeaders.get('x-agent-user-id') || '815c03ff-dad9-4535-a427-20422812424a';
    const agentAccount = reqHeaders.get('x-agent-account') || 'default';

    const isProd = process.env.NODE_ENV === 'production';
    const expectedSecret = process.env.AGENT_SECRET || (isProd ? undefined : "default_secret_key_123");

    if (agentSecret && expectedSecret && agentSecret === expectedSecret) {
      if (agentAccount !== 'default') {
        targetUserId = getDeterministicUuid(targetUserId, agentAccount);
      }

      const db = getDb();
      const strategyName = agentAccount === 'default' ? 'AI Agent' : `AI Agent (${agentAccount})`;
      const strategyEmail = agentAccount === 'default' ? 'agent@polymarkettraders.com' : `agent+${agentAccount}@polymarkettraders.com`;

      // Ensure the agent user exists in the database to satisfy foreign keys
      let dbUser = await db.query.users.findFirst({ where: eq(users.id, targetUserId) });
      if (!dbUser) {
        // Fallback to agent email lookup in case of ID mismatch
        dbUser = await db.query.users.findFirst({ where: eq(users.email, strategyEmail) });
        if (dbUser) {
          targetUserId = dbUser.id;
        } else {
          // Auto-create agent user row
          await db.insert(users).values({
            id: targetUserId,
            email: strategyEmail,
            name: strategyName,
          });
        }
      }

      return {
        user: {
          id: targetUserId,
          email: strategyEmail,
          name: strategyName,
        },
        expires: new Date(Date.now() + 3600 * 1000).toISOString(),
      };
    }
  } catch (e) {
    // Suppress error if headers() is called outside request context (e.g. static gen or build)
  }

  return null;
};
