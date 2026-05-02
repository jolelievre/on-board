# Offline Architecture

How the app stays usable without a network connection and how it recovers when connectivity returns.

---

## The three layers

The offline system is built from three independent layers stacked on top of each other. Each layer has a distinct responsibility.

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1 — App Shell (Service Worker / Workbox)         │
│  Precaches HTML + JS + CSS + fonts + icons at install.  │
│  The app can always LOAD, even with zero network.        │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│  Layer 2 — Read Cache (TanStack Query → localStorage)   │
│  Persists every API response for 90 days.               │
│  Previously-fetched screens are READABLE offline.       │
└─────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────┐
│  Layer 3 — Write Queue (Dexie / IndexedDB)              │
│  Mutations made offline are enqueued and replayed on    │
│  reconnect. WRITES work offline, synced on reconnect.   │
└─────────────────────────────────────────────────────────┘
```

Session caching sits alongside these layers — the user's auth session is written to `localStorage` on every successful login and used as a fallback when the session API is unreachable.

### Layer 2 hydration timing

`localStorage` is read **synchronously** in `main.tsx` (via `hydrate(queryClient, …)`) before `createRoot().render()` runs. We deliberately don't use `PersistQueryClientProvider`, whose hydration happens inside a `useEffect` and would cause the very first render of every route to observe an empty cache. With `networkMode: 'offlineFirst'`, that empty observer would fire its `queryFn`, fail offline, and leave the page stuck on its loading state — even though the data was sitting in `localStorage`. Synchronous hydration closes that race so any `useQuery` finds its cached data on the first render. Ongoing writes are subscribed via `persistQueryClientSubscribe`.

---

## Storage locations

| What | Storage | Key / DB | Duration |
|---|---|---|---|
| App shell (HTML/JS/CSS/fonts) | Service Worker Cache | Managed by Workbox | Until next deploy |
| All API responses | `localStorage` | `onboard_query_cache` | 90 days |
| Auth session | `localStorage` | `onboard_session_cache` | Until sign-out |
| Offline mutation queue | IndexedDB (Dexie `syncQueue`) | — | Until flushed |
| Player name suggestions | IndexedDB (Dexie `localProfiles`) | — | Permanent |

---

## What works offline

| Feature | Offline? | Why |
|---|---|---|
| App shell loads | ✅ Always | Workbox precache |
| Stay authenticated | ✅ If previously logged in | `useAuthSession` localStorage fallback |
| View game list | ✅ After first online session | TanStack Query persistence |
| View any game's detail page | ✅ After first online session | `usePrefetchGames` prefetches each game's detail and matches list on login |
| View match history | ✅ After first online session | `usePrefetchGames` prefetches per-game `["matches", { gameId }]` |
| View a match page | ✅ If visited at least once | TanStack Query persistence |
| Score a round | ✅ Queued + shown as "offline" | `syncEngine.enqueue`, replayed on reconnect |
| Complete a match | ✅ Queued + optimistic | Queue + immediate `setQueryData` |
| Player name autocomplete | ✅ From Dexie `localProfiles` | Populated from server on each online fetch |
| Create a brand-new match | ❌ Not yet implemented | Needs `matchDrafts` flow (planned Phase 6) |
| First-ever app open offline | ❌ Impossible in practice | Google OAuth requires network; prefetch runs on login |

---

## Key files

| File | Responsibility |
|---|---|
| `src/client/hooks/useAuthSession.ts` | Offline-safe session wrapper |
| `src/client/hooks/useOnlineStatus.ts` | Detects online/offline, triggers sync on reconnect |
| `src/client/hooks/usePrefetchGames.ts` | Warms the game-detail cache on every authenticated session |
| `src/client/hooks/usePlayerSuggestions.ts` | Syncs player suggestions to Dexie |
| `src/client/lib/db.ts` | Dexie schema (`localProfiles`, `syncQueue`, `matchDrafts`) |
| `src/client/lib/sync.ts` | `syncEngine.enqueue()` and `syncEngine.flush()` |
| `src/client/lib/query-client.ts` | TanStack Query with 90-day `gcTime` |
| `src/client/main.tsx` | Synchronous cache hydration at boot + `persistQueryClientSubscribe` for ongoing writes |
| `src/client/components/layout/OfflineBanner.tsx` | UI indicator for offline state |

---

## Online → Offline

When the `offline` window event fires (or `navigator.onLine` becomes false):

```mermaid
flowchart TD
    A["window 'offline' event"] --> B["useOnlineStatus: isOnline = false"]
    B --> C["OfflineBanner renders (auto-dismisses after 5s)\nHeader SyncPill stays as the persistent indicator"]
    B --> D["TanStack Query attempts background refetches\nbut they fail fast (networkMode: 'offlineFirst')"]
    B --> E["Existing cache untouched\n(failed refetches never evict)"]

    F["User scores a round / completes match"] --> G{"navigator.onLine?"}
    G -- online --> H["fetch() to server"]
    H -- success --> I["SaveStatus = saved"]
    H -- "network error\n(not ApiError)" --> J
    G -- offline --> J["syncEngine.enqueue(method, url, body)"]
    J --> K["Dexie syncQueue entry created"]
    K --> L["SaveStatus = offline\n(SyncPill shows wifi-off)"]
    K --> M["For match completion:\noptimistic setQueryData applied immediately"]
