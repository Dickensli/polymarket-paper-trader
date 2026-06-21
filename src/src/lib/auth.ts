import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { getDb } from '@/lib/db';

import { accounts, sessions, users, verificationTokens } from '@/lib/db/schema';

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
 *
 * - Uses Drizzle adapter when DATABASE_URL is present, falls back to JWT sessions otherwise.
 * - Google OAuth provider configured via AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET env vars.
 * - Session callback injects `user.id` into the session object for downstream use.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? '',
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? '',
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
