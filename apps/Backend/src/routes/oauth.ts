import { Router } from "express";
import type { Request, Response } from "express";
import { randomBytes } from "crypto";
import { oauthConfig, validateOAuthConfig } from "../config/oauth";
import { findOrCreateOAuthUser } from "../services/oauthService";
import { generateToken } from "../utils/jwt";
import { oauthRateLimit } from "../middleware/rateLimit";

function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.split(";").find((c) => c.trim().startsWith(`${name}=`));
  return match?.split("=")[1]?.trim();
}

const oauthRouter = Router();

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
}

interface GoogleProfileResponse {
  id: string;
  email?: string;
  name?: string;
  picture?: string;
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

  const state = randomBytes(16).toString("hex");
  res.cookie("oauthState", state, { httpOnly: true, sameSite: "lax", maxAge: 600000 });

  const googleAuthURL = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  googleAuthURL.searchParams.set("client_id", oauthConfig.google.clientID);
  googleAuthURL.searchParams.set(
    "redirect_uri",
    oauthConfig.google.callbackURL
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
      const returnedState = req.query.state as string;
      const cookieState = parseCookie(req.headers.cookie, "oauthState");

      if (!returnedState || !cookieState || returnedState !== cookieState) {
        console.error("[Google OAuth] CSRF state mismatch");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=invalid_state`);
        return;
      }
      res.clearCookie("oauthState");

      const code = req.query.code as string;

      if (!code) {
        console.error("[Google OAuth] No code received");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=no_code`);
        return;
      }

      console.log("[Google OAuth] Exchanging code for tokens...");

      const tokenResponse = await fetch(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: oauthConfig.google.clientID,
            client_secret: oauthConfig.google.clientSecret,
            redirect_uri: oauthConfig.google.callbackURL,
            grant_type: "authorization_code",
          }),
        }
      );

      const tokens = (await tokenResponse.json()) as GoogleTokenResponse;

      if (!tokens.access_token) {
        console.error("[Google OAuth] Token error:", tokens);
        res.redirect(`${oauthConfig.frontendURL}/signin?error=token_failed`);
        return;
      }

      console.log("[Google OAuth] Fetching user profile...");

      const profileResponse = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        }
      );

      const profile = (await profileResponse.json()) as GoogleProfileResponse;

      if (!profile.email) {
        console.error("[Google OAuth] No email in profile");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=no_email`);
        return;
      }

      console.log(`[Google OAuth] User profile: ${profile.email}`);

      const user = await findOrCreateOAuthUser({
        provider: "google",
        providerId: profile.id,
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.picture,
      });

      const token = generateToken(user.userId);

      console.log(`[Google OAuth] Success! Redirecting user: ${user.email}`);

      res.redirect(
        `${oauthConfig.frontendURL}/auth/callback?token=${token}&userId=${user.userId}`
      );
    } catch (error) {
      console.error("[Google OAuth] Error:", error);
      res.redirect(`${oauthConfig.frontendURL}/signin?error=oauth_failed`);
    }
  }
);

oauthRouter.get("/github", oauthRateLimit, (req: Request, res: Response) => {
  const { github } = validateOAuthConfig();

  if (!github) {
    res.status(503).json({ error: "GitHub OAuth is not configured" });
    return;
  }

  const state = randomBytes(16).toString("hex");
  res.cookie("oauthState", state, { httpOnly: true, sameSite: "lax", maxAge: 600000 });

  const githubAuthURL = new URL("https://github.com/login/oauth/authorize");

  githubAuthURL.searchParams.set("client_id", oauthConfig.github.clientID);
  githubAuthURL.searchParams.set(
    "redirect_uri",
    oauthConfig.github.callbackURL
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
      const returnedState = req.query.state as string;
      const cookieState = parseCookie(req.headers.cookie, "oauthState");

      if (!returnedState || !cookieState || returnedState !== cookieState) {
        console.error("[GitHub OAuth] CSRF state mismatch");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=invalid_state`);
        return;
      }
      res.clearCookie("oauthState");

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
        }
      );

      const tokens = (await tokenResponse.json()) as GitHubTokenResponse;

      if (!tokens.access_token) {
        console.error("[GitHub OAuth] Token error:", tokens);
        res.redirect(`${oauthConfig.frontendURL}/signin?error=token_failed`);
        return;
      }

      console.log("[GitHub OAuth] Fetching user profile...");

      const profileResponse = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "OrbitLedger-CFD-App",
        },
      });

      const profile = (await profileResponse.json()) as GitHubProfileResponse;

      let email = profile.email;

      if (!email) {
        console.log("[GitHub OAuth] Email not in profile, fetching emails...");

        const emailsResponse = await fetch(
          "https://api.github.com/user/emails",
          {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
              Accept: "application/vnd.github.v3+json",
              "User-Agent": "OrbitLedger-CFD-App",
            },
          }
        );

        const emails = (await emailsResponse.json()) as GitHubEmail[];

        if (Array.isArray(emails)) {
          const primaryEmail = emails.find(
            (e: GitHubEmail) => e.primary && e.verified
          );
          email = primaryEmail?.email;

          if (!email) {
            const verifiedEmail = emails.find(
              (e: GitHubEmail) => e.verified
            );
            email = verifiedEmail?.email;
          }
        }
      }

      if (!email) {
        console.error("[GitHub OAuth] No email available");
        res.redirect(`${oauthConfig.frontendURL}/signin?error=no_email`);
        return;
      }

      console.log(`[GitHub OAuth] User profile: ${email}`);

      const user = await findOrCreateOAuthUser({
        provider: "github",
        providerId: String(profile.id),
        email,
        name: profile.name || profile.login,
        avatarUrl: profile.avatar_url,
      });

      const token = generateToken(user.userId);

      console.log(`[GitHub OAuth] Success! Redirecting user: ${user.email}`);

      res.redirect(
        `${oauthConfig.frontendURL}/auth/callback?token=${token}&userId=${user.userId}`
      );
    } catch (error) {
      console.error("[GitHub OAuth] Error:", error);
      res.redirect(`${oauthConfig.frontendURL}/signin?error=oauth_failed`);
    }
  }
);



oauthRouter.get("/status", (req: Request, res: Response) => {
  const { google, github } = validateOAuthConfig();

  res.json({
    google: google,
    github: github,
  });
});

export { oauthRouter };
