import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import ClientShell from './ClientShell';
import QueryProvider from '@/lib/query-provider';
import AuthProvider from '@/lib/auth-provider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'PolyTrader — Paper Trading for Prediction Markets',
  description:
    'Practice trading on Polymarket prediction markets with virtual money. Zero risk, real market data.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground font-sans">
        <QueryProvider>
          <AuthProvider>
            <ClientShell>{children}</ClientShell>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
