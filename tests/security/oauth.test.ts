import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../../packages/database/src/index";
import {
  findOrCreateOAuthUser,
  linkProviderIdentity,
  unlinkProviderIdentity,
  getUserAuthMethods,
} from "../../apps/Backend/src/services/oauthService";
import {
  verifyGoogleIdToken,
  setMockGoogleJwks,
} from "../../apps/Backend/src/services/googleAuth";
import { generateKeyPairSync, createSign } from "node:crypto";
import { randomUUID } from "node:crypto";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/");
if (
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  !target.pathname.startsWith("/actioncd_quality_") ||
  target.searchParams.has("host")
) {
  throw new Error("Use a dedicated localhost actioncd_quality_ database for tests.");
}

describe("OAuth & Multi-Provider Identity Security Testing", () => {
  const testUsers: string[] = [];

  // Generate test RSA key pair for mocking Google ID tokens
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" }) as any;
  jwk.kid = "test-key-1";
  jwk.alg = "RS256";
  jwk.use = "sig";

  beforeAll(() => {
    setMockGoogleJwks([jwk]);
  });

  afterAll(async () => {
    setMockGoogleJwks(null);
    if (testUsers.length > 0) {
      await prisma.providerIdentity.deleteMany({
        where: { userId: { in: testUsers } },
      });
      await prisma.authSession.deleteMany({
        where: { userId: { in: testUsers } },
      });
      await prisma.user.deleteMany({
        where: { userId: { in: testUsers } },
      });
    }
  });

  function createSignedGoogleToken(claims: Record<string, any>, kid = "test-key-1") {
    const header = { alg: "RS256", kid };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
    const payloadB64 = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signer = createSign("RSA-SHA256");
    signer.update(`${headerB64}.${payloadB64}`);
    const signatureB64 = signer.sign(privateKey).toString("base64url");
    return `${headerB64}.${payloadB64}.${signatureB64}`;
  }

  test("Google ID Token: validates signature, issuer, audience, expiry, and nonce", async () => {
    const clientId = "test-google-client-id.apps.googleusercontent.com";
    const nonce = "random-nonce-123";
    const validClaims = {
      iss: "https://accounts.google.com",
      sub: "google-sub-123",
      aud: clientId,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      email: "trader@google.com",
      email_verified: true,
      nonce,
    };

    const token = createSignedGoogleToken(validClaims);
    const verified = await verifyGoogleIdToken(token, clientId, nonce);
    expect(verified.sub).toBe("google-sub-123");
    expect(verified.email).toBe("trader@google.com");

    // Rejects invalid audience
    expect(
      verifyGoogleIdToken(token, "wrong-client-id", nonce)
    ).rejects.toThrow("Invalid ID token audience");

    // Rejects invalid nonce
    expect(
      verifyGoogleIdToken(token, clientId, "wrong-nonce")
    ).rejects.toThrow("ID token nonce mismatch");

    // Rejects expired token
    const expiredToken = createSignedGoogleToken({
      ...validClaims,
      exp: Math.floor(Date.now() / 1000) - 100,
    });
    expect(
      verifyGoogleIdToken(expiredToken, clientId, nonce)
    ).rejects.toThrow("ID token has expired");

    // Rejects invalid issuer
    const badIssuerToken = createSignedGoogleToken({
      ...validClaims,
      iss: "https://fakegoogle.com",
    });
    expect(
      verifyGoogleIdToken(badIssuerToken, clientId, nonce)
    ).rejects.toThrow("Invalid ID token issuer");
  });

  test("Google OAuth Sign-in: creates user and ProviderIdentity on first sign-in", async () => {
    const googleId = `g_${randomUUID()}`;
    const email = `newuser_${Date.now()}@gmail.com`;

    const user = await findOrCreateOAuthUser({
      provider: "google",
      providerId: googleId,
      email,
      emailVerified: true,
      name: "New Trader",
    });

    expect(user).toBeDefined();
    expect(user.userId).toBeDefined();
    testUsers.push(user.userId);

    // Verify ProviderIdentity created
    const identity = await prisma.providerIdentity.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "google",
          providerAccountId: googleId,
        },
      },
    });
    expect(identity).not.toBeNull();
    expect(identity?.userId).toBe(user.userId);
    expect(identity?.email).toBe(email.toLowerCase());
  });

  test("GitHub OAuth Sign-in: handles private/relay noreply emails correctly", async () => {
    const ghId = `gh_${randomUUID()}`;
    const noreplyEmail = `${ghId}+username@users.noreply.github.com`;

    const user = await findOrCreateOAuthUser({
      provider: "github",
      providerId: ghId,
      email: noreplyEmail,
      emailVerified: true,
      name: "GitHub Trader",
    });

    testUsers.push(user.userId);
    expect(user.email).toBe(noreplyEmail.toLowerCase());

    const identity = await prisma.providerIdentity.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "github",
          providerAccountId: ghId,
        },
      },
    });
    expect(identity?.email).toBe(noreplyEmail.toLowerCase());
  });

  test("Unverified Email Rejection: rejects OAuth profile if email is unverified", async () => {
    const ghId = `gh_unverified_${randomUUID()}`;
    expect(
      findOrCreateOAuthUser({
        provider: "github",
        providerId: ghId,
        email: "unverified@example.com",
        emailVerified: false,
      })
    ).rejects.toThrow("A verified provider email is required");
  });

  test("Account Linking Safety: blocks silent auto-merging if email exists on password account", async () => {
    const existingUserId = `existing_${randomUUID()}`;
    const sharedEmail = `shared_${Date.now()}@domain.com`;

    // Create existing password user
    await prisma.user.create({
      data: {
        userId: existingUserId,
        email: sharedEmail,
        password: "hashed-password-123",
        balanceCents: 500000,
        emailVerified: true,
      },
    });
    testUsers.push(existingUserId);

    // Try OAuth sign-in with same email without linking token
    let errorCaught: any = null;
    try {
      await findOrCreateOAuthUser({
        provider: "google",
        providerId: `g_attacker_${randomUUID()}`,
        email: sharedEmail,
        emailVerified: true,
      });
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).not.toBeNull();
    expect(errorCaught.name).toBe("AccountExistsLinkRequired");
  });

  test("Safe Account Linking: authenticated user can link new provider identity", async () => {
    const userId = `link_user_${randomUUID()}`;
    const userEmail = `link_${Date.now()}@domain.com`;

    await prisma.user.create({
      data: {
        userId,
        email: userEmail,
        password: "secret123",
        balanceCents: 500000,
        emailVerified: true,
      },
    });
    testUsers.push(userId);

    const ghId = `gh_link_${randomUUID()}`;
    const result = await linkProviderIdentity(userId, {
      provider: "github",
      providerId: ghId,
      email: "github_alt@domain.com",
      emailVerified: true,
    });

    expect(result.ok).toBe(true);
    expect(result.alreadyLinked).toBe(false);

    // Verify it is listed in methods
    const methods = await getUserAuthMethods(userId);
    expect(methods.hasPassword).toBe(true);
    expect(methods.providers).toContain("github");
  });

  test("Sole Authentication Method Protection: prevents disconnecting only sign-in method", async () => {
    const oauthUserId = `oauth_only_${randomUUID()}`;
    const gId = `g_sole_${randomUUID()}`;

    // Create user with ONLY Google identity and NO password
    const user = await findOrCreateOAuthUser({
      provider: "google",
      providerId: gId,
      email: `sole_${Date.now()}@gmail.com`,
      emailVerified: true,
    });
    testUsers.push(user.userId);

    // Attempting to disconnect Google must throw lockout prevention error
    expect(
      unlinkProviderIdentity(user.userId, "google")
    ).rejects.toThrow("Cannot disconnect your only sign-in method");

    // But if we link GitHub as a secondary method:
    const ghId = `gh_secondary_${randomUUID()}`;
    await linkProviderIdentity(user.userId, {
      provider: "github",
      providerId: ghId,
      email: `sole_gh_${Date.now()}@gmail.com`,
      emailVerified: true,
    });

    // Now unlinking Google succeeds because GitHub is still active
    const unlinkResult = await unlinkProviderIdentity(user.userId, "google");
    expect(unlinkResult.ok).toBe(true);

    const methodsAfter = await getUserAuthMethods(user.userId);
    expect(methodsAfter.providers).toEqual(["github"]);
    expect(methodsAfter.providers).not.toContain("google");
  });

  test("Unique Identity Constraint: prevents linking same provider ID to two different accounts", async () => {
    const user1 = `user1_${randomUUID()}`;
    const user2 = `user2_${randomUUID()}`;

    await prisma.user.createMany({
      data: [
        { userId: user1, email: `${user1}@test.com`, password: "p1", balanceCents: 500000 },
        { userId: user2, email: `${user2}@test.com`, password: "p2", balanceCents: 500000 },
      ],
    });
    testUsers.push(user1, user2);

    const sharedProviderId = `gh_unique_${randomUUID()}`;
    await linkProviderIdentity(user1, {
      provider: "github",
      providerId: sharedProviderId,
      email: "unique@test.com",
      emailVerified: true,
    });

    // Attempt linking to user2 should fail
    expect(
      linkProviderIdentity(user2, {
        provider: "github",
        providerId: sharedProviderId,
        email: "unique@test.com",
        emailVerified: true,
      })
    ).rejects.toThrow("already linked to another Paper Ship user");
  });

  test("Session Creation & Revocation: OAuth user gets valid AuthSession and token can be revoked", async () => {
    const { generateToken } = await import("../../apps/Backend/src/utils/jwt");
    const jwt = (await import("jsonwebtoken")).default;

    const googleId = `g_session_${randomUUID()}`;
    const user = await findOrCreateOAuthUser({
      provider: "google",
      providerId: googleId,
      email: `session_${Date.now()}@gmail.com`,
      emailVerified: true,
    });
    testUsers.push(user.userId);

    const token = await generateToken(user.userId);
    const decoded = jwt.decode(token) as any;
    expect(decoded.jti).toBeDefined();

    // Verify session exists in DB
    const session = await prisma.authSession.findUnique({
      where: { id: decoded.jti },
    });
    expect(session).not.toBeNull();
    expect(session?.userId).toBe(user.userId);

    // Revoke session
    await prisma.authSession.delete({ where: { id: decoded.jti } });
    const revoked = await prisma.authSession.findUnique({
      where: { id: decoded.jti },
    });
    expect(revoked).toBeNull();
  });

  test("Config Status Check: report configuration status without leaking client secrets", async () => {
    const { validateOAuthConfig } = await import(
      "../../apps/Backend/src/config/oauth"
    );
    const status = validateOAuthConfig();
    expect(status).toHaveProperty("google");
    expect(status).toHaveProperty("github");
    expect(typeof status.google).toBe("boolean");
    expect(typeof status.github).toBe("boolean");
    // Ensure secrets are not present in the returned status
    expect((status as any).clientSecret).toBeUndefined();
    expect((status as any).googleClientSecret).toBeUndefined();
    expect((status as any).githubClientSecret).toBeUndefined();
  });
});
