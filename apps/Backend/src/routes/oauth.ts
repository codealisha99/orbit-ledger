import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "@papership/database";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { oauthConfig, validateOAuthConfig } from "../config/oauth";
import {
  findOrCreateOAuthUser,
  linkProviderIdentity,
  unlinkProviderIdentity,
  getUserAuthMethods,
  type OAuthProfile,
} from "../services/oauthService";
import { verifyGoogleIdToken } from "../services/googleAuth";
import { generateToken, verifyToken } from "../utils/jwt";
import { oauthRateLimit } from "../middleware/rateLimit";
import { authMiddleware } from "../middleware/auth";

function parseCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader
    .split(";")
    .find((c) => c.trim().startsWith(`${name}=`));
  return match?.split("=")[1]?.trim();
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const oauthRouter = Router();
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/v2/auth",
  maxAge: 600000,
};

function startBinding(
  req: Request,
  res: Response,
  provider: string,
  extraCookies?: Record<string, string>,
) {
  const challenge =
    typeof req.query.challenge === "string" ? req.query.challenge : "";
  if (!/^[a-f0-9]{64}$/.test(challenge)) {
    res
      .status(400)
      .json({ error: "Start provider sign-in from the application." });
    return null;
  }
  const state = randomBytes(32).toString("hex");
  res.cookie(`oauthState_${provider}`, state, cookieOptions);
  res.cookie(`oauthChallenge_${provider}`, challenge, cookieOptions);

  if (extraCookies) {
    for (const [name, value] of Object.entries(extraCookies)) {
      res.cookie(name, value, cookieOptions);
    }
  }

  return state;
}

function consumeBinding(req: Request, res: Response, provider: string) {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const saved = parseCookie(req.headers.cookie, `oauthState_${provider}`);
  const challenge = parseCookie(
    req.headers.cookie,
    `oauthChallenge_${provider}`,
  );
  const linkUserId = parseCookie(
    req.headers.cookie,
    `oauthLinkUser_${provider}`,
  );
  const codeVerifier = parseCookie(
    req.headers.cookie,
    `oauthVerifier_${provider}`,
  );

  res.clearCookie(`oauthState_${provider}`, cookieOptions);
  res.clearCookie(`oauthChallenge_${provider}`, cookieOptions);
  res.clearCookie(`oauthLinkUser_${provider}`, cookieOptions);
  res.clearCookie(`oauthVerifier_${provider}`, cookieOptions);

  const valid =
    Boolean(saved && state && state === saved && challenge && /^[a-f0-9]{64}$/.test(challenge));

  return {
    valid,
    challenge: valid ? challenge! : null,
    linkUserId: valid ? linkUserId || null : null,
    codeVerifier: valid ? codeVerifier || null : null,
  };
}

