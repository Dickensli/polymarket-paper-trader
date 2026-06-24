import AnalyticsClient from './AnalyticsClient';

export const metadata = {
  title: 'Strategy Analytics - PolyTrader',
};

export default function AnalyticsPage() {
  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full">
      <AnalyticsClient />
    </div>
  );
}
