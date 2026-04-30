import { QueryClient } from "@tanstack/react-query";

export const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      // Keep cached data for 90 days so offline reads survive multi-week gaps.
      // Inactive queries (no active subscriber) are GC'd after this window.
      gcTime: NINETY_DAYS,
      retry: 1,
    },
  },
});