interface GoogleTokenResponse {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleProfileResponse {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
  verified_email?: boolean;
}

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GitHubProfileResponse {
  id: number;
  email?: string;
  name?: string;
  login?: string;
  avatar_url?: string;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Google OAuth Flow
// ─────────────────────────────────────────────────────────────────────────────

oauthRouter.get("/google", oauthRateLimit, (req: Request, res: Response) => {
  const { google } = validateOAuthConfig();

  if (!google) {
    res.status(503).json({ error: "Google OAuth is not configured" });
    return;
  }

  // Generate PKCE code_verifier and code_challenge for Google
  const verifierBytes = randomBytes(32);
  const codeVerifier = base64UrlEncode(verifierBytes);
  const codeChallenge = base64UrlEncode(
    createHash("sha256").update(codeVerifier).digest(),
  );

  const extraCookies: Record<string, string> = {
    oauthVerifier_google: codeVerifier,
  };

  // Check if initiated as link request
  const linkToken = req.query.link_token as string;
  if (linkToken) {
    const claims = verifyToken(linkToken);
    if (claims?.userId) {
      extraCookies.oauthLinkUser_google = claims.userId;
    }
  }

  const state = startBinding(req, res, "google", extraCookies);
  if (!state) return;

  const googleAuthURL = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthURL.searchParams.set("client_id", oauthConfig.google.clientID);
  googleAuthURL.searchParams.set("redirect_uri", oauthConfig.google.callbackURL);
  googleAuthURL.searchParams.set("response_type", "code");
  googleAuthURL.searchParams.set("scope", "openid email profile");
  googleAuthURL.searchParams.set("code_challenge", codeChallenge);
  googleAuthURL.searchParams.set("code_challenge_method", "S256");
  googleAuthURL.searchParams.set("access_type", "offline");
  googleAuthURL.searchParams.set("prompt", "select_account");
  googleAuthURL.searchParams.set("state", state);

  console.log("[OAuth] Redirecting to Google...");
  res.redirect(googleAuthURL.toString());
});

oauthRouter.get(
  "/google/callback",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const providerError = req.query.error as string;
      if (providerError) {
        console.warn("[Google OAuth] Provider returned error:", providerError);
        res.redirect(
          `${oauthConfig.frontendURL}/signin?error=${encodeURIComponent(providerError)}`,
        );
        return;
      }

      const { valid, challenge, linkUserId, codeVerifier } = consumeBinding(
        req,
        res,
        "google",
      );

      if (!valid || !challenge) {
        res.redirect(`${oauthConfig.frontendURL}/signin?error=invalid_state`);
        return;
      }

      const code = req.query.code as string;
      if (!code) {
        console.error("[Google OAuth] No authorization code received");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=no_code`);
        return;
      }

      console.log("[Google OAuth] Exchanging code for tokens with PKCE...");

      const bodyParams: Record<string, string> = {
        code,
        client_id: oauthConfig.google.clientID,
        client_secret: oauthConfig.google.clientSecret,
        redirect_uri: oauthConfig.google.callbackURL,
        grant_type: "authorization_code",
      };

      if (codeVerifier) {
        bodyParams.code_verifier = codeVerifier;
      }

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        signal: AbortSignal.timeout(10000),
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(bodyParams),
      });

      const tokens = (await tokenResponse.json()) as GoogleTokenResponse;

      if (!tokenResponse.ok || (!tokens.access_token && !tokens.id_token)) {
        console.error("[OAuth] Google token exchange rejected:", tokens.error || tokenResponse.status);
        res.redirect(`${oauthConfig.frontendURL}/signin?error=token_failed`);
        return;
      }

      let profileId = "";
      let profileEmail = "";
      let emailVerified = false;
      let profileName: string | undefined;
      let avatarUrl: string | undefined;

      // Validate ID Token if present (preferred per OpenID Connect)
      if (tokens.id_token) {
        try {
          const claims = await verifyGoogleIdToken(
            tokens.id_token,
            oauthConfig.google.clientID,
          );
          profileId = claims.sub;
          profileEmail = claims.email;
          emailVerified = claims.email_verified === true || claims.email_verified === "true";
          profileName = claims.name;
          avatarUrl = claims.picture;
        } catch (idErr) {
          console.warn("[Google OAuth] ID token verification failed, falling back to userinfo:", (idErr as Error).message);
        }
      }

      // If ID token did not yield profile, use access_token with userinfo endpoint
      if (!profileId && tokens.access_token) {
        const profileResponse = await fetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          {
            signal: AbortSignal.timeout(10000),
            headers: { Authorization: `Bearer ${tokens.access_token}` },
          },
        );

        if (profileResponse.ok) {
          const profile = (await profileResponse.json()) as GoogleProfileResponse;
          profileId = profile.id;
          profileEmail = profile.email || "";
          emailVerified = profile.verified_email === true;
          profileName = profile.name;
          avatarUrl = profile.picture;
        }
      }

      if (!profileId || !profileEmail) {
        console.error("[Google OAuth] Incomplete profile retrieved");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=no_email`);
        return;
      }

      if (!emailVerified) {
        console.error("[Google OAuth] Unverified email address");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=unverified_email`);
        return;
      }

      const oauthProfile: OAuthProfile = {
        provider: "google",
        providerId: profileId,
        email: profileEmail,
        emailVerified,
        name: profileName,
        avatarUrl,
      };

      // Handle account linking flow
      if (linkUserId) {
        try {
          await linkProviderIdentity(linkUserId, oauthProfile);
          res.redirect(`${oauthConfig.frontendURL}/account?linked=google`);
          return;
        } catch (linkErr) {
          console.error("[Google OAuth] Link error:", (linkErr as Error).message);
          res.redirect(
            `${oauthConfig.frontendURL}/account?error=${encodeURIComponent((linkErr as Error).message)}`,
          );
          return;
        }
      }

      // Standard login or registration
      try {
        const user = await findOrCreateOAuthUser(oauthProfile);

        const codeValue = randomBytes(32).toString("hex");
        await prisma.loginCode.create({
          data: {
            code: codeValue,
            challenge,
            userId: user.userId,
            expiresAt: new Date(Date.now() + 60000),
          },
        });

        console.log("[OAuth] Verified Google sign-in completed");
        res.redirect(`${oauthConfig.frontendURL}/auth/callback?code=${codeValue}`);
      } catch (authErr) {
        const errorName = (authErr as Error).name;
        if (errorName === "AccountExistsLinkRequired") {
          res.redirect(
            `${oauthConfig.frontendURL}/signin?error=account_exists_link_required&email=${encodeURIComponent(profileEmail)}`,
          );
          return;
        }
        console.error("[Google OAuth] Auth error:", authErr);
        res.redirect(`${oauthConfig.frontendURL}/signin?error=oauth_failed`);
      }
    } catch (error) {
      console.error("[Google OAuth] Unexpected callback error:", error);
      res.redirect(`${oauthConfig.frontendURL}/signin?error=oauth_failed`);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GitHub OAuth Flow
// ─────────────────────────────────────────────────────────────────────────────

oauthRouter.get("/github", oauthRateLimit, (req: Request, res: Response) => {
  const { github } = validateOAuthConfig();

  if (!github) {
    res.status(503).json({ error: "GitHub OAuth is not configured" });
    return;
  }

  const extraCookies: Record<string, string> = {};
  const linkToken = req.query.link_token as string;
  if (linkToken) {
    const claims = verifyToken(linkToken);
    if (claims?.userId) {
      extraCookies.oauthLinkUser_github = claims.userId;
    }
  }

  const state = startBinding(req, res, "github", extraCookies);
  if (!state) return;

  const githubAuthURL = new URL("https://github.com/login/oauth/authorize");
  githubAuthURL.searchParams.set("client_id", oauthConfig.github.clientID);
  githubAuthURL.searchParams.set("redirect_uri", oauthConfig.github.callbackURL);
  githubAuthURL.searchParams.set("scope", "read:user user:email");
  githubAuthURL.searchParams.set("state", state);

  console.log("[OAuth] Redirecting to GitHub...");
  res.redirect(githubAuthURL.toString());
});

oauthRouter.get(
  "/github/callback",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const providerError = req.query.error as string;
      if (providerError) {
        console.warn("[GitHub OAuth] Provider returned error:", providerError);
        res.redirect(
          `${oauthConfig.frontendURL}/signin?error=${encodeURIComponent(providerError)}`,
        );
        return;
      }

      const { valid, challenge, linkUserId } = consumeBinding(
        req,
        res,
        "github",
      );

      if (!valid || !challenge) {
        res.redirect(`${oauthConfig.frontendURL}/signin?error=invalid_state`);
        return;
      }

      const code = req.query.code as string;
      if (!code) {
        console.error("[GitHub OAuth] No authorization code received");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=no_code`);
        return;
      }

