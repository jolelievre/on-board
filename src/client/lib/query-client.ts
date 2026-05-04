import { QueryClient } from "@tanstack/react-query";

export const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      // Disable framework GC entirely. Offline retention is handled by
      // persistQueryClient's `maxAge` (NINETY_DAYS) on disk; we don't want
      // in-memory eviction at all.
      //
      // Why not gcTime: NINETY_DAYS? `setTimeout` is capped at ~24.8 days
      // (2^31-1 ms); larger values overflow and fire IMMEDIATELY in many
      // browsers, which causes unobserved queries (anything created via
      // `prefetchQuery`) to be removed microseconds after they succeed —
      // *before* the user navigates to the page that would consume them.
      // `Infinity` is TanStack Query v5's explicit "never GC" sentinel.
      gcTime: Infinity,
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
