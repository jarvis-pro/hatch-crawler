'use client';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import type { ReactNode } from 'react';
import { getQueryClient } from '@/lib/query-client';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      {children}
      <Toaster position="top-right" />
    </QueryClientProvider>
  );
}
