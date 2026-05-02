import { QueryClient } from "@tanstack/react-query";

export const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      // Keep cached data for 90 days so offline reads survive multi-week gaps.
      gcTime: NINETY_DAYS,
      retry: 1,
      // 'offlineFirst': queryFn fires once regardless of network, then
      // retries are paused (fetchStatus: 'paused', isPaused: true) until
      // connectivity returns. Queries with cached data stay 'success' and
      // render immediately; uncached queries land in pending+paused, which
      // the UI detects via isPaused to show the offline-no-cache message
      // instead of a permanent loading spinner.
      networkMode: "offlineFirst",
    },
  },
});
