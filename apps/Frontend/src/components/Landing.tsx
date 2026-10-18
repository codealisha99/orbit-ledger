"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
  Activity,
  Check,
  ChevronDown,
  Crosshair,
  Layers3,
  Pause,
  Play,
  ShieldCheck,
} from "lucide-react";

const trace =
  "M0 174 L20 169 L32 178 L48 151 L62 158 L79 142 L95 150 L111 119 L126 130 L142 110 L157 122 L175 85 L191 101 L206 80 L220 94 L238 62 L253 70 L268 45 L285 56 L300 31 L319 40 L337 21 L355 30 L377 9 L400 19";
const questions = [
  [
    "Am I trading real money?",
    "No. OrbitLedger is a paper trading environment. Your balance is virtual, has no cash value, and cannot be deposited or withdrawn. No real assets are bought or sold.",
  ],
  [
    "Where does the market data come from?",
    "Market prices, historical candles, and public trade prints come from Binance. The workspace shows data freshness and historical coverage. A stale quote cannot be used to place a paper trade.",
  ],
  [
    "How are trades simulated?",
    "Executions use a simulated 0.5% spread from the exchange price. Opening a position, adding collateral, and exiting each charge 0.5% of the collateral involved. You can inspect the estimated costs before submitting and review actual simulated execution receipts afterward.",
  ],
  [
    "What happens if the market moves past my stop?",
    "Stops are checked against fresh simulated quotes and can fill beyond your level during a gap. Liquidation takes priority. Losses on a position are capped at its reserved collateral; paper trading does not reproduce every condition of a real exchange.",
  ],
];

