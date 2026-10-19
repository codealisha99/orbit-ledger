import { prisma } from "@orbitledger/database";
import { v4 as uuidv4 } from "uuid";
import { INITIAL_BALANCE_CENTS, StoreData, CreateUser } from "../data/store";
import type { Asset } from "@orbitledger/shared";

export interface OAuthProfile {
  provider: "google" | "github";
  providerId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
}

export async function findOrCreateOAuthUser(profile: OAuthProfile) {
  profile = { ...profile, email: profile.email.trim().toLowerCase() };

  let user = await prisma.user.findFirst({
    where: {
      provider: profile.provider,
      providerId: profile.providerId,
    },
  });

  if (user) {
    console.log("[OAuth] Existing provider identity verified");

    if (!StoreData.has(user.userId)) {
      StoreData.set(user.userId, {
        userId: user.userId,
        email: user.email,
        password: user.password || "",
        balance: { usd_balance: user.balanceCents },
        assets: {} as Record<Asset, number>,
      });
      console.log(`[OAuth] Loaded user ${user.userId} into memory store`);
    }

    return user;
  }

  const existingEmailUser = await prisma.user.findFirst({
    where: { email: { equals: profile.email, mode: "insensitive" } },
  });

  if (existingEmailUser) {
    // Linking identities requires an authenticated account flow, never an email match.
    throw new Error(
      "An account with this email exists. Sign in with its original method.",
    );
  }
  if (!profile.emailVerified)
    throw new Error("A verified provider email is required.");

  const userId = uuidv4();
  const initialBalance = INITIAL_BALANCE_CENTS; // $5000 in cents

  user = await prisma.user.create({
    data: {
      userId,
      email: profile.email,
      password: "", // Empty string for OAuth users (not null for compatibility)
      balanceCents: initialBalance,
      provider: profile.provider,
      providerId: profile.providerId,
      emailVerified: true, // OAuth emails are verified
      avatarUrl: profile.avatarUrl,
    },
  });

  CreateUser(userId, profile.email, "", user.balanceCents);

  console.log("[OAuth] New provider identity created");
  return user;
}

export async function isOAuthUser(
  email: string,
): Promise<{ isOAuth: boolean; provider?: string }> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { provider: true },
  });

  if (!user) {
    return { isOAuth: false };
  }

  if (user.provider) {
    return { isOAuth: true, provider: user.provider };
  }

  return { isOAuth: false };
}
