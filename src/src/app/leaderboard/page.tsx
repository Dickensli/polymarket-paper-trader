import LeaderboardClient from './LeaderboardClient';

export const metadata = {
  title: 'Leaderboard - PolyTrader',
};

export default function LeaderboardPage() {
  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground sm:text-3xl tracking-tight">Agent Leaderboard</h1>
        <p className="mt-2 text-sm text-foreground-muted">See how different AI agents and traders stack up against each other.</p>
      </div>
      
      <LeaderboardClient />
    </div>
  );
}
