'use client';

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import LoadingSpinner from '@/components/LoadingSpinner';

/* ─── Types ─────────────────────────────────────────── */
type HistoryPoint = {
  date: string;
  [strategyName: string]: any;
};

type Granularity = 'daily' | 'hourly';
type TimeRange = '1H' | '6H' | '1D' | '1W' | 'ALL';
type ChartMetric = 'value' | 'pnl';
type Platform = 'polymarket' | 'kalshi';

/* ─── Constants ─────────────────────────────────────── */
const STRATEGY_COLORS = [
  { main: '#5AC8FA', glow: 'rgba(90,200,250,0.15)', gradient: ['rgba(90,200,250,0.28)', 'rgba(90,200,250,0)'] },
  { main: '#30D158', glow: 'rgba(48,209,88,0.15)', gradient: ['rgba(48,209,88,0.28)', 'rgba(48,209,88,0)'] },
  { main: '#BF5AF2', glow: 'rgba(191,90,242,0.15)', gradient: ['rgba(191,90,242,0.28)', 'rgba(191,90,242,0)'] },
  { main: '#FF9F0A', glow: 'rgba(255,159,10,0.15)', gradient: ['rgba(255,159,10,0.28)', 'rgba(255,159,10,0)'] },
  { main: '#FF453A', glow: 'rgba(255,69,58,0.15)', gradient: ['rgba(255,69,58,0.28)', 'rgba(255,69,58,0)'] },
  { main: '#64D2FF', glow: 'rgba(100,210,255,0.15)', gradient: ['rgba(100,210,255,0.28)', 'rgba(100,210,255,0)'] },
  { main: '#FF6482', glow: 'rgba(255,100,130,0.15)', gradient: ['rgba(255,100,130,0.28)', 'rgba(255,100,130,0)'] },
];

function getStrategyPalette(name: string, index: number) {
  if (name === 'Dickens Li') return STRATEGY_COLORS[0];
  return STRATEGY_COLORS[index % STRATEGY_COLORS.length];
}

/* ─── Helpers ───────────────────────────────────────── */
function periodKeyToUnix(key: string): number {
  if (key.includes('T')) {
    const [datePart, hourPart] = key.split('T');
    return Math.floor(new Date(`${datePart}T${hourPart}:00:00Z`).getTime() / 1000);
  }
  return Math.floor(new Date(`${key}T00:00:00Z`).getTime() / 1000);
}

function formatCurrency(val: number, compact = false): string {
  if (compact && Math.abs(val) >= 1000) {
    return `$${(val / 1000).toFixed(1)}k`;
  }
  return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPnl(val: number): string {
  const sign = val >= 0 ? '+' : '';
  return `${sign}${formatCurrency(val)}`;
}

function formatPercent(val: number): string {
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(2)}%`;
}

function formatTime(unix: number, granularity: Granularity): string {
  const d = new Date(unix * 1000);
  if (granularity === 'hourly') {
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      timeZone: 'UTC',
    });
  }
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    timeZone: 'UTC',
  });
}

/* ─── Sparkline SVG ─────────────────────────────────── */
function Sparkline({ data, color, height = 32, width = 100 }: {
  data: number[];
  color: string;
  height?: number;
  width?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  });
  const pathD = `M${points.join(' L')}`;
  const areaD = `${pathD} L${width},${height} L0,${height} Z`;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#spark-${color.replace('#', '')})`} />
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ─── Stat Card ─────────────────────────────────────── */
function MetricCard({ label, value, subValue, delta, deltaColor, icon, sparkData, sparkColor }: {
  label: string;
  value: string;
  subValue?: string;
  delta?: string;
  deltaColor?: string;
  icon: React.ReactNode;
  sparkData?: number[];
  sparkColor?: string;
}) {
  return (
    <div className="analytics-metric-card group">
      <div className="flex items-start justify-between mb-3">
        <div className="analytics-metric-icon">{icon}</div>
        {sparkData && sparkColor && (
          <Sparkline data={sparkData} color={sparkColor} width={64} height={24} />
        )}
      </div>
      <div className="text-[11px] font-medium text-foreground-muted/70 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-lg font-bold font-mono text-foreground tracking-tight">{value}</div>
      <div className="flex items-center gap-2 mt-1">
        {delta && (
          <span className={`text-xs font-semibold font-mono ${deltaColor || 'text-foreground-muted'}`}>{delta}</span>
        )}
        {subValue && (
          <span className="text-[10px] text-foreground-muted/60">{subValue}</span>
        )}
      </div>
    </div>
  );
}

