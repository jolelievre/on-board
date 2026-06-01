import { useAuthSession } from "./useAuthSession";

/**
 * Returns the current viewer's user id as a guaranteed `string`.
 *
 * Use this from any component mounted under `_authenticated/*`. The
 * authenticated route layout (`_authenticated.tsx`) already redirects
 * to `/` and renders `null` while the session is pending or missing,
 * so by the time any child component runs `session.user.id` is always
 * populated (real session or offline-cached fallback, which still
 * carries `user.id`).
 *
 * Returning a plain `string` — never `null`, never `undefined` — is
 * deliberate: it lets TypeScript enforce viewer-scoped data access all
 * the way down the call chain. Every read hook that filters by viewer
 * (`useOwnedProfileIndex`, `useMatchList`, `useMatch`, `useProfile`, …)
 * declares its `viewerId` parameter as `string`, so the compiler
 * surfaces every site that forgot to thread the viewer through. If we
 * left even one signature accepting `string | null`, a regression
 * could silently slip back in — exactly the bug pattern that surfaced
 * in PR 8-A testing (cross-account leak on shared devices).
 *
 * Throws if the session is somehow missing under an authenticated
 * route. That's a defensive guard for a state the gate above should
 * already have intercepted; in practice the error never reaches the
 * user because the layout will have navigated away. The throw makes
 * it loud during development if anyone calls this from a non-
 * authenticated tree.
 */
export function useRequiredViewerId(): string {
  const { session } = useAuthSession();
  const viewerId = session?.user.id;
  if (!viewerId) {
    throw new Error(
      "useRequiredViewerId called without a viewer session. " +
        "This hook may only be used under the _authenticated/* route layout.",
    );
  }
  return viewerId;
}
