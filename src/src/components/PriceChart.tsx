'use client';

import { useEffect, useRef, useState } from 'react';

interface PricePoint {
  t: number; // Unix timestamp
  p: number; // Price 0-1
}

interface PriceChartProps {
  conditionId: string;
  height?: number;
}

export default function PriceChart({ conditionId, height = 300 }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasData, setHasData] = useState(true);

  useEffect(() => {
    if (!containerRef.current || !conditionId) return;

    let mounted = true;

    async function initChart() {
      try {
        // Dynamically import lightweight-charts (client-side only)
        const { createChart, ColorType, LineStyle, AreaSeries } = await import('lightweight-charts');

        if (!mounted || !containerRef.current) return;

        // Fetch price history from Polymarket CLOB API
        const res = await fetch(
          `https://clob.polymarket.com/prices-history?market=${conditionId}&interval=all&fidelity=60`
        );

        if (!res.ok) {
          setError('Failed to load price history');
          setIsLoading(false);
          return;
        }

        const raw: { t: number; p: number }[] = await res.json();

        if (!raw || raw.length === 0) {
          setHasData(false);
          setIsLoading(false);
          return;
        }

        // Clear any existing chart
        if (chartRef.current) {
          chartRef.current.remove();
        }

        const chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height,
          layout: {
            background: { type: ColorType.Solid, color: 'transparent' },
            textColor: '#94a3b8',
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: 11,
          },
          grid: {
            vertLines: { color: 'rgba(255, 255, 255, 0.03)', style: LineStyle.Dotted },
            horzLines: { color: 'rgba(255, 255, 255, 0.03)', style: LineStyle.Dotted },
          },
          crosshair: {
            vertLine: { color: 'rgba(59, 130, 246, 0.3)', width: 1, style: LineStyle.Dashed },
            horzLine: { color: 'rgba(59, 130, 246, 0.3)', width: 1, style: LineStyle.Dashed },
          },
          rightPriceScale: {
            borderColor: 'rgba(255, 255, 255, 0.06)',
          },
          timeScale: {
            borderColor: 'rgba(255, 255, 255, 0.06)',
            timeVisible: true,
            secondsVisible: false,
          },
          handleScroll: { mouseWheel: true, pressedMouseMove: true },
          handleScale: { mouseWheel: true, pinch: true },
        });

        chartRef.current = chart;

        // Create area series with gradient
        const series = chart.addSeries(AreaSeries, {
          lineColor: '#3b82f6',
          topColor: 'rgba(59, 130, 246, 0.28)',
          bottomColor: 'rgba(59, 130, 246, 0.02)',
          lineWidth: 2,
          priceFormat: {
            type: 'custom',
            formatter: (price: number) => `${(price * 100).toFixed(1)}%`,
          },
        });

        seriesRef.current = series;

        // Convert data: sort by time, deduplicate
        const seen = new Set<number>();
        const data = raw
          .map((d) => ({
            time: d.t as any, // Unix timestamp
            value: d.p,
          }))
          .filter((d) => {
            if (seen.has(d.time)) return false;
            seen.add(d.time);
            return true;
          })
          .sort((a, b) => a.time - b.time);

        series.setData(data);
        chart.timeScale().fitContent();

        setIsLoading(false);

        // Handle resize
        const resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            chart.applyOptions({ width: entry.contentRect.width });
          }
        });
        resizeObserver.observe(containerRef.current);

        return () => {
          resizeObserver.disconnect();
          chart.remove();
        };
      } catch (err) {
        if (mounted) {
          setError('Chart initialization failed');
          setIsLoading(false);
        }
      }
    }

    initChart();

    return () => {
      mounted = false;
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [conditionId, height]);

  if (error) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.02]"
        style={{ height }}
      >
        <p className="text-sm text-foreground-muted">{error}</p>
      </div>
    );
  }

  if (!hasData && !isLoading) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.02]"
        style={{ height }}
      >
        <p className="text-sm text-foreground-muted">No price history available</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {isLoading && (
        <div
          className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/[0.02] z-10"
          style={{ height }}
        >
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
      <div
        ref={containerRef}
        className="rounded-xl overflow-hidden"
        style={{ height }}
      />
    </div>
  );
}
