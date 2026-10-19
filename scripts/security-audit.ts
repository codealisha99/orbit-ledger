// Fail closed on new advisories. The one exception is a locally patched build dependency.
import { readFileSync } from "node:fs";
const result = Bun.spawnSync(["bun", "audit", "--json"], {
  stdout: "pipe",
  stderr: "pipe",
});
let report: Record<string, { url: string; severity: string }[]>;
try {
  report = JSON.parse(new TextDecoder().decode(result.stdout));
} catch {
  console.error(
    "Dependency advisory service unavailable or invalid audit response",
  );
  process.exit(1);
}
const patch = readFileSync("patches/braces@3.0.3.patch", "utf8");
const patched =
  patch.includes("stack.length >= 128") &&
  patch.includes("Brace nesting exceeds");
let failures = 0,
  mitigated = 0;
for (const [name, advisories] of Object.entries(report))
  for (const advisory of advisories) {
    if (
      name === "braces" &&
      advisory.url.endsWith("GHSA-vfj7-8cjw-p6xm") &&
      patched &&
      Date.now() < Date.parse("2026-11-19")
    ) {
      mitigated++;
      continue;
    }
    console.error(`${advisory.severity}: ${name} ${advisory.url}`);
    failures++;
  }
console.log(
  `${failures} unmitigated advisories; ${mitigated} patched build-tool advisory (exception expires 2026-11-19).`,
);
process.exit(failures ? 1 : 0);
