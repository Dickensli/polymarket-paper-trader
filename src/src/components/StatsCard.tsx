'use client';

interface StatsCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: React.ReactNode;
}

export default function StatsCard({ label, value, subValue, trend, icon }: StatsCardProps) {
  const trendColor =
    trend === 'up'
      ? 'text-profit-light'
      : trend === 'down'
        ? 'text-loss-light'
        : 'text-foreground-muted';

  return (
    <div className="glass-card p-5 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
          {label}
        </span>
        {icon && <span className="text-foreground-muted">{icon}</span>}
      </div>
      <span className="text-2xl font-bold text-foreground tracking-tight">{value}</span>
      {subValue && (
        <span className={`text-sm font-medium ${trendColor}`}>{subValue}</span>
      )}
    </div>
  );
}
