import { test, expect } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const tailwind = createRequire(
  require.resolve("tailwindcss", { paths: [process.cwd() + "/apps/Frontend"] }),
);
const micromatch = createRequire(tailwind.resolve("micromatch"));
const braces = micromatch("braces");
test("patched build parser rejects excessive brace and parenthesis nesting", () => {
  expect(braces("src/{one,two}/*.ts")).toEqual(["src/(one|two)/*.ts"]);
  for (const [open, close] of [
    ["{", "}"],
    ["(", ")"],
  ]) {
    expect(() =>
      braces.parse(open.repeat(2000) + "a,b" + close.repeat(2000)),
    ).toThrow("security limit");
  }
});
