import { QueryClient } from "@tanstack/react-query";

export const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      // Keep cached data for 90 days so offline reads survive multi-week gaps.
      gcTime: NINETY_DAYS,
      retry: 1,
      // 'offlineFirst' avoids the default 'online' mode's "paused forever"
      // trap: with no cached data while offline, default mode keeps a
      // query in pending state with no resolution. offlineFirst serves
      // cached data instantly and lets uncached fetches settle to error,
      // so the UI can render its offline-no-cache fallback.
      networkMode: "offlineFirst",
    },
  },
});
