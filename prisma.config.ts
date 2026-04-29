// dotenv must run BEFORE prisma/config — once a Prisma config file exists
// Prisma stops auto-loading .env, so we load it explicitly here.
import "dotenv/config";

import { defineConfig } from "prisma/config";

/**
 * Prisma config (replaces the deprecated `package.json#prisma` block).
 * Configures the seed command so that `prisma migrate reset` and the first
 * `prisma migrate dev` against a fresh DB auto-run the seed script.
 */
export default defineConfig({
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
