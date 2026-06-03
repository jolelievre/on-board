import { Hono } from "hono";
import { prisma } from "../lib/prisma.js";
import { structuredError } from "../lib/structured-errors.js";
import type { AuthUser } from "../middleware/auth.js";

type AuthEnv = {
  Variables: {
    user: AuthUser;
  };
};

/** Maximum number of failure rows accepted in one POST. A real device
 * realistically reports a handful of entries; capping at 32 prevents a
 * runaway client (or a hostile one) from flooding the table. */
const MAX_FAILURES_PER_REPORT = 32;

/** Maximum length of any string field we'll persist. The URL field is the
 * widest realistic case (`/api/matches/<cuid>/scores`, ~50 chars) so 512
 * gives plenty of headroom while keeping a single bad row bounded. */
const MAX_FIELD_LEN = 512;

type FailureReport = {
  method?: string;
  url?: string;
  status?: number;
  errorMessage?: string;
  errorField?: string;
  errorHint?: string;
  retries?: number;
  clientFailedAt?: string;
};

function clamp(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  return value.length > MAX_FIELD_LEN ? value.slice(0, MAX_FIELD_LEN) : value;
}

export const syncRoutes = new Hono<AuthEnv>().post("/failures", async (c) => {
  // Best-effort telemetry endpoint (Phase 8-E). The client posts a
  // batch of terminally-failed sync queue entries here on the next
  // pull-sync after the failure. Server-only — never read back to any
  // user-facing surface; consumed manually by the operator while
  // diagnosing the PR 8-D stall before PR 8-F lands the recovery fix.
  const user = c.get("user");

  let body: { failures?: FailureReport[] };
  try {
    body = (await c.req.json()) as { failures?: FailureReport[] };
  } catch {
    return structuredError(c, 400, { error: "JSON body required" });
  }

  const failures = body.failures;
  if (!Array.isArray(failures) || failures.length === 0) {
    return structuredError(c, 400, {
      error: "failures must be a non-empty array",
      field: "failures",
    });
  }
  if (failures.length > MAX_FAILURES_PER_REPORT) {
    return structuredError(c, 400, {
      error: `Too many failures per report (max ${MAX_FAILURES_PER_REPORT})`,
      field: "failures",
    });
  }

  const rows = failures
    .filter((f) => typeof f.method === "string" && typeof f.url === "string")
    .map((f) => ({
      userId: user.id,
      method: (f.method ?? "").slice(0, 16),
      url: clamp(f.url) ?? "",
      status: typeof f.status === "number" ? f.status : null,
      errorMessage: clamp(f.errorMessage),
      errorField: clamp(f.errorField),
      errorHint: clamp(f.errorHint),
      retries: typeof f.retries === "number" ? f.retries : 0,
      clientFailedAt: clamp(f.clientFailedAt),
    }));

  if (rows.length === 0) {
    return c.json({ recorded: 0 });
  }

  await prisma.syncFailureLog.createMany({ data: rows });
  return c.json({ recorded: rows.length });
});
