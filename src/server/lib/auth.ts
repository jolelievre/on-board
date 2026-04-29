import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.js";

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
    },
  },
});

export type Auth = typeof auth;
