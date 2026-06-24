'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import TopBar from '@/components/TopBar';
import LoadingSpinner from '@/components/LoadingSpinner';

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isPublicRoute = pathname?.startsWith('/auth/') || pathname === '/privacy';

  useEffect(() => {
    if (status === 'unauthenticated' && !isPublicRoute) {
      router.push('/auth/signin');
    }
  }, [status, isPublicRoute, router]);

  // If on public routes (like signin page or privacy page), render children directly without the shell layout
  if (isPublicRoute) {
    return <>{children}</>;
  }

  // Show a full-screen loading state while checking authentication session or before client-side hydration completes
  if (!mounted || status === 'loading') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0a0b0f]">
        <div className="flex flex-col items-center gap-4">
          <LoadingSpinner size="lg" />
          <p className="text-sm font-medium text-foreground-muted animate-pulse">
            Loading PolyTrader...
          </p>
        </div>
      </div>
    );
  }

  // Only render the shell and page content if successfully authenticated
  if (status === 'authenticated') {
    return (
      <div className="flex h-screen overflow-hidden">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar onMenuClick={() => setSidebarOpen(true)} />
          <main className="flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    );
  }

  // Fallback to empty during redirect to sign-in page
  return null;
}


