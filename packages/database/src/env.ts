import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const envCandidates = [
  resolve(currentDir, ".env"),
  resolve(currentDir, "..", ".env"),
  resolve(currentDir, "..", "..", ".env"),
  resolve(currentDir, "..", "..", "..", ".env"),
  resolve(currentDir, "..", "..", "..", "apps", "Backend", ".env"),
];

for (const candidate of envCandidates) {
  if (existsSync(candidate)) {
    loadEnv({ path: candidate, override: false });
  }
}
