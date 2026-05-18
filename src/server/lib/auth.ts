import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.js";
import { ensureSelfProfile, syncSelfProfileAlias } from "./profiles.js";

const isTest = process.env.NODE_ENV === "test";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  socialProviders: {
    ...(isTest
      ? {}
      : {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          },
        }),
  },
  emailAndPassword: {
    enabled: isTest,
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
