import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
export default function Home() {
  return (
    <div className="workspace">
      <header className="app-header">
        <Link href="/" className="brand">
          <span className="brand-mark">O</span>OrbitLedger
        </Link>
        <div className="header-account">
          <ThemeToggle />
          <Link className="quiet" href="/signin">
            Sign in
          </Link>
          <Link className="primary" href="/signup">
            Create paper account
          </Link>
        </div>
      </header>
      <main className="landing">
        <section className="landing-hero">
          <h1>
            Practice the trade.
            <br />
            Understand the outcome.
          </h1>
          <p>
            A focused crypto paper trading workspace for BTC, ETH, and SOL. Work
            with virtual funds, see your costs before trading, and learn from a
            record of every decision.
          </p>
          <div className="landing-actions">
            <Link className="primary" href="/signup">
              Start paper trading
            </Link>
            <Link className="quiet" href="/signin">
              Return to your account
            </Link>
          </div>
        </section>
        <section className="landing-features">
          <div>
            <h2>Read the market</h2>
            <p>
              Explore exchange price history with separate candle interval and
              date range controls. See when history is incomplete and when
              quotes are stale.
            </p>
          </div>
          <div>
            <h2>Know your exposure</h2>
            <p>
              Preview collateral, leverage, fees, and estimated liquidation
              before opening a position. All execution is simulated; virtual
              funds carry no cash value.
            </p>
          </div>
          <div>
            <h2>Review what happened</h2>
            <p>
              Follow your account’s actual equity, inspect position receipts,
              and export completed trades with gross and net results.
            </p>
          </div>
        </section>
        <footer className="app-footer">
          OrbitLedger is a practice environment. Simulated quotes include a
          spread and fees. No real assets are bought or sold.
        </footer>
      </main>
    </div>
  );
}
