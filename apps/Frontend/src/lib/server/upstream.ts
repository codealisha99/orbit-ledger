export class ServiceUnavailable extends Error {
  readonly code = "SERVICE_UNAVAILABLE";
}
// A newer frontend must not create sessions against an incompatible API.
// Health checks are deduplicated and cached briefly; failures are never cached.
export class ApiUpstream {
  private compatibleUntil = 0;
  private checking: Promise<void> | null = null;
  private base: URL;
  constructor(
    base: string,
    private transport: typeof fetch = fetch,
  ) {
    this.base = new URL(base);
    this.base.pathname = this.base.pathname.replace(/\/+$/, "") || "/api/v2";
    this.base.search = "";
    this.base.hash = "";
  }
  target(path: string[], search: string) {
    const target = new URL(
      `${this.base.href}/${path.map(encodeURIComponent).join("/")}`,
    );
    target.search = search;
    return target;
  }
  async assertCompatible() {
    if (Date.now() < this.compatibleUntil) return;
    if (this.checking) return this.checking;
    this.checking = (async () => {
      try {
        const response = await this.transport(new URL("/health", this.base), {
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        const health = await response.json();
        if (
          !response.ok ||
          health.apiContract !== 2 ||
          health.capabilities?.revocableSessions !== true
        ) {
          throw new ServiceUnavailable(
            "The trading service is being updated. Please try again shortly.",
          );
        }
        this.compatibleUntil = Date.now() + 15000;
      } catch (error) {
        if (error instanceof ServiceUnavailable) throw error;
        throw new ServiceUnavailable(
          "The trading service is temporarily unavailable. Please try again shortly.",
        );
      }
    })();
    try {
      await this.checking;
    } finally {
      this.checking = null;
    }
  }
}
