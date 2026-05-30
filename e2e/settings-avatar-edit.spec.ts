import { test, expect } from "@playwright/test";
import { login } from "./helpers/auth";

/**
 * Settings → avatar edit. Phase 6-E added the pencil affordance on the
 * Settings hero so the viewer can edit their own self-Profile photo
 * without going through the Players tab (which deliberately excludes
 * the self-Profile from its listing). The same `EditableAvatar`
 * component drives both surfaces, so the existing detail-page testids
 * (`profile-edit-avatar`, `avatar-uploader`) keep working here.
 */
test.describe("Settings — avatar edit", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("pencil button reveals the uploader and Done closes it", async ({
    page,
  }) => {
    await login(page);

    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");

    // Default state: uploader hidden, pencil button visible.
    await expect(
      page.locator("[data-testid='avatar-uploader']"),
    ).toHaveCount(0);
    const pencil = page.locator("[data-testid='profile-edit-avatar']");
    await expect(pencil).toBeVisible();

    await pencil.click();

    // Edit state: the AvatarUploader mounts.
    await expect(
      page.locator("[data-testid='avatar-uploader']"),
    ).toBeVisible();

    // Done closes it.
    await page.click("[data-testid='avatar-done']");
    await expect(
      page.locator("[data-testid='avatar-uploader']"),
    ).toHaveCount(0);
    await expect(pencil).toBeVisible();
  });
});
