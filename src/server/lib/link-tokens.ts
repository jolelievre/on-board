import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived signed tokens for the QR profile-link flow.
 *
 * A token proves "the holder is User X, anchoring this link gesture
 * onto their owned Profile Y" to a friend who scans it. Anchoring on a
 * concrete Profile is what makes the flow bilateral: both sides perform
 * a deliberate "this profile is for that person" gesture, and the
 * server links both rows in one transaction.
 *
 * Structure: `<base64url-payload>.<base64url-signature>`
 *   payload = JSON { userId, sourceProfileId, exp }   (exp = unix ms)
 *   signature = HMAC-SHA256(payload, BETTER_AUTH_SECRET)
 *
 * We reuse BETTER_AUTH_SECRET because it's already required for every
 * deploy and is the same trust boundary as the auth session — a leak
 * of either compromises the same set of users.
 */

export const LINK_TOKEN_TTL_MS = 60_000;

export type LinkTokenPayload = {
  userId: string;
  sourceProfileId: string;
  exp: number;
};

export class LinkTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkTokenError";
  }
}

function getSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "BETTER_AUTH_SECRET is not set; link tokens cannot be signed.",
    );
  }
  return secret;
}

function base64urlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecode(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return Buffer.from(b64, "base64");
}

function sign(payloadB64: string): string {
  return base64urlEncode(
    createHmac("sha256", getSecret()).update(payloadB64).digest(),
  );
}

/**
 * Mint a token attesting that the caller is `userId` and intends to
 * link their owned profile `sourceProfileId`, valid for the next
 * {@link LINK_TOKEN_TTL_MS} milliseconds.
 */
export function createLinkToken({
  userId,
  sourceProfileId,
}: {
  userId: string;
  sourceProfileId: string;
}): {
  token: string;
  expiresAt: string;
} {
  const exp = Date.now() + LINK_TOKEN_TTL_MS;
  const payload: LinkTokenPayload = { userId, sourceProfileId, exp };
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const sigB64 = sign(payloadB64);
  return {
    token: `${payloadB64}.${sigB64}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

/**
 * Verify a token and return its payload. Throws `LinkTokenError` with a
 * stable, user-safe message on any failure (malformed / bad signature /
 * expired). Callers should treat the error message as opaque and map it
 * to HTTP 400 — never expose internal details such as the expected
 * signature.
 */
export function verifyLinkToken(token: string): LinkTokenPayload {
  if (typeof token !== "string" || token.length === 0) {
    throw new LinkTokenError("Invalid link token");
  }
  const parts = token.split(".");
  if (parts.length !== 2) {
    throw new LinkTokenError("Invalid link token");
  }
  const [payloadB64, sigB64] = parts;
  const expectedSig = sign(payloadB64);

  // timingSafeEqual requires equal-length buffers; if a malformed token
  // produces a shorter signature, fall through to the rejection path.
  const provided = base64urlDecode(sigB64);
  const expected = base64urlDecode(expectedSig);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    throw new LinkTokenError("Invalid link token");
  }

  let payload: LinkTokenPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString("utf8")) as
      LinkTokenPayload;
  } catch {
    throw new LinkTokenError("Invalid link token");
  }
  if (
    !payload ||
    typeof payload.userId !== "string" ||
    typeof payload.sourceProfileId !== "string" ||
    typeof payload.exp !== "number"
  ) {
    throw new LinkTokenError("Invalid link token");
  }
  if (payload.exp < Date.now()) {
    throw new LinkTokenError("Link token has expired");
  }
  return payload;
}