export default function Landing({ signedIn = false }: { signedIn?: boolean }) {
  const [side, setSide] = useState<"long" | "short">("long");
  const [leverage, setLeverage] = useState(5);
  const [motion, setMotion] = useState(true);
  const pnl = (side === "long" ? 1 : -1) * 100 * leverage * 0.024;
  const usd = (n: number) =>
    n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
    });
  return (
    <div className="launch" data-motion={motion ? "on" : "off"}>
      <a className="launch-skip" href="#main">
        Skip to content
      </a>
      <header className="launch-nav">
        <Link href="/" className="brand" aria-label="OrbitLedger home">
          <span className="brand-mark">O</span>OrbitLedger
        </Link>
        <nav aria-label="Main navigation">
          <a href="#workspace">The workspace</a>
          <a href="#practice">How it works</a>
          <a href="#questions">Questions</a>
        </nav>
        <div className="launch-nav-actions">
          <Link
            href={signedIn ? "/dashboard" : "/signin"}
            className="launch-login"
          >
            {signedIn ? "Dashboard" : "Sign in"}
          </Link>
          <Link
            href={signedIn ? "/dashboard" : "/signup"}
            className="launch-button small"
          >
            {signedIn ? "Your workspace" : "Get started"}{" "}
            <ArrowUpRight size={15} />
          </Link>
        </div>
      </header>
      <main id="main">
        <section className="launch-hero">
          <div className="launch-orbit" aria-hidden="true">
            <i />
            <i />
            <i />
            <span />
          </div>
          <div className="launch-hero-copy">
            <div className="launch-intro">
              <span />A real market. A place to practice.
            </div>
            <h1>
              Make your
              <br />
              next move
              <br />a better one.
            </h1>
            <p>
              Find your footing in crypto. Trade with virtual funds, understand
              your exposure, and see what every decision really costs.
            </p>
            <div className="launch-hero-actions">
              <Link
                href={signedIn ? "/dashboard" : "/signup"}
                className="launch-button"
              >
                {signedIn ? "Open your Dashboard" : "Create your paper account"}{" "}
                <ArrowUpRight size={19} />
              </Link>
              <a href="#workspace" className="launch-text-link">
                Explore the workspace <ArrowRight size={17} />
              </a>
            </div>
            <div className="launch-assurance">
              <ShieldCheck size={16} />
              Virtual funds. No deposits. No real-money risk.
            </div>
          </div>
          <div className="launch-demo-wrap" id="workspace">
            <div className="launch-demo-caption">
              <span className="launch-live-dot" />
              Inside your next decision <span>Interactive illustration</span>
            </div>
            <div className="launch-demo">
              <div className="launch-demo-top">
                <div>
                  <span className="launch-coin">₿</span>
                  <div>
                    <strong>BTC / USDT</strong>
                    <small>Illustrative market scenario</small>
                  </div>
                </div>
                <Activity size={18} />
              </div>
              <div className="launch-demo-price">
                <div>
                  <small>Market move</small>
                  <strong>
                    +2.40<span>%</span>
                  </strong>
                </div>
                <span className="launch-demo-period">
                  One decision.
                  <br />
                  Two directions.
                </span>
              </div>
              <div className="launch-graph">
                <div className="launch-graph-grid" />
                <svg
                  viewBox="0 0 400 200"
                  role="img"
                  aria-label="Illustrative rising market, up 2.4 percent"
                >
                  <defs>
                    <linearGradient
                      id="launch-fill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="#578cff" stopOpacity=".25" />
                      <stop offset="100%" stopColor="#578cff" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d={`${trace} L400 200 L0 200 Z`}
                    fill="url(#launch-fill)"
                  />
                  <path
                    className="launch-price-line"
                    d={trace}
                    fill="none"
                    stroke="#78a4ff"
                    strokeWidth="2.5"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle cx="400" cy="19" r="4" fill="#b9d4ff" />
                </svg>
                <span className="launch-chart-note">
                  Example price path · not live data
                </span>
              </div>
              <div className="launch-demo-controls">
                <div
                  className="launch-demo-sides"
                  role="group"
                  aria-label="Illustration position direction"
                >
                  <button
                    onClick={() => setSide("long")}
                    aria-pressed={side === "long"}
                  >
                    <ArrowUpRight size={16} />
                    Buy / Long
                  </button>
                  <button
                    onClick={() => setSide("short")}
                    aria-pressed={side === "short"}
                  >
                    <ArrowDownRight size={16} />
                    Sell / Short
                  </button>
                </div>
                <div className="launch-leverage">
                  <span>Try the leverage</span>
                  <div role="group" aria-label="Illustration leverage">
                    {[1, 5, 10].map((n) => (
                      <button
                        key={n}
                        onClick={() => setLeverage(n)}
                        aria-pressed={leverage === n}
                      >
                        {n}×
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="launch-demo-result" aria-live="polite">
                <div>
                  <span>Virtual collateral</span>
                  <b>$100.00</b>
                </div>
                <div>
                  <span>Exposure</span>
                  <b>{usd(100 * leverage)}</b>
                </div>
                <div className={pnl > 0 ? "positive" : "negative"}>
                  <span>Gross result</span>
                  <b key={`${side}-${leverage}`}>
                    {pnl > 0 ? "+" : "−"}
                    {usd(Math.abs(pnl))}
                  </b>
                </div>
              </div>
              <div className="launch-demo-bottom">
                <ShieldCheck size={14} />
                <span>
                  Same market move. {leverage}× exposure.
                  <br />
                  Net result after $1.00 in example fees:{" "}
                  <b>
                    {pnl - 1 > 0 ? "+" : "−"}
                    {usd(Math.abs(pnl - 1))}
                  </b>
                </span>
              </div>
            </div>
            <div className="launch-demo-footnote">
              Try long or short. Change the leverage. Watch the outcome.
            </div>
          </div>
          <a className="launch-scroll" href="#practice">
            <ChevronDown size={17} />A little practice goes a long way
          </a>
        </section>
        <section className="launch-market-strip" aria-label="Supported markets">
          <span>
            Three markets.
            <br />
            Room to learn.
          </span>
          <div>
            <b>₿</b>Bitcoin <small>BTC</small>
          </div>
          <div>
            <b>Ξ</b>Ethereum <small>ETH</small>
          </div>
          <div>
            <b>◎</b>Solana <small>SOL</small>
          </div>
          <span>
            Exchange market data.
            <br />
            Simulated execution.
          </span>
        </section>
        <section className="launch-practice launch-section" id="practice">
          <div className="launch-section-heading">
            <p className="launch-kicker">The practice is the point</p>
            <h2>
              A clearer view.
              <br />A more considered trade.
            </h2>
            <p>
              Move from watching a price to understanding a position. Everything
              you need to practice, with room to think.
            </p>
          </div>
          <div className="launch-steps">
            <article>
              <span className="launch-step-number">01 / Observe</span>
              <div className="launch-feature-symbol">
                <Crosshair />
              </div>
              <h3>Find your moment.</h3>
              <p>
                Read the bigger picture. Explore price history, change your
                timeframe, and follow actual exchange trades as they arrive.
              </p>
              <a href={signedIn ? "/dashboard" : "/signup"}>
                Explore the chart <ArrowUpRight size={16} />
              </a>
            </article>
            <article>
              <span className="launch-step-number">02 / Decide</span>
              <div className="launch-feature-symbol">
                <Layers3 />
              </div>
              <h3>Know what’s at stake.</h3>
              <p>
                See collateral, exposure, estimated liquidation, and costs
                before you commit. Practice sizing a position that makes sense
                to you.
              </p>
              <a href={signedIn ? "/dashboard" : "/signup"}>
                Build a paper position <ArrowUpRight size={16} />
              </a>
            </article>
            <article>
              <span className="launch-step-number">03 / Reflect</span>
              <div className="launch-feature-symbol">
                <Activity />
              </div>
              <h3>Keep the whole story.</h3>
              <p>
                Follow recorded equity, inspect execution receipts, and review
                gross and net results. Learn from the trade after the chart has
                moved on.
              </p>
              <a href={signedIn ? "/dashboard" : "/signup"}>
                Start your record <ArrowUpRight size={16} />
              </a>
            </article>
          </div>
        </section>
        <section className="launch-risk launch-section">
          <div className="launch-risk-visual" aria-hidden="true">
            <div className="launch-risk-rings">
              <i />
              <i />
              <i />
            </div>
            <div className="launch-risk-core">
              <ShieldCheck size={40} />
              <span>
                Practice with
                <br />
                <strong>perspective.</strong>
              </span>
            </div>
            <div className="launch-orbit-label one">Collateral</div>
            <div className="launch-orbit-label two">Exposure</div>
            <div className="launch-orbit-label three">Costs</div>
            <div className="launch-orbit-label four">Outcome</div>
          </div>
          <div>
            <p className="launch-kicker">Confidence starts with clarity</p>
            <h2>
              Take the risk
              <br />
              out of learning
              <br />
              about risk.
            </h2>
            <p className="launch-body">
              Leverage makes both sides of a trade bigger. Build an
              understanding of it before putting real money on the line.
            </p>
            <ul>
              <li>
                <Check size={17} />
                Clearly separated cash and reserved collateral
              </li>
              <li>
                <Check size={17} />
                Visible spread, fees, and liquidation estimates
              </li>
              <li>
                <Check size={17} />
                Stop loss, take profit, and trailing protection
              </li>
              <li>
                <Check size={17} />A durable record of your simulated executions
              </li>
            </ul>
            <Link
              href={signedIn ? "/dashboard" : "/signup"}
              className="launch-text-link"
            >
              Give yourself room to learn <ArrowRight size={18} />
            </Link>
          </div>
        </section>
        <section className="launch-faq launch-section" id="questions">
          <div>
            <p className="launch-kicker">Before your first move</p>
            <h2>
              A few things
              <br />
              to know.
            </h2>
            <p>Clear expectations are part of a good start.</p>
          </div>
          <div>
            {questions.map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <span>
                    <ChevronDown size={18} />
                  </span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="launch-final">
          <div className="launch-final-orbit" aria-hidden="true" />
          <p>Your next chapter starts with practice.</p>
          <h2>
            The market keeps moving.
            <br />
            Make your move count.
          </h2>
          <Link
            href={signedIn ? "/dashboard" : "/signup"}
            className="launch-button"
          >
            {signedIn ? "Return to Dashboard" : "Start paper trading"}{" "}
            <ArrowUpRight size={20} />
          </Link>
          <span>Free to practice. Virtual funds only.</span>
        </section>
      </main>
      <footer className="launch-footer">
        <div>
          <Link href="/" className="brand">
            <span className="brand-mark">O</span>OrbitLedger
          </Link>
          <p>
            A little more understanding.
            <br />A little less guesswork.
          </p>
        </div>
        <div className="launch-footer-links">
          <a href="#workspace">Workspace</a>
          <Link href={signedIn ? "/dashboard" : "/signin"}>Sign in</Link>
          <Link href={signedIn ? "/dashboard" : "/signup"}>Create account</Link>
          <button onClick={() => setMotion((v) => !v)} aria-pressed={!motion}>
            {motion ? <Pause size={13} /> : <Play size={13} />}
            {motion ? "Pause motion" : "Resume motion"}
          </button>
        </div>
        <p className="launch-legal">
          A simulated trading environment for education and practice. Virtual
          funds have no cash value. Simulated performance does not predict real
          trading results. Not investment advice.
        </p>
        <span className="launch-copyright">
          © {new Date().getFullYear()} OrbitLedger
        </span>
      </footer>
    </div>
  );
}
