import { prisma } from "@orbitledger/database";
import { v4 as uuidv4 } from "uuid";
import { StoreData, CreateUser } from "../data/store";
import type { Asset } from "@orbitledger/shared";

export interface OAuthProfile {
  provider: "google" | "github";
  providerId: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

export async function findOrCreateOAuthUser(profile: OAuthProfile) {
  console.log(
    `[OAuth] Processing ${profile.provider} login for: ${profile.email}`
  );

  let user = await prisma.user.findFirst({
    where: {
      provider: profile.provider,
      providerId: profile.providerId,
    },
  });

  if (user) {
    console.log(
      `[OAuth] Existing ${profile.provider} user found: ${user.email}`
    );

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

  const existingEmailUser = await prisma.user.findUnique({
    where: { email: profile.email },
  });

  if (existingEmailUser) {
    if (!existingEmailUser.provider) {
      user = await prisma.user.update({
        where: { email: profile.email },
        data: {
          provider: profile.provider,
          providerId: profile.providerId,
          emailVerified: true,
          avatarUrl: profile.avatarUrl,
        },
      });
      console.log(
        `[OAuth] Linked ${profile.provider} to existing user: ${user.email}`
      );

      const memoryUser = StoreData.get(user.userId);
      if (memoryUser) {
        StoreData.set(user.userId, memoryUser);
      }

      return user;
    } else if (existingEmailUser.provider !== profile.provider) {
      throw new Error(
        `Email already registered with ${existingEmailUser.provider}. Please sign in with ${existingEmailUser.provider}.`
      );
    } else {
      return existingEmailUser;
    }
  }

  const userId = uuidv4();
  const initialBalance = 500000; // $5000 in cents

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

  CreateUser(userId, profile.email, "");

  console.log(`[OAuth] Created new ${profile.provider} user: ${user.email}`);
  return user;
}

export async function isOAuthUser(
  email: string
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
