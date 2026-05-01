import { QueryClient, onlineManager } from "@tanstack/react-query";

export const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      // Keep cached data for 90 days so offline reads survive multi-week gaps.
      // Inactive queries (no active subscriber) are GC'd after this window.
      gcTime: NINETY_DAYS,
      // When offline, don't burn time on retry/backoff — settle immediately
      // so the UI can render its offline-no-cache fallback. When online,
      // retry once (the previous behaviour).
      retry: (failureCount) => onlineManager.isOnline() && failureCount < 1,
      retryDelay: 0,
      // 'offlineFirst' is the difference between an app that works offline
      // and one that hangs on a spinner. With the default 'online':
      //   - if a query has cached data → returns it (good)
      //   - if it has NO cached data → query is paused indefinitely while
      //     offline, isPending stays true forever, the page sits on a
      //     loading message that never resolves
      // With 'offlineFirst':
      //   - cached data is returned instantly
      //   - the background refetch still runs, but if it fails (offline),
      //     the cache is preserved (TanStack never evicts on a failed
      //     refetch) and the query settles to an error state instead of
      //     hanging forever — letting the UI render its offline-no-cache
      //     fallback
      networkMode: "offlineFirst",
    },
  },
});