```

---

## Offline → Online

When the `online` window event fires:

```mermaid
flowchart TD
    A["window 'online' event"] --> B["useOnlineStatus: isOnline = true"]
    B --> C["OfflineBanner disappears"]
    B --> D["syncEngine.flush()"]

    D --> E["Read Dexie syncQueue\nordered by createdAt"]
    E --> F{"Queue empty?"}
    F -- yes --> G["No-op"]
    F -- no --> H["Replay entries in order\nfetch(method, url, body)"]

    H --> I{"Request result?"}
    I -- "200 OK" --> J["Delete entry from queue"]
    I -- "network error" --> K["Stop flush\npreserve remaining queue\nwait for next reconnect"]
    I -- "4xx / 5xx" --> L{"retries < 3?"}
    L -- yes --> M["Increment retries\nretry later"]
    L -- no --> N["Mark entry as permanent error"]

    J --> O{"Any success?"}
    O -- yes --> P["queryClient.invalidateQueries()\nrefetch active queries"]
    O -- no --> Q["Cache unchanged"]

    B --> R["TanStack Query refetchOnReconnect: true\nstale queries refetch in background"]
    R --> S{"Refetch succeeds?"}
    S -- yes --> T["Cache updated with fresh data"]
    S -- no --> U["Old cached data preserved\nno eviction on failure"]
```

---

## staleTime vs gcTime — what each one does

These two settings are independent and easy to confuse:

| Setting | Value | Controls |
|---|---|---|
| `staleTime` (global) | 60 s | When online: after 60 s, a query is considered stale and will refetch in the background on next mount/focus |
| `staleTime` (prefetchQuery) | 1 h | Optimization: don't re-prefetch game details if already fetched within the last hour |
| `gcTime` | 90 days | When a query has no active subscribers, how long before its data is removed from cache |
| `maxAge` (persistQueryClient) | 90 days | How long the entire localStorage snapshot is valid; if older, it is discarded on startup |
| `networkMode` | `offlineFirst` | Cached queries always serve their data first; refetches happen but failed offline refetches never evict the cache and never leave the query stuck in a permanent pending state |

> Online detection uses the browser's native `navigator.onLine` and the `online`/`offline` window events. This is reliable for actual network changes (WiFi off/on, airplane mode); Chrome DevTools' "Offline" throttle is less consistent at firing those events on a hard refresh, so the in-app offline UI may lag in that mode. The real use case (lost connectivity in the field) is what the system is built for.

**Rule of thumb:** `staleTime` governs online freshness. `gcTime` / `maxAge` govern offline resilience. They are completely independent.

---

## Cache invalidation rules

The cache is **never** evicted due to a failed network request. The only ways it changes are:

1. **Background refetch succeeds** → fresh data replaces old data (normal online operation)
2. **`syncEngine.flush()` has at least one success** → `queryClient.invalidateQueries()` is called, triggering refetches of active queries (only after confirmed server writes)
3. **`gcTime` expires for an inactive query** → entry removed from cache (90 days of inactivity)
4. **`maxAge` exceeded on startup** → entire localStorage snapshot discarded (90 days since last session)
5. **Explicit sign-out** → session cache cleared; query cache is NOT cleared (data remains for the next login)

**Key invariant:** a brief online blip (1-second connection, failed refetch) cannot empty the cache.

---

## Offline UX

- `OfflineBanner` (`src/client/components/layout/OfflineBanner.tsx`) renders an amber strip across the top of every authenticated page when `useOnlineStatus()` reports offline. It auto-dismisses after 5 seconds so it doesn't permanently steal vertical space.
- After dismissal, the persistent indicator is the small `SyncPill` that the global `Header` auto-renders whenever offline (the match page keeps its own SyncPill via the existing `right` slot).
- Game-detail (`/games/$slug`) distinguishes a real 404 from an offline cache miss and shows `common.offlineNoCache` ("This page wasn't saved for offline use…") instead of "Game not found", so an unprefetched game gives an honest message rather than an indefinite spinner.
