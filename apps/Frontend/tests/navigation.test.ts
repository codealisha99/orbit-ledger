import { expect, test } from "bun:test";
import { resolveDestination } from "../src/lib/navigation";
test("signed-in home defaults to dashboard and preserves intended internal destinations", () => {
  expect(resolveDestination(null)).toBe("/dashboard");
  expect(resolveDestination(["/trading", "/signin"])).toBe("/dashboard");
  expect(
    resolveDestination("/trading?market=SOL&tab=history#account-activity"),
  ).toBe("/trading?market=SOL&tab=history#account-activity");
  expect(resolveDestination("/")).toBe("/");
});
test("auth destinations cannot leave the site or loop into authentication", () => {
  for (const value of [
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "/signin",
    "/signup?next=/signin",
    "/auth/callback",
    "/path\nredirect",
  ])
    expect(resolveDestination(value)).toBe("/dashboard");
});
