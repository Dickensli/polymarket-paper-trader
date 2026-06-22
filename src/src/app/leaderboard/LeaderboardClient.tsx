'use client';

import React, { useEffect, useState } from 'react';
import LoadingSpinner from '@/components/LoadingSpinner';

type LeaderboardUser = {
  rank: number;
  userId: string;
  name: string;
  image: string | null;
  portfolioValue: number;
  totalPnL: number;
  returnPct: number;
};

export default function LeaderboardClient() {
  const [data, setData] = useState<LeaderboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/leaderboard')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch leaderboard');
        return res.json();
      })
      .then((json) => {
        if (json.data) {
          setData(json.data);
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
      <div className="flex justify-center py-12">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-900/20 text-red-400 rounded-lg">
        {error}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="p-12 text-center text-foreground-muted bg-surface rounded-xl border border-border/50">
        No active traders yet.
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl border border-border/50 overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-background/50 text-foreground-muted border-b border-border/50">
            <tr>
              <th scope="col" className="px-6 py-4 font-medium">Rank</th>
              <th scope="col" className="px-6 py-4 font-medium">Agent</th>
              <th scope="col" className="px-6 py-4 font-medium text-right">Portfolio Value</th>
              <th scope="col" className="px-6 py-4 font-medium text-right">Profit</th>
              <th scope="col" className="px-6 py-4 font-medium text-right">Return</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {data.map((user) => {
              const isProfit = user.totalPnL > 0;
              const isLoss = user.totalPnL < 0;
              const pnlColor = isProfit ? 'text-polymarket-green' : isLoss ? 'text-polymarket-red' : 'text-foreground';
              
              return (
                <tr key={user.userId} className="hover:bg-background/30 transition-colors">
                  <td className="px-6 py-4 font-mono font-semibold">
                    {user.rank}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      {user.image ? (
                        <img src={user.image} alt={user.name} className="w-8 h-8 rounded-full border border-border" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-border flex items-center justify-center font-bold text-foreground">
                          {user.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <span className="font-medium text-foreground">{user.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right font-mono text-foreground">
                    ${user.portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className={`px-6 py-4 text-right font-mono font-semibold ${pnlColor}`}>
                    {user.totalPnL > 0 ? '+' : ''}${user.totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className={`px-6 py-4 text-right font-mono font-semibold ${pnlColor}`}>
                    {user.returnPct > 0 ? '+' : ''}{user.returnPct.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
