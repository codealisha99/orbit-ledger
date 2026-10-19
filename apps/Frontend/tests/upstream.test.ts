import { expect, test } from "bun:test";
import { ApiUpstream, ServiceUnavailable } from "../src/lib/server/upstream";

test("incompatible deployments cannot receive signup or account requests", async () => {
  let checks = 0;
  const upstream = new ApiUpstream(
    "https://api.example.test/api/v2",
    (async () => {
      checks++;
      return Response.json({ status: "ok" });
    }) as typeof fetch,
  );
  await expect(upstream.assertCompatible()).rejects.toBeInstanceOf(
    ServiceUnavailable,
  );
  await expect(upstream.assertCompatible()).rejects.toBeInstanceOf(
    ServiceUnavailable,
  );
  expect(checks).toBe(2);
});
test("compatible health checks are deduplicated and cached across requests", async () => {
  let checks = 0;
  const upstream = new ApiUpstream("https://api.example.test/", (async () => {
    checks++;
    await Promise.resolve();
    return Response.json({
      apiContract: 2,
      capabilities: { revocableSessions: true },
    });
  }) as typeof fetch);
  await Promise.all([upstream.assertCompatible(), upstream.assertCompatible()]);
  await upstream.assertCompatible();
  expect(checks).toBe(1);
  expect(upstream.target(["trade", "summary"], "?after=2").href).toBe(
    "https://api.example.test/api/v2/trade/summary?after=2",
  );
});
test("trailing slashes cannot produce undefined backend routes", () => {
  const upstream = new ApiUpstream("https://api.example.test/api/v2///");
  expect(upstream.target(["user", "signin"], "").pathname).toBe(
    "/api/v2/user/signin",
  );
});
test("non-JSON and failed health responses are recoverable service errors", async () => {
  const upstream = new ApiUpstream(
    "https://api.example.test",
    (async () => new Response("Unavailable", { status: 502 })) as typeof fetch,
  );
  await expect(upstream.assertCompatible()).rejects.toBeInstanceOf(
    ServiceUnavailable,
  );
});
