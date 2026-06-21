'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import LoadingSpinner from '@/components/LoadingSpinner';

export default function SignInPage() {
  const [loading, setLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  const handleSignIn = async () => {
    try {
      setLoading(true);
      await signIn('google', { callbackUrl: '/' });
    } catch (err) {
      console.error('Sign in failed:', err);
      setLoading(false);
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    try {
      setEmailLoading(true);
      await signIn('resend', { email, redirect: false, callbackUrl: '/' });
      setEmailSent(true);
    } catch (err) {
      console.error('Email sign in failed:', err);
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0b0f] px-4 py-12 sm:px-6 lg:px-8">
      {/* Decorative background glow */}
      <div className="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-profit/5 blur-[120px] pointer-events-none" />

      <div className="relative w-full max-w-md space-y-8">
        <div className="glass-card border border-white/[0.08] bg-[#12131a]/80 backdrop-blur-xl p-8 rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.5)] flex flex-col items-center">
          {/* Logo Icon */}
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-tr from-primary to-primary-light flex items-center justify-center shadow-lg shadow-primary/20 mb-6">
            <svg
              className="h-8 w-8 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
              />
            </svg>
          </div>

          <h2 className="text-center text-3xl font-extrabold text-white tracking-tight">
            PolyTrader
          </h2>
          <p className="mt-2 text-center text-sm text-foreground-muted max-w-xs">
            Practice trading with virtual money. Zero risk, real-time data.
          </p>

          <div className="mt-8 w-full space-y-6">
            {emailSent ? (
              <div className="rounded-xl bg-profit/10 border border-profit/20 p-4 text-center">
                <p className="text-profit-light font-medium">Check your email</p>
                <p className="text-sm text-profit-light/80 mt-1">
                  A magic sign-in link has been sent to {email}
                </p>
              </div>
            ) : (
              <form onSubmit={handleEmailSignIn} className="space-y-3">
                <input
                  type="email"
                  required
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-[#0a0b0f] border border-white/[0.08] rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-colors"
                />
                <button
                  type="submit"
                  disabled={emailLoading || !email}
                  className="w-full flex items-center justify-center py-3 bg-primary hover:bg-primary-light text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                >
                  {emailLoading ? <LoadingSpinner size="sm" /> : 'Continue with Email'}
                </button>
              </form>
            )}

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/[0.08]" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-[#12131a] text-foreground-muted">Or continue with</span>
              </div>
            </div>

            <button
              onClick={handleSignIn}
              disabled={loading}
              className="relative w-full flex items-center justify-center gap-3 px-5 py-3 border border-white/[0.06] rounded-xl text-sm font-semibold text-white bg-white/[0.03] hover:bg-white/[0.08] active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <LoadingSpinner size="sm" />
              ) : (
                <>
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      fill="#EA4335"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