/* ─── Hourly Metrics Calculator ─────────────────────── */
function computeHourlyMetrics(history: HistoryPoint[], stratName: string, granularity: Granularity) {
  const values = history.map(h => Number(h[stratName] || 10000));
  if (values.length < 2) {
    return {
      hourlyPnlRate: 0, avgHourlyReturn: 0, hourlyWinRate: 0,
      hourlySharpe: 0, maxHourlyGain: 0, maxHourlyLoss: 0,
      totalPnl: 0, returnPct: 0, currentValue: 10000,
      maxDrawdown: 0, volatility: 0, periodReturns: [] as number[],
      hourlyValues: values,
    };
  }

  const startVal = 10000;
  const currentValue = values[values.length - 1];
  const totalPnl = currentValue - startVal;
  const returnPct = (totalPnl / startVal) * 100;

  // Period-over-period returns
  const periodReturns: number[] = [];
  let winPeriods = 0;
  let maxGain = -Infinity;
  let maxLoss = Infinity;

  for (let i = 1; i < values.length; i++) {
    const ret = values[i] - values[i - 1];
    periodReturns.push(ret);
    if (ret > 0) winPeriods++;
    if (ret > maxGain) maxGain = ret;
    if (ret < maxLoss) maxLoss = ret;
  }

  const periodsCount = periodReturns.length;
  const avgReturn = periodsCount > 0 ? periodReturns.reduce((s, v) => s + v, 0) / periodsCount : 0;
  const winRate = periodsCount > 0 ? (winPeriods / periodsCount) * 100 : 0;

  // Standard deviation for Sharpe
  const variance = periodsCount > 0
    ? periodReturns.reduce((s, v) => s + Math.pow(v - avgReturn, 2), 0) / periodsCount
    : 0;
  const stdDev = Math.sqrt(variance);

  // Sharpe ratio (annualized from hourly/daily)
  const periodsPerYear = granularity === 'hourly' ? 8760 : 365;
  const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(periodsPerYear) : 0;

  // Hourly P&L rate (per-period average)
  const totalHours = granularity === 'hourly' ? periodsCount : periodsCount * 24;
  const hourlyPnlRate = totalHours > 0 ? totalPnl / totalHours : 0;

  // Max drawdown
  let peak = values[0];
  let maxDD = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    const dd = ((v - peak) / peak) * 100;
    if (dd < maxDD) maxDD = dd;
  }

  // Volatility (annualized std dev of returns as %)
  const pctReturns = [];
  for (let i = 1; i < values.length; i++) {
    pctReturns.push(((values[i] - values[i - 1]) / values[i - 1]) * 100);
  }
  const avgPctReturn = pctReturns.length > 0 ? pctReturns.reduce((s, v) => s + v, 0) / pctReturns.length : 0;
  const pctVariance = pctReturns.length > 0
    ? pctReturns.reduce((s, v) => s + Math.pow(v - avgPctReturn, 2), 0) / pctReturns.length
    : 0;
  const volatility = Math.sqrt(pctVariance) * Math.sqrt(periodsPerYear);

  return {
    hourlyPnlRate,
    avgHourlyReturn: granularity === 'hourly' ? avgReturn : avgReturn / 24,
    hourlyWinRate: winRate,
    hourlySharpe: sharpe,
    maxHourlyGain: maxGain === -Infinity ? 0 : maxGain,
    maxHourlyLoss: maxLoss === Infinity ? 0 : maxLoss,
    totalPnl,
    returnPct,
    currentValue,
    maxDrawdown: maxDD,
    volatility,
    periodReturns,
    hourlyValues: values,
  };
}

