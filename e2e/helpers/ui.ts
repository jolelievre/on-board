import { expect, type Page } from "@playwright/test";

/**
 * Navigate to a profile detail page AND open its editor (clicks the
 * pencil and waits for the editor surface to mount). Every alias /
 * link / unlink / merge / QR control lives behind the editor now, so
 * tests that touched any of them used to call `page.goto(/players/...)`
 * directly — they all need this helper instead.
 *
 * Pass `enterEditor: false` to skip the pencil click (used by tests
 * that just verify the read-only profile view).
 */
export async function openProfile(
  page: Page,
  profileId: string,
  { enterEditor = true }: { enterEditor?: boolean } = {},
): Promise<void> {
  await page.goto(`/players/${profileId}`);
  await page.waitForLoadState("domcontentloaded");
  if (!enterEditor) return;
  const pencil = page.locator("[data-testid='profile-edit-avatar']");
  await expect(pencil).toBeVisible({ timeout: 10_000 });
  await pencil.click();
  await expect(page.locator("[data-testid='profile-editor']")).toBeVisible({
    timeout: 5_000,
  });
}
