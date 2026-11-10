# Brand — OrbitLedger

_Status: active · Direction: Terminal Study_
_Defined 2026-11-10 · Source of truth for all UI decisions._

OrbitLedger is a crypto **paper-trading practice** app: real market data,
simulated execution, virtual funds. Its users are learning — the design must
feel like a precise instrument they trust, not a casino.

## Design philosophy

A quiet trading terminal. The market is loud; the tool is calm. Numbers are
exact, borders are hairlines, color appears only when it means something
(direction, risk, action). Craft over decoration.

- **Motion:** crisp and short (120–320ms), no bounce, no parallax. Data updates
  are settled (150ms); entrances are staged and ≤400ms. Respect reduced motion.
- **Density:** comfortable inside the dashboard, compact inside the trading
  workspace. Whitespace signals confidence on marketing pages.
- **Elevation:** by surface shade, never heavy shadows. One elevated layer
  (dialogs, menus) may use a soft shadow.

## Palette

Two seeds (amber accent + warm ink neutrals) generate both themes through CSS
vars `--nt-*` in `apps/Frontend/src/app/globals.css`. Never hardcode hex in
components.

| Token | Dark (default) | Light |
| --- | --- | --- |
| bg | `#141412` warm near-black | `#f6f4f0` warm paper |
| surface | `#1a1a17` | `#fdfcfa` |
| surface2 (raised) | `#22221f` | `#f1efeb` |
| border | `#2b2b28` hairline | `#dedbd4` |
| text | `#eceae5` | `#1c1b18` |
| muted | `#9b988f` | `#6d695f` |
| accent (amber, practice/action) | `#e0a33e` | `#8a5a14` |
| buy (positive) | `#4faa74` | `#14724a` |
| sell (negative) | `#d97b82` | `#b03a42` |

Rules: single accent + grayscale. Buy/sell colors always pair with `+/−` signs.
Semantic colors only — never decorative. Focus rings are amber everywhere.

## Typography

- **IBM Plex Sans** — interface voice. 400/500/600 only. Tight tracking on
  headings (-0.02 to -0.03em).
- **IBM Plex Mono** — every number, price, OHLC, timestamp, metric. Loaded via
  `next/font`; `tabular-nums` everywhere.
- Scale: 11 / 12 / 13 / 14 (body) / 16 / 20 / 26 / 42 / 64 (display, marketing
  only). Max 3 weights visible at a time.

## Voice

Calm, concrete brief. Second person where it helps. No hype words
("revolutionize", "unlock"), no hedging. State what the thing does.
Examples: "A real market. A place to practice." — "Know what it costs before
you commit." — "Every trade, fully explained."

## Anti-patterns (banned)

- Violet/blue gradients, glassmorphism, glow.
- Uniform card grids with identical shadows.
- Decorative motion, bouncing, parallax.
- Numbers in the sans font; mixed-font numerals.
- Pure `#000` and pure `#fff` in product UI.
