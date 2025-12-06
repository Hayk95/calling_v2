'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth-api';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // Check authentication on route change
    if (pathname !== '/login') {
      if (!isAuthenticated()) {
        router.push('/login');
      }
    } else {
      // If on login page and already authenticated, redirect to home
      if (isAuthenticated()) {
        router.push('/');
      }
    }
  }, [pathname, router]);

  return <>{children}</>;
}