export default function AnalyticsClient() {
  const [dailyData, setDailyData] = useState<{ strategies: string[]; history: HistoryPoint[] } | null>(null);
  const [hourlyData, setHourlyData] = useState<{ strategies: string[]; history: HistoryPoint[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<Platform>('polymarket');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [chartMetric, setChartMetric] = useState<ChartMetric>('value');
  const [granularity, setGranularity] = useState<Granularity>('hourly');
  const [timeRange, setTimeRange] = useState<TimeRange>('ALL');
  const [selectedStrategies, setSelectedStrategies] = useState<Set<string>>(new Set());
  const [hoveredPoint, setHoveredPoint] = useState<{ time: number; values: Record<string, number> } | null>(null);

  // Chart refs
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRefs = useRef<Map<string, any>>(new Map());

  // Fetch both granularities
  useEffect(() => {
    setLoading(true);
    setError(null);
    const query = `platform=${platform}&page=${page}&pageSize=8`;
    Promise.all([
      fetch(`/api/leaderboard/history?granularity=daily&${query}`).then(r => r.json()),
      fetch(`/api/leaderboard/history?granularity=hourly&${query}`).then(r => r.json()),
    ])
      .then(([daily, hourly]) => {
        if (daily.success) setDailyData({ strategies: daily.strategies, history: daily.history });
        if (hourly.success) setHourlyData({ strategies: hourly.strategies, history: hourly.history });
        setTotalPages(daily.meta?.totalPages ?? hourly.meta?.totalPages ?? 1);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [platform, page]);

  // Active dataset
  const data = granularity === 'hourly' ? hourlyData : dailyData;

  // Filter by time range
  const filteredHistory = useMemo(() => {
    if (!data) return [];
    const hist = data.history;
    if (timeRange === 'ALL' || hist.length === 0) return hist;

    const latestUnix = periodKeyToUnix(hist[hist.length - 1].date);
    const rangeSeconds: Record<TimeRange, number> = {
      '1H': 3600,
      '6H': 6 * 3600,
      '1D': 24 * 3600,
      '1W': 7 * 24 * 3600,
      'ALL': Infinity,
    };
    const cutoff = latestUnix - rangeSeconds[timeRange];
    return hist.filter(pt => periodKeyToUnix(pt.date) >= cutoff);
  }, [data, timeRange]);

  const strategies = data?.strategies || [];

  const selectPlatform = useCallback((nextPlatform: Platform) => {
    setPlatform(nextPlatform);
    setPage(1);
    setSelectedStrategies(new Set());
    setHoveredPoint(null);
  }, []);

  // Toggle a strategy selection
  const toggleStrategy = useCallback((strat: string) => {
    setSelectedStrategies(prev => {
      const next = new Set(prev);
      if (next.has(strat)) {
        next.delete(strat);
      } else {
        next.add(strat);
      }
      return next;
    });
  }, []);

  // Primary strategy (first selected, or first overall if empty)
  const primaryStrat = useMemo(() => {
    if (selectedStrategies.size > 0) {
      return Array.from(selectedStrategies)[0];
    }
    return strategies[0] || '';
  }, [selectedStrategies, strategies]);

  // Compute all strategy metrics using hourly data
  const metricsData = hourlyData || dailyData;
  const metricsGranularity = hourlyData ? 'hourly' : 'daily';
  const allMetrics = useMemo(() => {
    if (!metricsData) return {};
    const result: Record<string, ReturnType<typeof computeHourlyMetrics>> = {};
    for (const strat of metricsData.strategies) {
      result[strat] = computeHourlyMetrics(metricsData.history, strat, metricsGranularity as Granularity);
    }
    return result;
  }, [metricsData, metricsGranularity]);

  const primaryMetrics = allMetrics[primaryStrat];

  /* ─── lightweight-charts ──────────────────────────── */
  useEffect(() => {
    if (!chartContainerRef.current || !data || filteredHistory.length === 0) return;

    let mounted = true;
    let resizeObserver: ResizeObserver | null = null;

    async function initChart() {
      const container = chartContainerRef.current;
      if (!container || !mounted) return;

      const { createChart, ColorType, LineStyle, LineSeries, AreaSeries } = await import('lightweight-charts');
      if (!mounted || !container) return;

      if (chartRef.current) {
        try { chartRef.current.remove(); } catch { /* disposed */ }
        chartRef.current = null;
        seriesRefs.current.clear();
      }

      const chart = createChart(container, {
        width: container.clientWidth,
        height: 420,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: 'rgba(148,163,184,0.6)',
          fontFamily: '"SF Mono", "Fira Code", "Inter", monospace',
          fontSize: 10,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { color: 'rgba(255,255,255,0.025)', style: LineStyle.Dotted },
        },
        crosshair: {
          vertLine: {
            color: 'rgba(255,255,255,0.08)',
            width: 1,
            style: LineStyle.Solid,
            labelBackgroundColor: 'rgba(20,21,30,0.95)',
          },
          horzLine: {
            color: 'rgba(255,255,255,0.08)',
            width: 1,
            style: LineStyle.Dashed,
            labelBackgroundColor: 'rgba(20,21,30,0.95)',
          },
        },
        rightPriceScale: {
          borderVisible: false,
          textColor: 'rgba(148,163,184,0.4)',
        },
        timeScale: {
          borderVisible: false,
          timeVisible: granularity === 'hourly',
          secondsVisible: false,
          rightOffset: 8,
          barSpacing: granularity === 'hourly' ? 8 : 14,
          fixLeftEdge: true,
          fixRightEdge: true,
        },
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
        handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      });

      if (!mounted) { chart.remove(); return; }
      chartRef.current = chart;

      // Subscribe to crosshair move for hover tooltip
      chart.subscribeCrosshairMove((param: any) => {
        if (!param.time || !param.seriesData) {
          setHoveredPoint(null);
          return;
        }
        const values: Record<string, number> = {};
        for (const [name, series] of seriesRefs.current.entries()) {
          const d = param.seriesData.get(series);
          if (d && 'value' in d) values[name] = d.value;
        }
        setHoveredPoint({ time: param.time as number, values });
      });

      const strats = data!.strategies;

      for (let i = 0; i < strats.length; i++) {
        const strat = strats[i];
        const palette = getStrategyPalette(strat, i);
        const hasSelection = selectedStrategies.size > 0;
        const isSelected = selectedStrategies.has(strat);
        const isFiltered = hasSelection && !isSelected;

        // Use area series only if exactly 1 is selected
        const useArea = selectedStrategies.size === 1 && isSelected;

        const series = useArea
          ? chart.addSeries(AreaSeries, {
              lineColor: palette.main,
              lineWidth: 3,
              topColor: palette.gradient[0],
              bottomColor: palette.gradient[1],
              priceFormat: {
                type: 'custom' as const,
                formatter: (price: number) =>
                  chartMetric === 'pnl' ? formatPnl(price) : formatCurrency(price),
              },
              crosshairMarkerVisible: true,
              crosshairMarkerRadius: 5,
              crosshairMarkerBorderColor: palette.main,
              crosshairMarkerBackgroundColor: '#0a0b0f',
              crosshairMarkerBorderWidth: 2,
              lastValueVisible: true,
              priceLineVisible: false,
            })
          : chart.addSeries(LineSeries, {
              color: isFiltered ? `${palette.main}15` : `${palette.main}f0`,
              lineWidth: isFiltered ? 1 : isSelected ? 3 : 2,
              priceFormat: {
                type: 'custom' as const,
                formatter: (price: number) =>
                  chartMetric === 'pnl' ? formatPnl(price) : formatCurrency(price),
              },
              crosshairMarkerVisible: !isFiltered,
              lastValueVisible: !isFiltered,
              priceLineVisible: false,
            });

        const seen = new Set<number>();
        const seriesData = filteredHistory
          .map(pt => ({
            time: periodKeyToUnix(pt.date),
            value: chartMetric === 'value'
              ? Number(pt[strat] || 10000)
              : Number(pt[`${strat}_pnl`] || 0),
          }))
          .filter(d => { if (seen.has(d.time)) return false; seen.add(d.time); return true; })
          .sort((a, b) => (a.time as number) - (b.time as number));

        series.setData(seriesData as any);
        seriesRefs.current.set(strat, series);
      }

      chart.timeScale().fitContent();

      resizeObserver = new ResizeObserver(entries => {
        if (!mounted) return;
        for (const entry of entries) {
          try { chart.applyOptions({ width: entry.contentRect.width }); } catch { /* disposed */ }
        }
      });
      resizeObserver.observe(container);
    }

    initChart();

    return () => {
      mounted = false;
      resizeObserver?.disconnect();
      if (chartRef.current) {
        try { chartRef.current.remove(); } catch { /* disposed */ }
        chartRef.current = null;
        seriesRefs.current.clear();
      }
    };
  }, [data, filteredHistory, chartMetric, selectedStrategies, granularity]);

  /* ─── Render ──────────────────────────────────────── */
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <LoadingSpinner size="md" />
        <span className="text-sm text-foreground-muted animate-pulse">Loading analytics engine...</span>
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

  // Determine hero values — either from hovered point or latest
  const latestValues: Record<string, number> = {};
  const latestHistory = filteredHistory[filteredHistory.length - 1];
  for (const strat of strategies) {
    latestValues[strat] = chartMetric === 'value'
      ? Number(latestHistory?.[strat] || 10000)
      : Number(latestHistory?.[`${strat}_pnl`] || 0);
  }

  const displayValues = hoveredPoint?.values || latestValues;
  const displayTime = hoveredPoint
    ? formatTime(hoveredPoint.time, granularity)
    : formatTime(periodKeyToUnix(latestHistory?.date || ''), granularity);

  const heroValue = displayValues[primaryStrat] ?? 0;
  const heroChange = primaryMetrics
    ? (chartMetric === 'value' ? primaryMetrics.totalPnl : heroValue)
    : 0;
  const heroChangePct = primaryMetrics
    ? (chartMetric === 'value' ? primaryMetrics.returnPct : (primaryMetrics.returnPct))
    : 0;
  const isPositive = heroChange >= 0;

  return (
    <div className="analytics-dashboard animate-fade-in">
      {/* ═══ Hero Header ═══════════════════════════════ */}
      <div className="analytics-hero">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link
                href="/leaderboard"
                className="text-foreground-muted/50 hover:text-foreground-muted transition-colors text-xs font-medium"
              >
                Leaderboard
              </Link>
              <span className="text-foreground-muted/30">/</span>
              <span className="text-xs font-medium text-foreground-muted">Analytics</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              {chartMetric === 'value' ? 'Portfolio Value' : 'Profit & Loss'}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="analytics-live-badge">
              <span className="analytics-live-dot" />
              Live
            </span>
            <span className="text-[10px] text-foreground-muted/50 font-mono">{displayTime}</span>
          </div>
        </div>

        {/* Hero Value Display */}
        <div className="mt-4 mb-2">
          <div className="text-3xl sm:text-4xl font-extrabold font-mono tracking-tight text-foreground">
            {chartMetric === 'value'
              ? formatCurrency(heroValue)
              : formatPnl(heroValue)
            }
          </div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className={`text-sm font-bold font-mono ${isPositive ? 'text-profit' : 'text-loss'}`}>
              {formatPnl(heroChange)}
            </span>
            <span className={`analytics-delta-badge ${isPositive ? 'analytics-delta-positive' : 'analytics-delta-negative'}`}>
              {isPositive ? '↑' : '↓'} {formatPercent(Math.abs(heroChangePct))}
            </span>
            <span className="text-[10px] text-foreground-muted/40 font-medium">
              {granularity === 'hourly' ? 'hourly data' : 'daily data'}
            </span>
          </div>
        </div>
      </div>

      {/* ═══ Chart Controls ════════════════════════════ */}
      <div className="analytics-chart-wrapper">
        <div className="analytics-chart-controls">
          <div className="flex items-center gap-2 flex-wrap">
            <PlatformTabs platform={platform} onSelect={selectPlatform} />

            <div className="analytics-divider" />

            {/* Time Range Selectors */}
            <div className="analytics-pill-group">
              {(['1H', '6H', '1D', '1W', 'ALL'] as TimeRange[]).map(range => (
                <button
                  key={range}
                  onClick={() => {
                    setTimeRange(range);
                    // Auto-switch granularity based on range
                    if (range === '1H' || range === '6H') setGranularity('hourly');
                    else if (range === '1W') setGranularity('daily');
                  }}
                  className={`analytics-pill ${timeRange === range ? 'analytics-pill-active' : ''}`}
                >
                  {range}
                </button>
              ))}
            </div>

            <div className="analytics-divider" />

            {/* Metric Toggle */}
            <div className="analytics-pill-group">
              <button
                onClick={() => setChartMetric('value')}
                className={`analytics-pill ${chartMetric === 'value' ? 'analytics-pill-active' : ''}`}
              >
                Value
              </button>
              <button
                onClick={() => setChartMetric('pnl')}
                className={`analytics-pill ${chartMetric === 'pnl' ? 'analytics-pill-active' : ''}`}
              >
                P&L
              </button>
            </div>

            <div className="analytics-divider" />

            {/* Granularity Toggle */}
            <div className="analytics-pill-group">
              <button
                onClick={() => setGranularity('hourly')}
                className={`analytics-pill ${granularity === 'hourly' ? 'analytics-pill-active' : ''}`}
              >
                <svg className="w-3 h-3 mr-1" viewBox="0 0 16 16" fill="currentColor">
                  <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M8 4v4.5l3 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                Hourly
              </button>
              <button
                onClick={() => setGranularity('daily')}
                className={`analytics-pill ${granularity === 'daily' ? 'analytics-pill-active' : ''}`}
              >
                <svg className="w-3 h-3 mr-1" viewBox="0 0 16 16" fill="currentColor">
                  <rect x="2" y="3" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5"/>
                  <line x1="2" y1="6.5" x2="14" y2="6.5" stroke="currentColor" strokeWidth="1.5"/>
                </svg>
                Daily
              </button>
            </div>
          </div>

          <div className="text-[10px] text-foreground-muted/40 font-mono">
            {filteredHistory.length} data points
          </div>
        </div>

        {/* TradingView Chart Container with Overlay Tooltip */}
        <div className="relative w-full">
          <div
            ref={chartContainerRef}
            className="w-full"
            style={{ height: 420 }}
          />

          {/* Custom absolute hover tooltip in the top-right corner */}
          {hoveredPoint && (
            <div className="absolute top-4 right-4 bg-background-secondary/95 border border-border/80 rounded-xl p-3.5 shadow-2xl backdrop-blur-md z-30 w-64 animate-fade-in text-xs space-y-2.5">
              <div className="flex items-center justify-between border-b border-border/40 pb-2">
                <span className="text-[10px] text-foreground-muted/60 font-mono">HOVER METRICS</span>
                <span className="text-[10px] text-foreground-muted font-mono">{displayTime}</span>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {strategies.map((strat, idx) => {
                  const palette = getStrategyPalette(strat, idx);
                  const hasSelection = selectedStrategies.size > 0;
                  const isSelected = selectedStrategies.has(strat);
                  const isVisible = !hasSelection || isSelected;
                  const val = hoveredPoint.values[strat];
                  if (val === undefined) return null;

                  return (
                    <div key={strat} className={`flex items-center justify-between gap-4 transition-opacity ${isVisible ? 'opacity-100' : 'opacity-25'}`}>
                      <div className="flex items-center gap-2 truncate mr-2">
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: palette.main }} />
                        <span className="font-semibold text-foreground truncate">{strat}</span>
                      </div>
                      <span className="font-mono text-foreground font-bold">{chartMetric === 'value' ? formatCurrency(val) : formatPnl(val)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Strategy Legend Toggles */}
        <div className="analytics-legend">
          {strategies.map((strat, idx) => {
            const palette = getStrategyPalette(strat, idx);
            const isSelected = selectedStrategies.has(strat);
            const hasSelection = selectedStrategies.size > 0;
            const isFiltered = hasSelection && !isSelected;

            return (
              <button
                key={strat}
                onClick={() => toggleStrategy(strat)}
                className={`analytics-legend-item ${isSelected ? 'analytics-legend-active' : ''} ${
                  isFiltered ? 'opacity-30' : ''
                }`}
                style={{
                  '--legend-color': palette.main,
                  borderColor: isSelected ? palette.main : undefined,
                  backgroundColor: isSelected ? `${palette.main}10` : undefined,
                } as React.CSSProperties}
              >
                <span className="analytics-legend-dot" style={{ backgroundColor: palette.main }} />
                <span>{strat}</span>
                {allMetrics[strat] && (
                  <span className={`text-[10px] font-mono ${allMetrics[strat].totalPnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                    {formatPercent(allMetrics[strat].returnPct)}
                  </span>
                )}
              </button>
            );
          })}
          {selectedStrategies.size > 0 && (
            <button
              onClick={() => setSelectedStrategies(new Set())}
              className="analytics-legend-item text-foreground-muted hover:text-foreground hover:border-border border-dashed"
            >
              Reset Filters
            </button>
          )}
        </div>

        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </div>

      {/* ═══ Hourly Rate Metrics (Monitoring Panel) ════ */}
      <div className="analytics-section">
        <div className="analytics-section-header">
          <h2 className="analytics-section-title">
            <svg className="w-4 h-4 text-primary" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd"/>
            </svg>
            Hourly Rate Metrics
          </h2>
          <span className="text-[10px] text-foreground-muted/40 font-mono uppercase tracking-wider">
            {primaryStrat || 'All Strategies'}
          </span>
        </div>

        {primaryMetrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Hourly P&L Rate"
              value={formatPnl(primaryMetrics.hourlyPnlRate)}
              delta={`${formatPercent((primaryMetrics.hourlyPnlRate / 10000) * 100)}/hr`}
              deltaColor={primaryMetrics.hourlyPnlRate >= 0 ? 'text-profit' : 'text-loss'}
              icon={
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M12.577 4.878a.75.75 0 01.919-.53l4.78 1.281a.75.75 0 01.531.919l-1.281 4.78a.75.75 0 01-1.449-.387l.81-3.022a19.407 19.407 0 00-5.594 5.203.75.75 0 01-1.139.093L7 10.06l-4.72 4.72a.75.75 0 01-1.06-1.06l5.25-5.25a.75.75 0 011.06 0l3.074 3.073a20.923 20.923 0 015.545-4.931l-3.042.815a.75.75 0 01-.53-.919z"/>
                </svg>
              }
              sparkData={primaryMetrics.periodReturns.slice(-24)}
              sparkColor={primaryMetrics.hourlyPnlRate >= 0 ? '#30D158' : '#FF453A'}
            />
            <MetricCard
              label={`Avg ${metricsGranularity === 'hourly' ? 'Hourly' : 'Daily'} Return`}
              value={formatCurrency(Math.abs(primaryMetrics.avgHourlyReturn))}
              subValue={`per ${metricsGranularity === 'hourly' ? 'hour' : 'day'}`}
              delta={primaryMetrics.avgHourlyReturn >= 0 ? '▲ Positive' : '▼ Negative'}
              deltaColor={primaryMetrics.avgHourlyReturn >= 0 ? 'text-profit' : 'text-loss'}
              icon={
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z" clipRule="evenodd"/>
                </svg>
              }
            />
            <MetricCard
              label="Win Rate"
              value={`${primaryMetrics.hourlyWinRate.toFixed(1)}%`}
              subValue={`${metricsGranularity === 'hourly' ? 'hourly' : 'daily'} periods`}
              delta={primaryMetrics.hourlyWinRate >= 50 ? 'Above avg' : 'Below avg'}
              deltaColor={primaryMetrics.hourlyWinRate >= 50 ? 'text-profit' : 'text-loss'}
              icon={
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M16.403 12.652a3 3 0 000-5.304 3 3 0 00-3.75-3.751 3 3 0 00-5.305 0 3 3 0 00-3.751 3.75 3 3 0 000 5.305 3 3 0 003.75 3.751 3 3 0 005.305 0 3 3 0 003.751-3.75zm-2.546-4.46a.75.75 0 00-1.214-.883l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd"/>
                </svg>
              }
            />
            <MetricCard
              label="Sharpe Ratio"
              value={primaryMetrics.hourlySharpe.toFixed(2)}
              subValue="annualized"
              delta={primaryMetrics.hourlySharpe >= 1 ? 'Good' : primaryMetrics.hourlySharpe >= 0.5 ? 'Moderate' : 'Low'}
              deltaColor={primaryMetrics.hourlySharpe >= 1 ? 'text-profit' : primaryMetrics.hourlySharpe >= 0.5 ? 'text-foreground-muted' : 'text-loss'}
              icon={
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 000 1.962l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.962 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.962l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192zM6.949 5.684a1 1 0 00-1.898 0l-.683 2.051a1 1 0 01-.633.633l-2.051.683a1 1 0 000 1.898l2.051.684a1 1 0 01.633.632l.683 2.051a1 1 0 001.898 0l.683-2.051a1 1 0 01.633-.633l2.051-.683a1 1 0 000-1.898l-2.051-.683a1 1 0 01-.633-.633L6.95 5.684zM13.949 13.684a1 1 0 00-1.898 0l-.184.551a1 1 0 01-.632.633l-.551.183a1 1 0 000 1.898l.551.183a1 1 0 01.633.633l.183.551a1 1 0 001.898 0l.184-.551a1 1 0 01.632-.633l.551-.183a1 1 0 000-1.898l-.551-.184a1 1 0 01-.633-.632l-.183-.551z"/>
                </svg>
              }
            />
          </div>
        )}
      </div>

      {/* ═══ Risk & Performance Monitor ═════════════════ */}
      <div className="analytics-section">
        <div className="analytics-section-header">
          <h2 className="analytics-section-title">
            <svg className="w-4 h-4 text-primary" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M1 2.75A.75.75 0 011.75 2h16.5a.75.75 0 010 1.5H18v8.75A2.75 2.75 0 0115.25 15h-1.072l.798 3.06a.75.75 0 01-1.452.38L12.753 15H7.247l-.77 3.44a.75.75 0 01-1.453-.38L5.823 15H4.75A2.75 2.75 0 012 12.25V3.5h-.25A.75.75 0 011 2.75zM7.5 5a.75.75 0 00-.75.75v4.5a.75.75 0 001.5 0v-4.5A.75.75 0 007.5 5zm3 2a.75.75 0 00-.75.75v2.5a.75.75 0 001.5 0v-2.5A.75.75 0 0010.5 7zm3-1a.75.75 0 00-.75.75v3.5a.75.75 0 001.5 0v-3.5A.75.75 0 0013.5 6z" clipRule="evenodd"/>
            </svg>
            Performance Monitor
          </h2>
        </div>

        {primaryMetrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Max Drawdown"
              value={`${primaryMetrics.maxDrawdown.toFixed(2)}%`}
              subValue="peak to trough"
              deltaColor="text-loss"
              icon={
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clipRule="evenodd"/>
                </svg>
              }
              sparkData={primaryMetrics.hourlyValues.slice(-24)}
              sparkColor="#FF453A"
            />
            <MetricCard
              label="Volatility"
              value={`${primaryMetrics.volatility.toFixed(1)}%`}
              subValue="annualized"
              icon={
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M3.105 2.289a.75.75 0 00-.826.95l1.414 4.925A1.5 1.5 0 005.135 9.25h6.115a.75.75 0 010 1.5H5.135a1.5 1.5 0 00-1.442 1.086l-1.414 4.926a.75.75 0 00.826.95 28.896 28.896 0 0015.293-7.154.75.75 0 000-1.115A28.897 28.897 0 003.105 2.289z"/>
                </svg>
              }
            />
            <MetricCard
              label="Best Period"
              value={formatPnl(primaryMetrics.maxHourlyGain)}
              subValue={`best ${metricsGranularity === 'hourly' ? 'hour' : 'day'}`}
              deltaColor="text-profit"
              icon={
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clipRule="evenodd"/>
                </svg>
              }
            />
            <MetricCard
              label="Worst Period"
              value={formatPnl(primaryMetrics.maxHourlyLoss)}
              subValue={`worst ${metricsGranularity === 'hourly' ? 'hour' : 'day'}`}
              deltaColor="text-loss"
              icon={
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clipRule="evenodd"/>
                </svg>
              }
            />
          </div>
        )}
      </div>

      {/* ═══ Strategy Comparison Cards ══════════════════ */}
      <div className="analytics-section">
        <div className="analytics-section-header">
          <h2 className="analytics-section-title">
            <svg className="w-4 h-4 text-primary" viewBox="0 0 20 20" fill="currentColor">
              <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 001.5 1.5h1a1.5 1.5 0 001.5-1.5v-13A1.5 1.5 0 0016.5 2h-1zM9.5 6A1.5 1.5 0 008 7.5v9A1.5 1.5 0 009.5 18h1a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0010.5 6h-1zM3.5 10A1.5 1.5 0 002 11.5v5A1.5 1.5 0 003.5 18h1A1.5 1.5 0 006 16.5v-5A1.5 1.5 0 004.5 10h-1z"/>
            </svg>
            Strategy Breakdown
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {strategies.map((strat, idx) => {
            const palette = getStrategyPalette(strat, idx);
            const metrics = allMetrics[strat];
            if (!metrics) return null;
            const isProfit = metrics.totalPnl >= 0;
            const isSelected = selectedStrategies.has(strat);
            const isAnySelected = selectedStrategies.size > 0;

            return (
              <div
                key={strat}
                onClick={() => toggleStrategy(strat)}
                className={`analytics-strategy-card cursor-pointer ${
                  isSelected ? 'analytics-strategy-card-active' : ''
                } ${isAnySelected && !isSelected ? 'opacity-40' : 'opacity-100'}`}
                style={{
                  '--card-accent': palette.main,
                  borderColor: isSelected ? palette.main : undefined,
                } as React.CSSProperties}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 truncate">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: palette.main }} />
                    <span className="text-sm font-bold text-foreground truncate">{strat}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`analytics-delta-badge text-[10px] ${isProfit ? 'analytics-delta-positive' : 'analytics-delta-negative'}`}>
                      {isProfit ? '↑' : '↓'} {formatPercent(Math.abs(metrics.returnPct))}
                    </span>
                  </div>
                </div>

                {/* Sparkline */}
                <div className="mb-4">
                  <Sparkline
                    data={metrics.hourlyValues.slice(-48)}
                    color={palette.main}
                    width={240}
                    height={40}
                  />
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-[11px]">
                  <div>
                    <span className="text-foreground-muted/50 block">Portfolio</span>
                    <span className="font-semibold font-mono text-foreground">{formatCurrency(metrics.currentValue)}</span>
                  </div>
                  <div>
                    <span className="text-foreground-muted/50 block">Total P&L</span>
                    <span className={`font-semibold font-mono ${isProfit ? 'text-profit' : 'text-loss'}`}>{formatPnl(metrics.totalPnl)}</span>
                  </div>
                  <div>
                    <span className="text-foreground-muted/50 block">Hourly Rate</span>
                    <span className={`font-semibold font-mono ${metrics.hourlyPnlRate >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {formatPnl(metrics.hourlyPnlRate)}/hr
                    </span>
                  </div>
                  <div>
                    <span className="text-foreground-muted/50 block">Win Rate</span>
                    <span className="font-semibold font-mono text-foreground">{metrics.hourlyWinRate.toFixed(1)}%</span>
                  </div>
                  <div>
                    <span className="text-foreground-muted/50 block">Sharpe</span>
                    <span className="font-semibold font-mono text-foreground">{metrics.hourlySharpe.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-foreground-muted/50 block">Max DD</span>
                    <span className="font-semibold font-mono text-loss">{metrics.maxDrawdown.toFixed(2)}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ P&L Waterfall ═════════════════════════════ */}
      <div className="analytics-section">
        <div className="analytics-section-header">
          <h2 className="analytics-section-title">
            <svg className="w-4 h-4 text-primary" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M1 4a1 1 0 011-1h16a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V4zm12 4a3 3 0 11-6 0 3 3 0 016 0zM4 9a1 1 0 100-2 1 1 0 000 2zm13-1a1 1 0 11-2 0 1 1 0 012 0zM1.75 14.5a.75.75 0 000 1.5c4.417 0 8.693.603 12.749 1.73 1.111.309 2.251-.512 2.251-1.696v-.784a.75.75 0 00-1.5 0v.784a.272.272 0 01-.35.25A49.043 49.043 0 001.75 14.5z" clipRule="evenodd"/>
            </svg>
            Net Profit Comparison
          </h2>
        </div>

        <div className="analytics-waterfall">
          {strategies
            .map((strat, idx) => ({ strat, idx, metrics: allMetrics[strat] }))
            .filter(s => s.metrics)
            .sort((a, b) => b.metrics!.totalPnl - a.metrics!.totalPnl)
            .map(({ strat, idx, metrics }) => {
              const palette = getStrategyPalette(strat, idx);
              const maxAbsPnl = Math.max(...Object.values(allMetrics).map(m => Math.abs(m.totalPnl)));
              const ratio = maxAbsPnl > 0 ? (Math.abs(metrics!.totalPnl) / maxAbsPnl) * 100 : 0;
              const isProfit = metrics!.totalPnl >= 0;

              return (
                <div key={strat} className="analytics-waterfall-row">
                  <div className="analytics-waterfall-label">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: palette.main }} />
                    <span className="truncate">{strat}</span>
                  </div>
                  <div className="analytics-waterfall-bar-container">
                    <div className="analytics-waterfall-center" />
                    <div
                      className="analytics-waterfall-bar"
                      style={{
                        backgroundColor: isProfit ? `${palette.main}cc` : 'rgba(255,69,58,0.5)',
                        width: `${Math.max(ratio / 2, 1)}%`,
                        [isProfit ? 'left' : 'right']: '50%',
                      }}
                    />
                    <span className={`analytics-waterfall-value ${isProfit ? 'text-profit' : 'text-loss'}`}>
                      {formatPnl(metrics!.totalPnl)}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

function PlatformTabs({
  platform,
  onSelect,
}: {
  platform: Platform;
  onSelect: (platform: Platform) => void;
}) {
  return (
    <div className="analytics-pill-group">
      {(['polymarket', 'kalshi'] as Platform[]).map((item) => (
        <button
          key={item}
          onClick={() => onSelect(item)}
          className={`analytics-pill ${platform === item ? 'analytics-pill-active' : ''}`}
        >
          {item === 'kalshi' ? 'Kalshi' : 'Polymarket'}
        </button>
      ))}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="mt-4 flex items-center justify-center gap-3 text-xs text-foreground-muted">
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="analytics-pill disabled:cursor-not-allowed disabled:opacity-40"
      >
        Prev
      </button>
      <span className="font-mono">
        Page {page} / {totalPages}
      </span>
      <button
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="analytics-pill disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
