import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "@orbitledger/database";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { oauthConfig, validateOAuthConfig } from "../config/oauth";
import { findOrCreateOAuthUser } from "../services/oauthService";
import { generateToken } from "../utils/jwt";
import { oauthRateLimit } from "../middleware/rateLimit";

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

const oauthRouter = Router();
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/v2/auth",
  maxAge: 600000,
};
function startBinding(req: Request, res: Response, provider: string) {
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
  return state;
}
function consumeBinding(req: Request, res: Response, provider: string) {
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const saved = parseCookie(req.headers.cookie, `oauthState_${provider}`);
  const challenge = parseCookie(
    req.headers.cookie,
    `oauthChallenge_${provider}`,
  );
  res.clearCookie(`oauthState_${provider}`, cookieOptions);
  res.clearCookie(`oauthChallenge_${provider}`, cookieOptions);
  return saved &&
    state === saved &&
    challenge &&
    /^[a-f0-9]{64}$/.test(challenge)
    ? challenge
    : null;
}

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
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
}

oauthRouter.get("/google", oauthRateLimit, (req: Request, res: Response) => {
  const { google } = validateOAuthConfig();

  if (!google) {
    res.status(503).json({ error: "Google OAuth is not configured" });
    return;
  }

  const state = startBinding(req, res, "google");
  if (!state) return;

  const googleAuthURL = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  googleAuthURL.searchParams.set("client_id", oauthConfig.google.clientID);
  googleAuthURL.searchParams.set(
    "redirect_uri",
    oauthConfig.google.callbackURL,
  );
  googleAuthURL.searchParams.set("response_type", "code");
  googleAuthURL.searchParams.set("scope", "email profile");
  googleAuthURL.searchParams.set("access_type", "offline");
  googleAuthURL.searchParams.set("prompt", "consent");
  googleAuthURL.searchParams.set("state", state);

  console.log("[OAuth] Redirecting to Google...");
  res.redirect(googleAuthURL.toString());
});

