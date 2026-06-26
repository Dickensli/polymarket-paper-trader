import AnalyticsClient from './AnalyticsClient';

export const metadata = {
  title: 'Strategy Analytics - PolyTrader',
  description: 'Professional portfolio analytics with hourly rate metrics, performance monitoring, and strategy comparison.',
};

export default function AnalyticsPage() {
  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8 w-full">
      <AnalyticsClient />
    </div>
  );
}
