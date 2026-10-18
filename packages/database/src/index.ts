import { PrismaClient } from "../generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const envCandidates = [
  resolve(currentDir, ".env"),
  resolve(currentDir, "..", ".env"),
  resolve(currentDir, "..", "..", ".env"),
  resolve(currentDir, "..", "..", "..", "apps", "Backend", ".env"),
];

for (const candidate of envCandidates) {
  if (existsSync(candidate)) {
    loadEnv({ path: candidate, override: false });
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter }); //created one shared instance
export * from "../generated/prisma/index.js"; //exporting eveything
 