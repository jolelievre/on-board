import { createPrivateKey, createSign } from "node:crypto";

/**
 * Apple Sign-In requires the "client secret" to be an ES256-signed JWT
 * built from the developer's team id, key id, and ECDSA P-256 private key
 * downloaded from the Apple Developer console. Better-auth's Apple provider
 * expects the secret as a plain string, so we build the JWT here and pass
 * the result through. Apple caps the token lifetime at 6 months — we
 * regenerate per process start, which is fine for our deploy cadence.
 *
 * Reference: https://developer.apple.com/documentation/sign_in_with_apple/generate-and-validate-tokens
 */

type AppleClientSecretInput = {
  teamId: string;
  keyId: string;
  clientId: string;
  /** ECDSA P-256 private key in PEM format, as provided by Apple. */
  privateKey: string;
};

const APPLE_JWT_LIFETIME_SECONDS = 60 * 60 * 24 * 180; // 180d — Apple caps at 6 months.

export function generateAppleClientSecret(input: AppleClientSecretInput): string {
  const header = base64url(
    JSON.stringify({ alg: "ES256", kid: input.keyId, typ: "JWT" }),
  );
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      iss: input.teamId,
      iat: now,
      exp: now + APPLE_JWT_LIFETIME_SECONDS,
      aud: "https://appleid.apple.com",
      sub: input.clientId,
    }),
  );
  const message = `${header}.${payload}`;

  // Single-line env vars commonly arrive with `\n` as the literal
  // two-character escape rather than real newlines — normalise both
  // shapes so the PEM parser is happy either way.
  const pem = input.privateKey.replace(/\\n/g, "\n");
  const key = createPrivateKey(pem);
  const derSignature = createSign("SHA256").update(message).sign(key);
  const joseSignature = derToJoseEs256(derSignature);

  return `${message}.${base64urlBuffer(joseSignature)}`;
}

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function base64urlBuffer(input: Buffer): string {
  return input.toString("base64url");
}

/**
 * Convert an ASN.1 DER-encoded ECDSA signature (Node's `sign()` default)
 * into the raw R||S 64-byte form required by JOSE / JWT ES256.
 */
function derToJoseEs256(der: Buffer): Buffer {
  if (der[0] !== 0x30) throw new Error("Invalid DER signature: missing SEQUENCE");
  let offset = 2; // skip SEQUENCE tag + length
  if (der[offset] !== 0x02)
    throw new Error("Invalid DER signature: expected INTEGER for r");
  const rLen = der[offset + 1];
  const r = der.subarray(offset + 2, offset + 2 + rLen);
  offset += 2 + rLen;
  if (der[offset] !== 0x02)
    throw new Error("Invalid DER signature: expected INTEGER for s");
  const sLen = der[offset + 1];
  const s = der.subarray(offset + 2, offset + 2 + sLen);

  return Buffer.concat([padTo32Bytes(r), padTo32Bytes(s)]);
}

function padTo32Bytes(buf: Buffer): Buffer {
  if (buf.length === 32) return buf;
  if (buf.length === 33 && buf[0] === 0x00) return buf.subarray(1);
  if (buf.length < 32)
    return Buffer.concat([Buffer.alloc(32 - buf.length), buf]);
  throw new Error(`Invalid ECDSA coord length: ${buf.length}`);
}
