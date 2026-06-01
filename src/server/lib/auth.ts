import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.js";
import { ensureSelfProfile, syncSelfProfileAlias } from "./profiles.js";
import { generateAppleClientSecret } from "./apple-client-secret.js";

const isTest = process.env.NODE_ENV === "test";

export type SocialProviderId = "google" | "facebook" | "apple";

/**
 * Build the social-providers map. Each provider only enables when its
 * credentials are present in the environment, so a partially configured
 * deploy (e.g. production has Apple but integration doesn't) just hides
 * the unconfigured buttons on the login page — better-auth never sees
 * incomplete provider configs.
 */
function buildSocialProviders() {
  if (isTest) return {};

  const providers: Record<string, { clientId: string; clientSecret: string }> =
    {};

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    };
  }

  if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
    providers.facebook = {
      clientId: process.env.FACEBOOK_CLIENT_ID,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    };
  }

  if (
    process.env.APPLE_CLIENT_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY
  ) {
    providers.apple = {
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: generateAppleClientSecret({
        teamId: process.env.APPLE_TEAM_ID,
        keyId: process.env.APPLE_KEY_ID,
        clientId: process.env.APPLE_CLIENT_ID,
        privateKey: process.env.APPLE_PRIVATE_KEY,
      }),
    };
  }

  return providers;
}

const socialProviders = buildSocialProviders();
const enabledSocialProviders = Object.keys(socialProviders) as SocialProviderId[];

/**
 * The set of social providers that have credentials configured in the
 * current process environment. The login page reads this through the
 * public `/api/auth/providers` endpoint so it only renders buttons for
 * providers the server can actually authenticate against.
 */
export function getEnabledSocialProviders(): SocialProviderId[] {
  return enabledSocialProviders;
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  socialProviders,
  emailAndPassword: {
    enabled: isTest,
  },
  account: {
    // Email-keyed account linking — a user who first signed in via Google
    // and later clicks "Sign in with Facebook" (with the same verified
    // email) lands on the same `User` row instead of getting a duplicate
    // account + duplicate self-Profile + split history.
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "facebook", "apple"],
    },
  },
  user: {
    fields: {
      image: "avatarUrl",
    },
    additionalFields: {
      locale: {
        type: "string",
        required: false,
        defaultValue: "en",
        input: true,
      },
      theme: {
        type: "string",
        required: false,
        defaultValue: "parchment",
        input: true,
      },
      alias: {
        type: "string",
        required: false,
        input: true,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        // Provision the self-Profile right after the auth row is created.
        // Without this, a brand-new user wouldn't appear in their own
        // suggestions list until they created a match. Idempotent —
        // safe to re-run on legacy users via the migration backfill.
        after: async (user) => {
          await ensureSelfProfile({
            id: user.id,
            name: user.name,
            alias: (user as { alias?: string | null }).alias ?? null,
          });
        },
      },
      update: {
        // Mirror alias changes onto the self-Profile so the
        // retroactive-alias-in-history flow keeps working. Without this
        // hook, Player rows would resolve through a Profile whose
        // `alias` stayed frozen at signup time.
        after: async (user) => {
          if (!user?.id) return;
          await syncSelfProfileAlias(user.id);
        },
      },
    },
  },
});

export type Auth = typeof auth;
