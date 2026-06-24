'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import LoadingSpinner from '@/components/LoadingSpinner';

type HistoryPoint = {
  date: string;
  [strategyName: string]: any; // portfolioValue, pnl, rank
};

const DEFAULT_COLORS = ['#3b82f6', '#10b981', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899'];

function getStrategyColor(name: string, index: number): string {
  if (name === 'Dickens Li') return '#3b82f6';
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length] || '#94a3b8';
}


export default function AnalyticsClient() {
  const [data, setData] = useState<{ strategies: string[]; history: HistoryPoint[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Interactive hover states
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<'value' | 'pnl'>('value');
  const [activeStrategy, setActiveStrategy] = useState<string | null>(null); // filter highlight

  useEffect(() => {
    fetch('/api/leaderboard/history')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch leaderboard history');
        return res.json();
      })
      .then((json) => {
        if (json.success) {
          setData({
            strategies: json.strategies,
            history: json.history
          });
        }
      })
      .catch((err) => {
        setError(err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <LoadingSpinner size="md" />
        <span className="text-sm text-foreground-muted">Loading strategy metrics...</span>
      </div>
    );
  }

  if (error || !data || data.history.length === 0) {
    return (
      <div className="p-8 bg-red-950/20 border border-red-900/50 text-red-400 rounded-xl max-w-xl mx-auto text-center">
        <h3 className="font-bold text-lg mb-2">Failed to load analytics</h3>
        <p className="text-sm text-red-300/80 mb-4">{error || 'No historical data found.'}</p>
        <Link href="/leaderboard" className="text-sm font-semibold text-primary hover:underline">
          Back to Leaderboard
        </Link>
      </div>
    );
  }

  const { strategies, history } = data;

  // Calculate high-level metrics for each strategy
  const strategyStats = strategies.map((strat) => {
    const values = history.map(h => Number(h[strat] || 10000));
    const startVal = 10000; // default starting balance
    const currentVal = values[values.length - 1] || startVal;
    const totalPnl = currentVal - startVal;
    const returnPct = (totalPnl / startVal) * 100;
    
    // Find min and max values to calculate volatility / drawdowns
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const peakToTrough = maxVal > 0 ? ((minVal - maxVal) / maxVal) * 100 : 0;
    
    // Count profitable days
    let profitableDays = 0;
    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[i - 1]) profitableDays++;
    }
    const winRate = (profitableDays / (values.length - 1)) * 100;

    return {
      name: strat,
      currentValue: currentVal,
      totalPnl,
      returnPct,
      maxVal,
      minVal,
      maxDrawdown: peakToTrough,
      winRate
    };
  }).sort((a, b) => b.totalPnl - a.totalPnl);

  const topStrat = strategyStats[0];
  const maxDrawdownStrat = [...strategyStats].sort((a, b) => a.maxDrawdown - b.maxDrawdown)[0];
  const maxWinRateStrat = [...strategyStats].sort((a, b) => b.winRate - a.winRate)[0];
  const secondStrat = strategyStats[1] || strategyStats[0];

  // SVG Chart Dimensions
  const padding = { top: 20, right: 30, bottom: 40, left: 60 };
  const width = 800;
  const height = 350;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Determine global min and max for chart scale
  const allValues = history.flatMap(h => 
    strategies.map(s => selectedMetric === 'value' ? Number(h[s] || 10000) : Number(h[`${s}_pnl`] || 0))
  );
  const maxScaleVal = Math.max(...allValues) * 1.02;
  const minScaleVal = Math.min(...allValues) * 0.98;

  // Scale helpers
  const getX = (index: number) => padding.left + (index / (history.length - 1)) * chartWidth;
  const getY = (val: number) => {
    const scaleRange = maxScaleVal - minScaleVal;
    if (scaleRange === 0) return padding.top + chartHeight / 2;
    const ratio = (val - minScaleVal) / scaleRange;
    return padding.top + chartHeight - ratio * chartHeight;
  };

  // Format date labels
  const getFormattedDate = (isoStr: string) => {
    const d = new Date(isoStr);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  // Fetch hover point details
  const activePoint = hoverIndex !== null ? history[hoverIndex] : history[history.length - 1];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border/40 pb-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight gradient-text">Performance Analytics</h1>
          <p className="mt-1 text-sm text-foreground-muted">Compare strategy returns, win rates, and daily portfolio metrics.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/leaderboard"
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-surface border border-border/50 hover:bg-card-hover hover:border-border transition-all"
          >
            ← Leaderboard List
          </Link>
        </div>
      </div>

      {/* Primary Chart Section (Robinhood style) */}
      <div className="glass-card p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          {/* Active Data Point Info */}
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
              {hoverIndex !== null ? `Snapshot: ${getFormattedDate(activePoint.date)}` : 'Current Standings'}
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-extrabold tracking-tight font-mono">
                ${(selectedMetric === 'value' 
                  ? Number(activePoint[activeStrategy || strategies[0]] || 10000)
                  : Number(activePoint[`${activeStrategy || strategies[0]}_pnl`] || 0)
                ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                (activePoint[`${activeStrategy || strategies[0]}_pnl`] || 0) >= 0
                  ? 'bg-profit/10 text-profit'
                  : 'bg-loss/10 text-loss'
              }`}>
                {activeStrategy || strategies[0] || 'Leader'}
              </span>
            </div>
          </div>

          {/* Metric Selector Tabs */}
          <div className="flex self-start md:self-auto gap-1 p-0.5 bg-background-secondary rounded-lg border border-border/50">
            <button
              onClick={() => setSelectedMetric('value')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                selectedMetric === 'value'
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              Portfolio Value
            </button>
            <button
              onClick={() => setSelectedMetric('pnl')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                selectedMetric === 'pnl'
                  ? 'bg-surface text-foreground shadow-sm'
                  : 'text-foreground-muted hover:text-foreground'
              }`}
            >
              Absolute P&L
            </button>
          </div>
        </div>

        {/* Custom SVG Line Chart */}
        <div className="relative w-full overflow-hidden">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto select-none"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const ratio = x / rect.width;
              // Map ratio back to history index
              const calculatedX = ratio * width;
              const chartX = calculatedX - padding.left;
              const hoverIdx = Math.round((chartX / chartWidth) * (history.length - 1));
              if (hoverIdx >= 0 && hoverIdx < history.length) {
                setHoverIndex(hoverIdx);
              }
            }}
            onMouseLeave={() => setHoverIndex(null)}
          >
            {/* Grid Lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((r) => {
              const yVal = minScaleVal + r * (maxScaleVal - minScaleVal);
              return (
                <g key={r} className="opacity-20">
                  <line
                    x1={padding.left}
                    y1={getY(yVal)}
                    x2={width - padding.right}
                    y2={getY(yVal)}
                    stroke="var(--color-border)"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                  />
                  <text
                    x={padding.left - 8}
                    y={getY(yVal) + 4}
                    textAnchor="end"
                    className="text-[10px] font-mono fill-foreground-muted"
                  >
                    {selectedMetric === 'value' 
                      ? `$${Math.round(yVal).toLocaleString()}`
                      : `${yVal >= 0 ? '+' : ''}$${Math.round(yVal).toLocaleString()}`
                    }
                  </text>
                </g>
              );
            })}

            {/* Date Labels (X-Axis) */}
            {[0, 0.25, 0.5, 0.75, 1].map((r) => {
              const idx = Math.floor(r * (history.length - 1));
              const pt = history[idx];
              if (!pt) return null;
              return (
                <text
                  key={idx}
                  x={getX(idx)}
                  y={height - padding.bottom + 18}
                  textAnchor="middle"
                  className="text-[10px] font-mono fill-foreground-muted opacity-80"
                >
                  {getFormattedDate(pt.date)}
                </text>
              );
            })}

            {/* Render lines for each strategy */}
            {strategies.map((strat, stratIdx) => {
              const isFiltered = activeStrategy !== null && activeStrategy !== strat;
              const color = getStrategyColor(strat, stratIdx);
              
              // Map values
              const points = history.map((pt, idx) => {
                const val = selectedMetric === 'value' ? Number(pt[strat] || 10000) : Number(pt[`${strat}_pnl`] || 0);
                return `${getX(idx)},${getY(val)}`;
              }).join(' ');

              // Generate path string
              const pathData = `M ${points}`;

              return (
                <g key={strat} className="transition-all duration-300">
                  {/* Subtle Gradient Area Fill under active strategy line */}
                  {!isFiltered && (activeStrategy === strat || activeStrategy === null) && (
                    <path
                      d={`${pathData} L ${getX(history.length - 1)},${height - padding.bottom} L ${getX(0)},${height - padding.bottom} Z`}
                      fill={`url(#gradient-${strat})`}
                      className="opacity-10 transition-opacity duration-300"
                    />
                  )}

                  {/* Main Line */}
                  <path
                    d={pathData}
                    fill="none"
                    stroke={color}
                    strokeWidth={activeStrategy === strat ? 3.5 : isFiltered ? 1.2 : 2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="transition-all duration-300"
                    style={{
                      opacity: isFiltered ? 0.15 : 1,
                      filter: activeStrategy === strat ? `drop-shadow(0px 4px 12px ${color}30)` : 'none'
                    }}
                  />
                  
                  {/* Hover Marker Circle */}
                  {hoverIndex !== null && !isFiltered && (
                    <circle
                      cx={getX(hoverIndex)}
                      cy={getY(selectedMetric === 'value' ? Number(activePoint[strat] || 10000) : Number(activePoint[`${strat}_pnl`] || 0))}
                      r={activeStrategy === strat ? 6 : 4}
                      fill={color}
                      stroke="#0a0b0f"
                      strokeWidth={2}
                    />
                  )}

                  {/* Gradients definitions */}
                  <defs>
                    <linearGradient id={`gradient-${strat}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={0.6} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                </g>
              );
            })}

            {/* Hover vertical crosshair line */}
            {hoverIndex !== null && (
              <line
                x1={getX(hoverIndex)}
                y1={padding.top}
                x2={getX(hoverIndex)}
                y2={height - padding.bottom}
                stroke="var(--color-foreground-muted)"
                strokeWidth={1}
                strokeDasharray="3 3"
                className="opacity-40"
              />
            )}
          </svg>
        </div>

        {/* Strategy Legend Toggles */}
        <div className="flex flex-wrap gap-3 mt-6 border-t border-border/40 pt-4">
          {strategies.map((strat, stratIdx) => {
            const color = getStrategyColor(strat, stratIdx);
            const isSelected = activeStrategy === strat;
            const isAnySelected = activeStrategy !== null;
            
            return (
              <button
                key={strat}
                onClick={() => setActiveStrategy(isSelected ? null : strat)}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-full border transition-all ${
                  isSelected
                    ? 'border-transparent text-white'
                    : isAnySelected
                    ? 'border-border/30 text-foreground-muted opacity-40 hover:opacity-75 hover:border-border/50'
                    : 'border-border/50 text-foreground-muted hover:border-border'
                }`}
                style={{
                  backgroundColor: isSelected ? `${color}18` : 'transparent',
                  borderColor: isSelected ? color : undefined,
                  boxShadow: isSelected ? `0 0 10px ${color}10` : 'none'
                }}
              >
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span>{strat}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid of Strategy Detail Analytics Cards */}
      <div>
        <h2 className="text-xl font-bold text-foreground mb-4">Detailed Metrics</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {strategyStats.map((stats, statsIdx) => {
            const color = getStrategyColor(stats.name, statsIdx);
            const isProfit = stats.totalPnl >= 0;
            const pnlColor = isProfit ? 'text-profit' : 'text-loss';
            
            return (
              <div
                key={stats.name}
                onClick={() => setActiveStrategy(activeStrategy === stats.name ? null : stats.name)}
                className={`glass-card p-5 cursor-pointer glass-card-hover transition-all duration-300 ${
                  activeStrategy === stats.name ? 'border-primary shadow-lg ring-1 ring-primary/30' : ''
                }`}
              >
                {/* Colored Strategy Ribbon */}
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-background-secondary border border-border/80 text-foreground">
                    {stats.name}
                  </span>
                  <span className="w-3.5 h-3.5 rounded-full ring-4 ring-background" style={{ backgroundColor: color }} />
                </div>

                <div className="space-y-3">
                  {/* Current Portfolio Value */}
                  <div>
                    <span className="text-xs text-foreground-muted">Portfolio Value</span>
                    <div className="text-xl font-extrabold font-mono mt-0.5">
                      ${stats.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>

                  {/* Absolute P&L / Return */}
                  <div>
                    <span className="text-xs text-foreground-muted">Total Returns</span>
                    <div className={`text-sm font-bold font-mono mt-0.5 ${pnlColor}`}>
                      {isProfit ? '+' : ''}${stats.totalPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({isProfit ? '+' : ''}{stats.returnPct.toFixed(2)}%)
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-border/30 pt-3 text-[11px]">
                    <div>
                      <span className="text-foreground-muted block">Win Rate (Days)</span>
                      <span className="font-semibold font-mono text-foreground">{stats.winRate.toFixed(0)}%</span>
                    </div>
                    <div>
                      <span className="text-foreground-muted block">Max Drawdown</span>
                      <span className="font-semibold font-mono text-loss">{stats.maxDrawdown.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* P&L Comparison Bar Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Bar Chart comparing absolute profit */}
        <div className="glass-card p-6 lg:col-span-2 shadow-md">
          <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-wider mb-5">Absolute Net Profit Comparison</h3>
          <div className="space-y-4">
            {strategyStats.map((strat, stratIdx) => {
              const color = getStrategyColor(strat.name, stratIdx);
              const maxAbsPnl = Math.max(...strategyStats.map(s => Math.abs(s.totalPnl)));
              const ratio = maxAbsPnl > 0 ? (Math.abs(strat.totalPnl) / maxAbsPnl) * 100 : 0;
              const isProfit = strat.totalPnl >= 0;

              return (
                <div key={strat.name} className="flex items-center gap-3">
                  <span className="w-24 text-xs font-medium text-foreground truncate text-right">
                    {strat.name}
                  </span>
                  
                  {/* Visual Bar container */}
                  <div className="flex-1 h-7 bg-background-secondary rounded-md overflow-hidden relative flex items-center px-2">
                    {/* Left/Right Bar offset depending on profit or loss */}
                    <div
                      className="absolute top-0 bottom-0 rounded-sm transition-all duration-500"
                      style={{
                        backgroundColor: isProfit ? `${color}d0` : 'rgba(244, 63, 94, 0.4)',
                        left: isProfit ? '50%' : undefined,
                        right: !isProfit ? '50%' : undefined,
                        width: `${ratio / 2}%`,
                      }}
                    />
                    
                    {/* 50% line separator */}
                    <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-border z-10" />

                    {/* Text Overlay */}
                    <span className={`text-[10px] font-bold font-mono z-20 ${
                      isProfit ? 'ml-auto text-profit' : 'mr-auto text-loss'
                    }`} style={{
                      marginRight: !isProfit ? 'auto' : undefined,
                      marginLeft: isProfit ? 'auto' : undefined,
                    }}>
                      {isProfit ? '+' : '-'}${Math.abs(strat.totalPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Strategy Description & Risk overview card */}
        <div className="glass-card p-6 shadow-md flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-wider mb-4">Risk-Return Summary</h3>
            <div className="space-y-4 text-xs">
              <div className="flex justify-between items-center border-b border-border/20 pb-2">
                <span className="text-foreground-muted">Top Performing Strategy</span>
                <span className={`font-semibold font-mono ${topStrat.returnPct >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {topStrat.name} ({topStrat.returnPct >= 0 ? '+' : ''}{topStrat.returnPct.toFixed(1)}%)
                </span>
              </div>
              <div className="flex justify-between items-center border-b border-border/20 pb-2">
                <span className="text-foreground-muted">Highest Drawdown</span>
                <span className={`font-semibold font-mono ${maxDrawdownStrat.maxDrawdown >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {maxDrawdownStrat.name} ({maxDrawdownStrat.maxDrawdown.toFixed(1)}%)
                </span>
              </div>
              <div className="flex justify-between items-center border-b border-border/20 pb-2">
                <span className="text-foreground-muted">Highest Win Rate (Days)</span>
                <span className="font-semibold text-foreground font-mono">
                  {maxWinRateStrat.name} ({maxWinRateStrat.winRate.toFixed(0)}%)
                </span>
              </div>
              <div className="flex justify-between items-center pb-2">
                <span className="text-foreground-muted">Default Account Name</span>
                <span className={`font-semibold font-mono ${secondStrat.returnPct >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {secondStrat.name} ({secondStrat.returnPct >= 0 ? '+' : ''}{secondStrat.returnPct.toFixed(1)}%)
                </span>
              </div>
            </div>
          </div>
          
          <div className="bg-background-secondary border border-border/50 rounded-lg p-3 text-[11px] text-foreground-muted/90 mt-4 leading-relaxed">
            💡 <strong>Pro Tip:</strong> Click any strategy card or legend label above to isolate its historical line and focus on its performance trajectory.
          </div>
        </div>
      </div>
    </div>
  );
}
