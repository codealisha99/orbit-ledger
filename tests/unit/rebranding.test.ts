import { describe, expect, test } from "bun:test";
import { TOKEN_ISSUER, ALLOWED_ISSUERS, SESSION_AUDIENCE, WS_AUDIENCE } from "../../packages/shared/src/security";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Paper Ship Rebranding Audit", () => {
  test("Metadata specifies Paper Ship and canonical domain papership.today", () => {
    const layout = readFileSync(join(process.cwd(), "apps/Frontend/src/app/layout.tsx"), "utf8");
    expect(layout).toContain('default: "Paper Ship — Crypto Paper Trading"');
    expect(layout).toContain('canonical: "https://papership.today"');
    expect(layout).toContain('metadataBase: new URL("https://papership.today")');
    expect(layout).toContain("papership-theme");
  });

  test("Security JWT Issuer is papership", () => {
    expect(TOKEN_ISSUER).toBe("papership");
    expect(ALLOWED_ISSUERS).toEqual(["papership"]);
    expect(SESSION_AUDIENCE).toBe("papership:api");
    expect(WS_AUDIENCE).toBe("papership:ws");
  });

  test("Brand document defines Paper Ship and canonical domain", () => {
    const brand = readFileSync(join(process.cwd(), "brand.md"), "utf8");
    expect(brand).toContain("# Brand — Paper Ship");
    expect(brand).toContain("PaperShip.today");
  });

  test("README documents Paper Ship and PaperShip.today", () => {
    const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");
    expect(readme).toContain("# Paper Ship");
    expect(readme).toContain("PaperShip.today");
  });

  test("Frontend UI components display Paper Ship brand name", () => {
    const header = readFileSync(join(process.cwd(), "apps/Frontend/src/components/AppHeader.tsx"), "utf8");
    expect(header).toContain("Paper Ship");
    expect(header).toContain('aria-label="Paper Ship home"');

    const landing = readFileSync(join(process.cwd(), "apps/Frontend/src/components/Landing.tsx"), "utf8");
    expect(landing).toContain("Paper Ship");
    expect(landing).toContain('aria-label="Paper Ship home"');

    const authForm = readFileSync(join(process.cwd(), "apps/Frontend/src/components/AuthForm.tsx"), "utf8");
    expect(authForm).toContain("Paper Ship");
  });
});
