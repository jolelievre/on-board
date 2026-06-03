/** Wire shape returned by validation 4xxs on `/api/{profiles,matches,scores}`.
 *
 * Shared with the client so the sync engine can decode the body
 * verbatim into `SyncQueueEntry.error` and the Settings Sync panel
 * can render a structured message instead of "HTTP 400".
 *
 * Phase 8-E.
 */
export type SyncErrorBody = {
  /** Human-readable, English (server-side validation is operator-facing).
   * The client renders the localized panel chrome around this string. */
  error: string;
  /** Body field name that triggered the failure, when applicable.
   * Lets the panel point the user at the right input. Optional —
   * many validations cover the whole payload shape, not one field. */
  field?: string;
  /** Operator hint: what the user / developer can do about it. Free-form,
   * short. Renders below `error` in the panel. */
  hint?: string;
};
