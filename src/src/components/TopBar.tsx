'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface TopBarProps {
  onMenuClick: () => void;
}

interface PortfolioSummary {
  balance: number;
  totalPnL: number;
  totalPnLPercent: number;
}

export default function TopBar({ onMenuClick }: TopBarProps) {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);

  useEffect(() => {
    async function fetchSummary() {
      try {
        const res = await fetch('/api/portfolio');
        if (res.ok) {
          const json = await res.json();
          const data = json.data ?? json;
          setSummary({
            balance: data.balance ?? 10000,
            totalPnL: data.totalPnL ?? 0,
            totalPnLPercent: data.totalPnLPercent ?? 0,
          });
        }
      } catch {
        // silently fail
      }
    }
    fetchSummary();
    const interval = setInterval(fetchSummary, 30_000);
    return () => clearInterval(interval);
  }, []);

  const pnlPositive = (summary?.totalPnL ?? 0) >= 0;

  return (
    <header className="sticky top-0 z-30 flex items-center gap-4 border-b border-white/[0.04] bg-[#0a0b0f]/80 backdrop-blur-xl px-4 sm:px-6 py-3">
      {/* Mobile hamburger */}
      <button
        onClick={onMenuClick}
        className="lg:hidden rounded-lg p-2 text-foreground-muted hover:text-foreground hover:bg-white/[0.06] transition-colors"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
        </svg>
      </button>

      {/* Breadcrumb / title — hidden on mobile */}
      <div className="hidden sm:flex items-center gap-2 text-sm">
        <span className="text-foreground-muted">Prediction Markets</span>
        <span className="text-foreground-muted/40">·</span>
        <span className="text-foreground-muted/60 text-xs">Paper Trading Mode</span>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Portfolio summary pills */}
      {summary && (
        <div className="flex items-center gap-2">
          <Link
            href="/portfolio"
            className="flex items-center gap-2 rounded-xl bg-white/[0.03] border border-white/[0.06] px-3.5 py-2 transition-all hover:bg-white/[0.06]"
          >
            <svg className="h-4 w-4 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
            </svg>
            <span className="text-sm font-semibold text-foreground">
              ${summary.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </Link>

          <div
            className={`hidden sm:flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold border ${
              pnlPositive
                ? 'bg-profit/10 text-profit-light border-profit/25'
                : 'bg-loss/10 text-loss-light border-loss/25'
            }`}
          >
            {pnlPositive ? (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
              </svg>
            ) : (
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 4.5l15 15m0 0V8.25m0 11.25H8.25" />
              </svg>
            )}
            {pnlPositive ? '+' : ''}${summary.totalPnL.toFixed(2)} ({pnlPositive ? '+' : ''}{summary.totalPnLPercent.toFixed(1)}%)
          </div>
        </div>
      )}

      {/* Notification bell */}
      <button className="relative rounded-lg p-2 text-foreground-muted hover:text-foreground hover:bg-white/[0.06] transition-colors">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>
        <div className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-primary animate-pulse-glow" />
      </button>
    </header>
  );
}
