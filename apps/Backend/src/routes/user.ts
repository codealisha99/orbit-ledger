import jwt from "jsonwebtoken";
import {
  securitySecret,
  TOKEN_ISSUER,
  WS_AUDIENCE,
} from "@orbitledger/shared/security";
import { Router } from "express";
import type { Request, Response } from "express";
import { v5 as uuidv5 } from "uuid"; //Generates same ID for same email
import { INITIAL_BALANCE_CENTS, CreateUser, findUSerId } from "../data/store";
import { generateToken } from "../utils/jwt";
import { hashPassword, comparePassword } from "../utils/password";
import { authMiddleware } from "../middleware/auth";
import {
  authRateLimit,
  authAccountRateLimit,
  apiRateLimit,
} from "../middleware/rateLimit";
import type { SignupRequest, SigninRequest } from "../types";
import { signupSchema, signinSchema } from "../types";
import { fromInternalUSD } from "@orbitledger/shared";
import { prisma, Prisma } from "@orbitledger/database";

const UUID_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
export const userRouter = Router(); // To organise ROutes

userRouter.post(
  "/signup",
  authRateLimit,
  async (req: Request, res: Response): Promise<void> => {
    try {
      let { email, password } = req.body as SignupRequest;
      console.log("[SECURITY] Account authentication/read event");

      const validate = signupSchema.safeParse({ email, password });
      if (!validate.success) {
        res
          .status(400)
          .json({ error: "Invalid Input", details: validate.error.issues });
        return;
      }
      email = email.trim().toLowerCase();
      const exsistingUser = await prisma.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
      });
      if (exsistingUser) {
        console.log("[SECURITY] Account authentication/read event");
        res.status(409).json({ error: "User already exists" });
        return;
      }
      const UserId = uuidv5(email, UUID_NAMESPACE);
      console.log("[SECURITY] Account authentication/read event");

      const hashedPassword = await hashPassword(password);
      await prisma.user.create({
        data: {
          userId: UserId,
          email: email,
          password: hashedPassword,
          balanceCents: INITIAL_BALANCE_CENTS,
        },
      });
      const newUser = CreateUser(
        UserId,
        email,
        hashedPassword,
        INITIAL_BALANCE_CENTS,
      );
      const newToken = await generateToken(UserId);

      res.status(201).json({
        message: "User created successfully",
        userId: newUser.userId,
        token: newToken,
      });
      console.log("[SECURITY] Account authentication/read event");
    } catch (err) {
      console.error("[SIGNUP] Error", err);
      res.status(500).json({ error: "Internal server error in signup" });
    }
  },
);

userRouter.post(
  "/signin",
  authRateLimit,
  authAccountRateLimit,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { email, password } = req.body as SigninRequest;
      const validate = signinSchema.safeParse({ email, password });
      if (!validate.success) {
        res.status(400).json({
          error: "Invalid Input",
          details: validate.error.issues,
        });
        return;
      }
      console.log("[SECURITY] Account authentication/read event");
      let user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        const matches = await prisma.user.findMany({
          where: { email: { equals: email, mode: "insensitive" } },
          take: 2,
        });
        if (matches.length === 1) user = matches[0]!;
      }
      if (!user) {
        await comparePassword(password, "");
        console.log("[SECURITY] Sign-in failed");
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }

      const isPasswordValid = await comparePassword(password, user.password);
      if (!isPasswordValid) {
        console.log("[SECURITY] Account authentication/read event");
        res.status(401).json({ error: "Invalid credentials" });
        return;
      }
      const token = await generateToken(user.userId);
      const inMemory = findUSerId(user.userId);
      if (!inMemory) {
        CreateUser(user.userId, user.email, user.password, user.balanceCents);
        console.log(
          `[SIGNIN] User ${user.userId} loaded into memory from database`,
        );
      }
      res.status(200).json({
        message: "Login successful",
        userId: user.userId,
        token: token,
      });
      console.log("[SECURITY] Account authentication/read event");
    } catch (err) {
      console.error("[SIGNIN] Error", err);
      res.status(500).json({ error: "Internal server error in signin" });
    }
  },
);

userRouter.get(
  "/balance",
  authMiddleware,
  apiRateLimit,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      console.log("[SECURITY] Account authentication/read event");
      const user = await prisma.user.findUnique({ where: { userId } });
      if (!user) {
        console.log("[SECURITY] Account authentication/read event");
        res.status(404).json({ error: "User not found" });
        return;
      }
      const balanceusd = fromInternalUSD(user.balanceCents);
      res.status(200).json({
        userId: user.userId,
        email: user.email,
        balance: {
          usd: balanceusd, // $5000
          cents: user.balanceCents, // 500000
        },
        assets: {}, // Crypto holdings (for future)
      });
      console.log("[SECURITY] Account authentication/read event");
    } catch (err) {
      console.error("[BALANCE] Error", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

userRouter.get("/ws-ticket", authMiddleware, apiRateLimit, (req, res) => {
  res.json({
    ticket: jwt.sign(
      { userId: req.userId, sessionId: req.sessionId, purpose: "websocket" },
      securitySecret(),
      {
        algorithm: "HS256",
        issuer: TOKEN_ISSUER,
        audience: WS_AUDIENCE,
        expiresIn: Math.max(
          1,
          Math.min(
            60,
            Math.floor((req.sessionExpiresAt!.getTime() - Date.now()) / 1000),
          ),
        ),
      },
    ),
  });
});

userRouter.post("/logout", authMiddleware, apiRateLimit, async (req, res) => {
  await prisma.authSession.deleteMany({
    where: { id: req.sessionId, userId: req.userId },
  });
  res.json({ ok: true });
});

userRouter.post(
  "/logout-all",
  authMiddleware,
  apiRateLimit,
  async (req, res) => {
    await prisma.authSession.deleteMany({ where: { userId: req.userId } });
    res.json({ ok: true });
  },
);
