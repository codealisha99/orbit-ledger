import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { StartWs } from "./websocket-server";

const envCandidates = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "../Backend/.env"),
  resolve(process.cwd(), "../../apps/Backend/.env"),
];

for (const candidate of envCandidates) {
  if (existsSync(candidate)) {
    loadEnv({ path: candidate, override: false });
  }
}

async function main() {
  await StartWs();
}
main();