oauthRouter.get(
  "/google/callback",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const challenge = consumeBinding(req, res, "google");
      if (!challenge) {
        res.redirect(`${oauthConfig.frontendURL}/signin?error=invalid_state`);
        return;
      }

      const code = req.query.code as string;

      if (!code) {
        console.error("[Google OAuth] No code received");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=no_code`);
        return;
      }

      console.log("[Google OAuth] Exchanging code for tokens...");

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        signal: AbortSignal.timeout(10000),
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: oauthConfig.google.clientID,
          client_secret: oauthConfig.google.clientSecret,
          redirect_uri: oauthConfig.google.callbackURL,
          grant_type: "authorization_code",
        }),
      });

      const tokens = (await tokenResponse.json()) as GoogleTokenResponse;

      if (!tokenResponse.ok || !tokens.access_token) {
        console.error("[OAuth] Google token exchange rejected");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=token_failed`);
        return;
      }

      console.log("[Google OAuth] Fetching user profile...");

      const profileResponse = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        {
          signal: AbortSignal.timeout(10000),
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        },
      );

      const profile = (await profileResponse.json()) as GoogleProfileResponse;

      if (
        !profileResponse.ok ||
        typeof profile.id !== "string" ||
        !profile.id ||
        !profile.email ||
        profile.verified_email !== true
      ) {
        console.error("[Google OAuth] No email in profile");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=no_email`);
        return;
      }

      console.log("[OAuth] Verified provider sign-in completed");

      const user = await findOrCreateOAuthUser({
        provider: "google",
        providerId: profile.id,
        email: profile.email,
        emailVerified: profile.verified_email === true,
        name: profile.name,
        avatarUrl: profile.picture,
      });

      const codeValue = randomBytes(32).toString("hex");
      await prisma.loginCode.create({
        data: {
          code: codeValue,
          challenge,
          userId: user.userId,
          expiresAt: new Date(Date.now() + 60000),
        },
      });

      console.log("[OAuth] Verified provider sign-in completed");

      res.redirect(
        `${oauthConfig.frontendURL}/auth/callback?code=${codeValue}`,
      );
    } catch (error) {
      console.error("[Google OAuth] Error:", error);
      res.redirect(`${oauthConfig.frontendURL}/signin?error=oauth_failed`);
    }
  },
);

oauthRouter.get("/github", oauthRateLimit, (req: Request, res: Response) => {
  const { github } = validateOAuthConfig();

  if (!github) {
    res.status(503).json({ error: "GitHub OAuth is not configured" });
    return;
  }

  const state = startBinding(req, res, "github");
  if (!state) return;

  const githubAuthURL = new URL("https://github.com/login/oauth/authorize");

  githubAuthURL.searchParams.set("client_id", oauthConfig.github.clientID);
  githubAuthURL.searchParams.set(
    "redirect_uri",
    oauthConfig.github.callbackURL,
  );
  githubAuthURL.searchParams.set("scope", "user:email");
  githubAuthURL.searchParams.set("state", state);

  console.log("[OAuth] Redirecting to GitHub...");
  res.redirect(githubAuthURL.toString());
});

oauthRouter.get(
  "/github/callback",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const challenge = consumeBinding(req, res, "github");
      if (!challenge) {
        res.redirect(`${oauthConfig.frontendURL}/signin?error=invalid_state`);
        return;
      }

      const code = req.query.code as string;

      if (!code) {
        console.error("[GitHub OAuth] No code received");
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
        console.error("[OAuth] GitHub token exchange rejected");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=token_failed`);
        return;
      }

      console.log("[GitHub OAuth] Fetching user profile...");

      const profileResponse = await fetch("https://api.github.com/user", {
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "OrbitLedger-CFD-App",
        },
      });

      const profile = (await profileResponse.json()) as GitHubProfileResponse;

      if (
        !profileResponse.ok ||
        !Number.isSafeInteger(profile.id) ||
        profile.id <= 0
      )
        throw new Error("Provider profile unavailable");
      let email: string | undefined;

      {
        console.log("[GitHub OAuth] Email not in profile, fetching emails...");

        const emailsResponse = await fetch(
          "https://api.github.com/user/emails",
          {
            signal: AbortSignal.timeout(10000),
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "OrbitLedger-CFD-App",
            },
          },
        );

        const emails = (await emailsResponse.json()) as GitHubEmail[];

        if (emailsResponse.ok && Array.isArray(emails)) {
          const primaryEmail = emails.find(
            (e: GitHubEmail) => e.primary && e.verified,
          );
          email = primaryEmail?.email;

          if (!email) {
            const verifiedEmail = emails.find((e: GitHubEmail) => e.verified);
            email = verifiedEmail?.email;
          }
        }
      }

      if (!email) {
        console.error("[GitHub OAuth] No email available");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=no_email`);
        return;
      }

      console.log("[OAuth] Verified provider sign-in completed");

      const user = await findOrCreateOAuthUser({
        provider: "github",
        providerId: String(profile.id),
        email,
        emailVerified: true,
        name: profile.name || profile.login,
        avatarUrl: profile.avatar_url,
      });

      const codeValue = randomBytes(32).toString("hex");
      await prisma.loginCode.create({
        data: {
          code: codeValue,
          challenge,
          userId: user.userId,
          expiresAt: new Date(Date.now() + 60000),
        },
      });

      console.log("[OAuth] Verified provider sign-in completed");

      res.redirect(
        `${oauthConfig.frontendURL}/auth/callback?code=${codeValue}`,
      );
    } catch (error) {
      console.error("[GitHub OAuth] Error:", error);
      res.redirect(`${oauthConfig.frontendURL}/signin?error=oauth_failed`);
    }
  },
);

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
oauthRouter.get("/status", (req: Request, res: Response) => {
  const { google, github } = validateOAuthConfig();

  res.json({
    google: google,
    github: github,
  });
});

export { oauthRouter };
