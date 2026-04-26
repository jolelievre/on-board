import { test as setup } from "@playwright/test";
import { login } from "./helpers/auth";
import path from "path";

const authFile = path.join(import.meta.dirname, ".auth/state.json");

setup("authenticate", async ({ page }) => {
  await login(page);
  await page.context().storageState({ path: authFile });
});
