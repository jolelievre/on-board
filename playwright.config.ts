import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// Load .env.test, then .env.test.local (overrides)
dotenv.config({ path: path.resolve(process.cwd(), ".env.test") });
dotenv.config({
  path: path.resolve(process.cwd(), ".env.test.local"),
  override: true,
});

const baseURL = process.env.BASE_URL || "http://localhost:5173";
const isRemote = !!process.env.BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  timeout: isRemote ? 60_000 : 30_000,
  use: {
    baseURL,
    trace: "on-first-retry",
    // Auth state will be set per-project via storageState
  },
  projects: [
    // Setup project: logs in once and saves auth state.
    // Uses real Chrome with automation flags disabled so Google OAuth works.
    {
      name: "auth-setup",
      testMatch: /auth\.setup\.ts/,
      use: {
        ...devices["Pixel 5"],
        ...(isRemote
          ? {
              channel: "chrome",
              launchOptions: {
                args: ["--disable-blink-features=AutomationControlled"],
              },
            }
          : {}),
      },
    },
    {
      name: "Mobile Chrome",
      use: {
        ...devices["Pixel 5"],
        storageState: "e2e/.auth/state.json",
      },
      dependencies: ["auth-setup"],
    },
    {
      name: "Mobile Safari",
      use: {
        ...devices["iPhone 13"],
        storageState: "e2e/.auth/state.json",
      },
      dependencies: ["auth-setup"],
    },
  ],
  ...(isRemote
    ? {}
    : {
        webServer: {
          command: "npm run dev",
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          env: {
            NODE_ENV: "test",
            VITE_TEST_AUTH: "true",
          },
        },
      }),
});
