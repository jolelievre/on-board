import { createMiddleware } from "hono/factory";
import { auth } from "../lib/auth.js";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  locale: string;
  theme: string;
};

export type AuthSession = {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
};

type AuthEnv = {
  Variables: {
    user: AuthUser;
    session: AuthSession;
  };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Map better-auth's user shape to our domain type.
  // better-auth uses "image" internally; our schema uses "avatarUrl".
  // At runtime, the field mapping in auth config handles DB read/write,
  // but the TypeScript types still expose "image".
  const rawUser = session.user as Record<string, unknown>;
  const user: AuthUser = {
    id: rawUser.id as string,
    email: rawUser.email as string,
    name: rawUser.name as string,
    avatarUrl: (rawUser.avatarUrl ?? rawUser.image ?? null) as string | null,
    locale: (rawUser.locale as string) || "en",
    theme: (rawUser.theme as string) || "parchment",
  };

  c.set("user", user);
  c.set("session", session.session as AuthSession);
  await next();
});
