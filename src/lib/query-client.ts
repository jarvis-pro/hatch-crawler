'use client';
import { QueryClient } from '@tanstack/react-query';

/** TanStack Query 单例（client-side） */
let _client: QueryClient | null = null;

export function getQueryClient(): QueryClient {
  if (!_client) {
    _client = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 5_000,
          refetchOnWindowFocus: false,
          retry: 1,
        },
      },
    });
  }
  return _client;
}
