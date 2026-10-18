// Read-only checks. Run after deploying all services, not just the frontend.
const [site, api, websocket] = process.argv.slice(2);
if (!site || !api || !websocket) {
  console.error(
    "Usage: bun scripts/verify-release.ts <site-origin> <api-origin> <websocket-http-origin>",
  );
  process.exit(1);
}
const checks = [
  [
    "API contract",
    new URL("/health", api),
    200,
    (v: any) => v.apiContract === 2 && v.capabilities?.workspace === true,
  ],
  ["API readiness", new URL("/ready", api), 200, (v: any) => v.ready === true],
  [
    "WebSocket readiness",
    new URL("/ready", websocket),
    200,
    (v: any) => v.ready === true,
  ],
  [
    "Frontend account routing",
    new URL("/api/bridge/trade/summary", site),
    401,
    (v: any) =>
      typeof v.error === "string" && !v.error.includes("Route Not Found"),
  ],
  [
    "Private workspace routing",
    new URL("/api/bridge/user/workspace", site),
    401,
    (v: any) => typeof v.error === "string",
  ],
  [
    "Frontend market routing",
    new URL("/api/bridge/asset/stats", site),
    200,
    (v: any) => v && typeof v === "object",
  ],
] as const;
let failed = false;
for (const [name, url, status, valid] of checks) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    const passed = response.status === status && valid(await response.json());
    console.log(
      `${passed ? "PASS" : "FAIL"} ${name} (HTTP ${response.status})`,
    );
    failed ||= !passed;
  } catch {
    console.log(`FAIL ${name} (unreachable or invalid response)`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