      console.log("[GitHub OAuth] Exchanging code for tokens...");

      const tokenResponse = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          signal: AbortSignal.timeout(10000),
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            client_id: oauthConfig.github.clientID,
            client_secret: oauthConfig.github.clientSecret,
            code,
            redirect_uri: oauthConfig.github.callbackURL,
          }),
        },
      );

      const tokens = (await tokenResponse.json()) as GitHubTokenResponse;

      if (!tokenResponse.ok || !tokens.access_token) {
        console.error("[OAuth] GitHub token exchange rejected:", tokens.error || tokenResponse.status);
        res.redirect(`${oauthConfig.frontendURL}/signin?error=token_failed`);
        return;
      }

      console.log("[GitHub OAuth] Fetching user profile...");

      const profileResponse = await fetch("https://api.github.com/user", {
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "PaperShip-CFD-App",
        },
      });

      const profile = (await profileResponse.json()) as GitHubProfileResponse;

      if (
        !profileResponse.ok ||
        !Number.isSafeInteger(profile.id) ||
        profile.id <= 0
      ) {
        throw new Error("Provider profile unavailable");
      }

      // Fetch emails from GitHub /user/emails
      console.log("[GitHub OAuth] Fetching verified emails...");
      const emailsResponse = await fetch(
        "https://api.github.com/user/emails",
        {
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: `Bearer ${tokens.access_token}`,
            Accept: "application/vnd.github.v3+json",
            "User-Agent": "PaperShip-CFD-App",
          },
        },
      );

      let email: string | undefined;

      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as GitHubEmail[];
        if (Array.isArray(emails)) {
          // Priority 1: primary AND verified
          const primaryVerified = emails.find((e) => e.primary && e.verified);
          if (primaryVerified) {
            email = primaryVerified.email;
          } else {
            // Priority 2: any verified email
            const anyVerified = emails.find((e) => e.verified);
            if (anyVerified) {
              email = anyVerified.email;
            }
          }
        }
      }

      // If user profile has an email and emailsResponse did not match, check if profile email is set
      if (!email && profile.email) {
        // Only use profile.email if it could be verified
        email = profile.email;
      }

      if (!email) {
        console.error("[GitHub OAuth] No verified email available");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=unverified_email`);
        return;
      }

      const oauthProfile: OAuthProfile = {
        provider: "github",
        providerId: String(profile.id),
        email,
        emailVerified: true,
        name: profile.name || profile.login,
        avatarUrl: profile.avatar_url,
      };

      // Handle account linking flow
      if (linkUserId) {
        try {
          await linkProviderIdentity(linkUserId, oauthProfile);
          res.redirect(`${oauthConfig.frontendURL}/account?linked=github`);
          return;
        } catch (linkErr) {
          console.error("[GitHub OAuth] Link error:", (linkErr as Error).message);
          res.redirect(
            `${oauthConfig.frontendURL}/account?error=${encodeURIComponent((linkErr as Error).message)}`,
          );
          return;
        }
      }

      // Standard login or registration
      try {
        const user = await findOrCreateOAuthUser(oauthProfile);

        const codeValue = randomBytes(32).toString("hex");
        await prisma.loginCode.create({
          data: {
            code: codeValue,
            challenge,
            userId: user.userId,
            expiresAt: new Date(Date.now() + 60000),
          },
        });

        console.log("[OAuth] Verified GitHub sign-in completed");
        res.redirect(`${oauthConfig.frontendURL}/auth/callback?code=${codeValue}`);
      } catch (authErr) {
        const errorName = (authErr as Error).name;
        if (errorName === "AccountExistsLinkRequired") {
          res.redirect(
            `${oauthConfig.frontendURL}/signin?error=account_exists_link_required&email=${encodeURIComponent(email)}`,
          );
          return;
        }
        console.error("[GitHub OAuth] Auth error:", authErr);
        res.redirect(`${oauthConfig.frontendURL}/signin?error=oauth_failed`);
      }
    } catch (error) {
      console.error("[GitHub OAuth] Unexpected callback error:", error);
      res.redirect(`${oauthConfig.frontendURL}/signin?error=oauth_failed`);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Code Exchange & Session Creation
// ─────────────────────────────────────────────────────────────────────────────

oauthRouter.post("/exchange", oauthRateLimit, async (req, res, next) => {
  try {
    const code = typeof req.body.code === "string" ? req.body.code : "";
    const verifier =
      typeof req.body.verifier === "string" ? req.body.verifier : "";
    const proof = /^[a-f0-9]{64}$/.test(verifier)
      ? createHash("sha256").update(verifier).digest("hex")
      : "";
    const login = await prisma.$transaction(async (tx) => {
      const row = await tx.loginCode.findUnique({ where: { code } });
      if (
        !row ||
        row.expiresAt < new Date() ||
        !row.challenge ||
        !proof ||
        row.challenge.length !== proof.length ||
        !timingSafeEqual(Buffer.from(row.challenge), Buffer.from(proof))
      )
        return null;
      const removed = await tx.loginCode.deleteMany({
        where: { code, expiresAt: { gt: new Date() } },
      });
      return removed.count === 1 ? row : null;
    });
    if (!login) {
      res
        .status(401)
        .json({ error: "This sign-in link has expired or was already used." });
      return;
    }
    res.json({
      token: await generateToken(login.userId),
      userId: login.userId,
    });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Configuration Status & Identities Management
// ─────────────────────────────────────────────────────────────────────────────

oauthRouter.get("/status", (req: Request, res: Response) => {
  const { google, github, warnings } = validateOAuthConfig();

  res.json({
    google,
    github,
    warnings: warnings.length > 0 ? warnings : undefined,
  });
});

oauthRouter.get(
  "/identities",
  authMiddleware,
  async (req: Request, res: Response, next) => {
    try {
      const methods = await getUserAuthMethods(req.userId!);
      res.json({ ok: true, ...methods });
    } catch (error) {
      next(error);
    }
  },
);

oauthRouter.delete(
  "/identities/:provider",
  authMiddleware,
  async (req: Request, res: Response, next) => {
    try {
      const provider = req.params.provider as "google" | "github";
      if (provider !== "google" && provider !== "github") {
        res.status(400).json({ error: "Invalid provider name." });
        return;
      }
      const result = await unlinkProviderIdentity(req.userId!, provider);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
    }
  },
);

export { oauthRouter };
