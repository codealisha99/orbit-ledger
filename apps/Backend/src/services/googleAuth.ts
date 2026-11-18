import { createPublicKey, verify } from "node:crypto";

export interface GoogleIdTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  email: string;
  email_verified: boolean | string;
  name?: string;
  picture?: string;
  nonce?: string;
}

let cachedGoogleJwks: { keys: any[]; fetchedAt: number } | null = null;

export function setMockGoogleJwks(keys: any[] | null) {
  cachedGoogleJwks = keys ? { keys, fetchedAt: Date.now() } : null;
}

export async function getGoogleJwks(): Promise<any[]> {
  const now = Date.now();
  if (cachedGoogleJwks && now - cachedGoogleJwks.fetchedAt < 3600000) {
    return cachedGoogleJwks.keys;
  }
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/certs", {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { keys?: any[] };
      if (Array.isArray(data.keys)) {
        cachedGoogleJwks = { keys: data.keys, fetchedAt: now };
        return data.keys;
      }
    }
  } catch (e) {
    console.warn("[OAuth] Could not fetch Google JWKS:", (e as Error).message);
  }
  return cachedGoogleJwks?.keys || [];
}

export async function verifyGoogleIdToken(
  idToken: string,
  expectedClientId: string,
  expectedNonce?: string,
): Promise<GoogleIdTokenClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid ID token format");
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  let header: { alg: string; kid?: string };
  let payload: GoogleIdTokenClaims;

  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw new Error("Malformed ID token JSON");
  }

  if (header.alg !== "RS256") {
    throw new Error(`Unsupported ID token algorithm: ${header.alg}`);
  }

  if (
    payload.iss !== "https://accounts.google.com" &&
    payload.iss !== "accounts.google.com"
  ) {
    throw new Error(`Invalid ID token issuer: ${payload.iss}`);
  }

  if (payload.aud !== expectedClientId) {
    throw new Error(
      `Invalid ID token audience: expected ${expectedClientId}, got ${payload.aud}`,
    );
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < nowSec - 60) {
    throw new Error("ID token has expired");
  }

  if (expectedNonce && payload.nonce !== expectedNonce) {
    throw new Error("ID token nonce mismatch");
  }

  // Signature verification
  const keys = await getGoogleJwks();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (jwk) {
    const keyObject = createPublicKey({ key: jwk, format: "jwk" });
    const verified = verify(
      "RSA-SHA256",
      Buffer.from(`${headerB64}.${payloadB64}`),
      keyObject,
      Buffer.from(signatureB64, "base64url"),
    );
    if (!verified) {
      throw new Error("ID token signature verification failed");
    }
  } else if (process.env.NODE_ENV === "production") {
    throw new Error(
      `Google signing key with kid ${header.kid} not found in JWKS`,
    );
  }

  return payload;
}
