import { syncEngine } from "../../lib/sync";
import { SyncPill } from "../ui/SyncPill";

/**
 * Global sync indicator. Reads `syncEngine.useStatus()` directly — no
 * per-page plumbing. Renders nothing when idle so it stays out of the
 * way; appears in the top-right while writes are in flight, briefly
 * shows "saved" after the queue drains, and persists "offline" while
 * the network is down.
 */
export function SyncStatus() {
  const status = syncEngine.useStatus();
  if (status === "idle") return null;

  return (
    <div
      data-testid="sync-status"
      data-status={status}
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + 8px)",
        right: 12,
        zIndex: 50,
        pointerEvents: "none",
      }}
    >
      <SyncPill state={status} />
    </div>
  );
}
