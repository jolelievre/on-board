import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
});

/**
 * Update profile fields stored on the User row.
 *
 * Wraps `authClient.updateUser` to keep types of our additional fields
 * (locale, theme) in one place — better-auth's client doesn't infer
 * server-side `additionalFields` without a custom plugin.
 */
type ProfileUpdate = { locale?: string; theme?: string };

export function updateProfile(fields: ProfileUpdate) {
  type UpdateArgs = Parameters<typeof authClient.updateUser>[0];
  return authClient.updateUser(fields as UpdateArgs);
}
