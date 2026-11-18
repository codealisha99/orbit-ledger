import { prisma } from "@papership/database";
import { v4 as uuidv4 } from "uuid";
import { INITIAL_BALANCE_CENTS, StoreData, CreateUser } from "../data/store";
import type { Asset } from "@papership/shared";

export interface OAuthProfile {
  provider: "google" | "github";
  providerId: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
}

export async function findOrCreateOAuthUser(profile: OAuthProfile) {
  const normalizedEmail = profile.email.trim().toLowerCase();
  profile = { ...profile, email: normalizedEmail };

  // 1. Look up existing ProviderIdentity by (provider, providerAccountId)
  const existingIdentity = await prisma.providerIdentity.findUnique({
    where: {
      provider_providerAccountId: {
        provider: profile.provider,
        providerAccountId: profile.providerId,
      },
    },
    include: { user: true },
  });

  if (existingIdentity?.user) {
    const user = existingIdentity.user;
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

  // 2. Fallback check for legacy user record with provider columns
  const legacyUser = await prisma.user.findFirst({
    where: {
      provider: profile.provider,
      providerId: profile.providerId,
    },
  });

  if (legacyUser) {
    console.log("[OAuth] Backfilling legacy provider identity into provider_identities table");
    await prisma.providerIdentity.upsert({
      where: {
        provider_providerAccountId: {
          provider: profile.provider,
          providerAccountId: profile.providerId,
        },
      },
      create: {
        userId: legacyUser.userId,
        provider: profile.provider,
        providerAccountId: profile.providerId,
        email: profile.email,
      },
      update: {},
    });

    if (!StoreData.has(legacyUser.userId)) {
      StoreData.set(legacyUser.userId, {
        userId: legacyUser.userId,
        email: legacyUser.email,
        password: legacyUser.password || "",
        balance: { usd_balance: legacyUser.balanceCents },
        assets: {} as Record<Asset, number>,
      });
    }

    return legacyUser;
  }

  // 3. Security invariant: never silently auto-merge accounts by unverified or unauthenticated email match
  const existingEmailUser = await prisma.user.findFirst({
    where: { email: { equals: normalizedEmail, mode: "insensitive" } },
  });

  if (existingEmailUser) {
    const error = new Error(
      "An account with this email exists. Sign in with your original method (password) to link your provider.",
    );
    error.name = "AccountExistsLinkRequired";
    throw error;
  }

  if (!profile.emailVerified) {
    throw new Error("A verified provider email is required.");
  }

  // 4. Create new user and associated ProviderIdentity
  const userId = uuidv4();
  const initialBalance = INITIAL_BALANCE_CENTS; // $5000 in cents

  const user = await prisma.user.create({
    data: {
      userId,
      email: normalizedEmail,
      password: "", // Empty string for OAuth users (not null for compatibility)
      balanceCents: initialBalance,
      provider: profile.provider,
      providerId: profile.providerId,
      emailVerified: true,
      avatarUrl: profile.avatarUrl,
      identities: {
        create: {
          provider: profile.provider,
          providerAccountId: profile.providerId,
          email: normalizedEmail,
        },
      },
    },
  });

  CreateUser(userId, normalizedEmail, "", user.balanceCents);

  console.log("[OAuth] New user and provider identity created");
  return user;
}

export async function linkProviderIdentity(
  userId: string,
  profile: OAuthProfile,
) {
  if (!profile.emailVerified) {
    throw new Error("A verified provider email is required.");
  }

  const normalizedEmail = profile.email.trim().toLowerCase();

  // Check if provider identity is already linked to any account
  const existingIdentity = await prisma.providerIdentity.findUnique({
    where: {
      provider_providerAccountId: {
        provider: profile.provider,
        providerAccountId: profile.providerId,
      },
    },
  });

  if (existingIdentity) {
    if (existingIdentity.userId === userId) {
      return { ok: true, alreadyLinked: true };
    }
    throw new Error(
      "This provider account is already linked to another Paper Ship user.",
    );
  }

  // Check legacy user columns as well
  const legacyOwner = await prisma.user.findFirst({
    where: {
      provider: profile.provider,
      providerId: profile.providerId,
    },
  });

  if (legacyOwner && legacyOwner.userId !== userId) {
    throw new Error(
      "This provider account is already linked to another Paper Ship user.",
    );
  }

  // Link to this user
  await prisma.providerIdentity.create({
    data: {
      userId,
      provider: profile.provider,
      providerAccountId: profile.providerId,
      email: normalizedEmail,
    },
  });

  // If user has no avatar or legacy provider set, update it
  await prisma.user.update({
    where: { userId },
    data: {
      avatarUrl: profile.avatarUrl || undefined,
      emailVerified: true,
    },
  });

  console.log(`[OAuth] Linked ${profile.provider} to user ${userId}`);
  return { ok: true, alreadyLinked: false };
}

export async function unlinkProviderIdentity(
  userId: string,
  provider: "google" | "github",
) {
  const user = await prisma.user.findUnique({
    where: { userId },
    include: { identities: true },
  });

  if (!user) {
    throw new Error("User not found.");
  }

  const hasPassword = Boolean(user.password && user.password.length > 0);
  const totalIdentities = user.identities.length;
  const targetIdentity = user.identities.find((i) => i.provider === provider);

  if (!targetIdentity) {
    throw new Error(`${provider} is not linked to this account.`);
  }

  // Prevent users from disconnecting their only usable authentication method
  if (!hasPassword && totalIdentities <= 1) {
    throw new Error(
      "Cannot disconnect your only sign-in method. Set a password or connect another provider first.",
    );
  }

  await prisma.providerIdentity.delete({
    where: { id: targetIdentity.id },
  });

  // If user table's legacy provider matches the one being removed, clear it
  if (user.provider === provider) {
    const remaining = user.identities.find((i) => i.id !== targetIdentity.id);
    await prisma.user.update({
      where: { userId },
      data: {
        provider: remaining ? remaining.provider : null,
        providerId: remaining ? remaining.providerAccountId : null,
      },
    });
  }

  console.log(`[OAuth] Unlinked ${provider} from user ${userId}`);
  return { ok: true };
}

export async function getUserAuthMethods(userId: string) {
  const user = await prisma.user.findUnique({
    where: { userId },
    include: {
      identities: {
        select: {
          id: true,
          provider: true,
          providerAccountId: true,
          email: true,
          createdAt: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  return {
    hasPassword: Boolean(user.password && user.password.length > 0),
    email: user.email,
    identities: user.identities,
    providers: user.identities.map((i) => i.provider),
  };
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
