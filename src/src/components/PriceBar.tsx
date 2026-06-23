'use client';

import { formatProbability } from '@/lib/utils';

interface PriceBarProps {
  yesPrice: number;
  noPrice: number;
  showLabels?: boolean;
  height?: 'sm' | 'md' | 'lg';
}

export default function PriceBar({
  yesPrice,
  noPrice,
  showLabels = true,
  height = 'md',
}: PriceBarProps) {
  const yesPct = yesPrice * 100;
  const noPct = noPrice * 100;
  const yesDisplay = formatProbability(yesPrice);
  const noDisplay = formatProbability(noPrice);
  const barH = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-4' };

  return (
    <div className="w-full">
      {showLabels && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-profit-light flex items-center gap-1">
            YES
            <span className="text-profit font-bold">{yesDisplay}¢</span>
          </span>
          <span className="text-xs font-semibold text-loss-light flex items-center gap-1">
            <span className="text-loss font-bold">{noDisplay}¢</span>
            NO
          </span>
        </div>
      )}
      <div
        className={`relative w-full ${barH[height]} rounded-full overflow-hidden bg-white/[0.06]`}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${yesPct}%`,
            background: 'linear-gradient(90deg, #10b981, #34d399)',
          }}
        />
        <div
          className="absolute inset-y-0 right-0 rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${noPct}%`,
            background: 'linear-gradient(90deg, #fb7185, #f43f5e)',
          }}
        />
      </div>
    </div>
  );
}
