import { defineConfig } from "prisma/config";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envCandidates = [
  ".env",
  "../.env",
  "../../.env",
  "../../apps/Backend/.env",
];

for (const candidate of envCandidates) {
  const envPath = resolve(process.cwd(), candidate);
  if (existsSync(envPath)) {
    loadEnv({ path: envPath, override: false });
  }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
