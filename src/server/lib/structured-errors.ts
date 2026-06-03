import type { Context } from "hono";
import type { SyncErrorBody } from "../../shared/sync-errors.js";

/** 4xx status codes that can carry a structured `SyncErrorBody`.
 * Narrower than Hono's `StatusCode` so callers can't accidentally
 * return 5xx through this helper. */
type StructuredErrorStatus = 400 | 403 | 404 | 409 | 413 | 422;

/** Return a `SyncErrorBody`-shaped 4xx from a Hono handler.
 *
 * Phase 8-E shipped the structured shape so the client's sync queue
 * can persist `{ error, field?, hint? }` verbatim and surface it in
 * the Settings → Sync panel. Without this helper every callsite would
 * have to remember the shape and the field names.
 */
export function structuredError(
  c: Context,
  status: StructuredErrorStatus,
  body: SyncErrorBody,
) {
  return c.json(body, status);
}
