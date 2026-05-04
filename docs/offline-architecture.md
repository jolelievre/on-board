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

Cache restoration runs **synchronously at module load** in `main.tsx`, before `createRoot().render()`. We deliberately don't use `PersistQueryClientProvider`: it restores via a `useEffect`, one async tick after the first render, which leaves a window where queries fire against an empty cache and — offline — get stuck `pending+paused`. The synchronous path means every `useQuery` subscriber finds its data on the very first render. Ongoing writes are handled by `persistQueryClientSubscribe`, which writes the dehydrated cache to `localStorage` on every cache event.

### `gcTime: Infinity` (don't change without reading this)

The QueryClient uses `gcTime: Infinity`. This is **not optional** for offline-first behavior. `setTimeout` is capped at ~24.8 days (`2^31-1` ms); any larger value overflows and fires immediately in most browsers, which causes any query without a permanent observer — in particular every entry created via `prefetchQuery` — to be garbage-collected microseconds after it succeeds. That breaks `usePrefetchGames` entirely: detail/matches queries are evicted before the user clicks into them.

`Infinity` is TanStack Query v5's explicit "never GC" sentinel. Disk-side retention is bounded by a manual `NINETY_DAYS` timestamp check in `main.tsx` on startup (`Date.now() - stored.timestamp > NINETY_DAYS`), unaffected by the `setTimeout` cap.

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
| View any game's detail page | ✅ After first online session | `usePrefetchGames` prefetches each game's detail and matches list on every authenticated session |
| View match history | ✅ After first online session | `usePrefetchGames` prefetches per-game `["matches", { gameId }]` on every authenticated session |
| View a match page | ✅ If visited at least once | TanStack Query persistence |
| Score a round | ✅ Queued + shown as "offline" | `syncEngine.enqueue`, replayed on reconnect |
| Complete a match | ✅ Queued + optimistic | Queue + immediate `setQueryData` |
| Player name autocomplete | ✅ From Dexie `localProfiles` | Populated from server on each online fetch |
| Create a brand-new match | ❌ Not yet implemented | Needs `matchDrafts` flow (planned Phase 6) |
| First-ever app open offline | ❌ Impossible in practice | Google OAuth requires network; prefetch runs on first authenticated session |

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
| `src/client/lib/query-client.ts` | TanStack Query with `gcTime: Infinity` (see hydration-timing section) |
| `src/client/main.tsx` | Synchronous hydrate + `persistQueryClientSubscribe` for ongoing writes |
| `src/client/components/layout/OfflineBanner.tsx` | UI indicator for offline state |

---

## Online → Offline

When the `offline` window event fires (or `navigator.onLine` becomes false):

```mermaid
flowchart TD
    A["window 'offline' event"] --> B["useOnlineStatus: isOnline = false"]
    B --> C["OfflineBanner renders (auto-dismisses after 5s)\nHeader SyncPill stays as the persistent indicator"]
    B --> D["TanStack Query fires background refetches once\n(networkMode: 'offlineFirst'), then pauses retries"]
    B --> E["Cached queries stay 'success' — data still visible\nUncached queries land in pending+paused (UI shows offlineNoCache)"]

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
    I -- "2xx" --> J["Delete entry from queue"]
    I -- "network error (catch)" --> K["Stop flush\npreserve remaining queue\nwait for next reconnect"]
    I -- "401 / 403" --> N["Mark entry as permanent error\n(no retry — auth won't fix itself)"]
    I -- "other non-OK" --> L{"retries < 3?"}
    L -- yes --> M["Increment retries\nretry on next reconnect"]
    L -- no --> N

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
| `gcTime` | `Infinity` | In-memory eviction is fully disabled — see the "`gcTime: Infinity`" section above for why this is mandatory, not a tuning choice |
| `NINETY_DAYS` (manual check in `main.tsx`) | 90 days | How long the entire localStorage snapshot is valid; if older, it is discarded on startup |
| `networkMode` | `offlineFirst` | The queryFn always fires once (even offline); retries are then paused (`isPaused: true`) until connectivity returns. Queries with cached data stay `'success'` and render normally. Queries with no cached data land in `pending+paused`; the UI detects this via `isPaused` and shows the offline-no-cache message instead of an infinite spinner. |

> Online detection uses the browser's native `navigator.onLine` and the `online`/`offline` window events. This works reliably under both real network changes (WiFi off/on, airplane mode) and Chrome DevTools' "Offline" Network throttle (which is also what Playwright's `BrowserContext.setOffline(true)` uses under the hood, so the E2E suite exercises the same code path).

**Rule of thumb:** `staleTime` governs online freshness. The startup `NINETY_DAYS` check governs offline resilience. They are completely independent (and `gcTime` is out of the picture entirely — see above).

---

## Cache invalidation rules

The cache is **never** evicted due to a failed network request. The only ways it changes are:

1. **Background refetch succeeds** → fresh data replaces old data (normal online operation)
2. **`syncEngine.flush()` has at least one success** → `queryClient.invalidateQueries()` is called, triggering refetches of active queries (only after confirmed server writes)
3. **`NINETY_DAYS` check fails on startup** → entire localStorage snapshot discarded (90 days since last session)
4. **Explicit sign-out** → session cache cleared; query cache is NOT cleared (data remains for the next login)

**Key invariant:** a brief online blip (1-second connection, failed refetch) cannot empty the cache.

---

## Offline UX

- `OfflineBanner` (`src/client/components/layout/OfflineBanner.tsx`) renders an amber strip across the top of every authenticated page when `useOnlineStatus()` reports offline. It auto-dismisses after 5 seconds so it doesn't permanently steal vertical space.
- After dismissal, the persistent indicator is the small `SyncPill` that the global `Header` auto-renders whenever offline (the match page keeps its own SyncPill via the existing `right` slot).
- Game-detail (`/games/$slug`) and match (`/matches/$id`) pages both distinguish a real 404 from an offline cache miss. When offline with no cached data (`isPaused: true`), they show `common.offlineNoCache` ("This page wasn't saved for offline use…") instead of an indefinite spinner.
