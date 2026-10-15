# CLAUDE.md

TopShelf is a Chrome MV3 extension that re-ranks Amazon search results
best-first using only on-page data. Plain classic JavaScript — no build
step, no dependencies, no frameworks, no modules. The repo root IS the
extension; load it unpacked at chrome://extensions.

## Commands
- Run tests: `node tests/run.js` — the only test command. Loads
  src/scorer.js into a vm sandbox (no window/document/chrome exist there,
  which also enforces the scorer's purity) and checks tests/fixtures.js.
  Also runs src/scraper.js over saved search pages in tests/pages/ via a
  tiny built-in DOM (tests/dom.js); expectations in tests/scraper-pages.js.
- Render icons: `node scripts/render-icons.mjs` (needs sharp/ImageMagick/
  Inkscape/librsvg). PNGs are committed but can be regenerated.
- Manual verification: reload the extension, reload an Amazon search.
  Top tiles carry rank badges; the chip shows ranked/hidden counts.
- Package for the Chrome Web Store: `scripts/package.sh` (version from
  manifest.json; refuses to build unless rendered PNG icons exist).

## Architecture
Pipeline: scraper.js (DOM → data) → scorer.js (data → scores) →
content.js (render + observe). Load order in manifest.json matters.
- **scorer.js is PURE**: zero DOM, zero chrome.*. All ranking logic lives
  here so it stays unit-testable. Do not add DOM or storage access to it.
- All Amazon CSS selectors live in the **SELECTORS** const at the top of
  scraper.js — the single point of repair when Amazon changes markup.
- content.js only **MOVES** Amazon's nodes (appendChild), never removes
  them. It snapshots original ASIN order for the Ranked/Original toggle
  and guards its MutationObserver with a `reordering` flag so our own
  writes don't retrigger the pipeline into a loop.
- Knockoff interop: data-ko-verdict / data-ko-brand tile attributes are
  an OPTIONAL signal set by a separate extension. Absent = neutral.
  Never require them.

## Scoring spec (v1)
Inputs per tile: rating (1–5 | null), reviews (int | null),
price (float | null), sponsored (bool), koVerdict (str | null).

```
page prior m = mean rating over tiles with a rating (fallback 3.5 if none)
confidence C = 50

base = (C*m + rating*reviews) / (C + reviews)     // Bayesian average
       no rating → base = m − 0.3                 // unknown ≠ bad, but demoted

multipliers (compounding):
  sponsored             × 0.85   (or hidden, per setting; "off" leaves alone)
  review-farm profile   × 0.80   (rating ≥ 4.8 && reviews < 100)
  koVerdict "suspect"   × 0.60
  koVerdict "known"     × 1.05
  koVerdict "flagged"   → hidden = true, score = 0

VALUE mode: score = base_after_multipliers / log10(price + 10)
            (null/zero price → quality score, unchanged)

hide floor (setting) — judged on `base` (quality, same scale as m), NOT the
final score; multipliers and value mode reorder but never trip the floor:
  off        → nothing hidden except koVerdict "flagged" (+ sponsored=hide)
  standard   → hidden if base < m − 0.6
  aggressive → hidden if base < m − 0.3
```

Every multiplier that fires pushes a human-readable string into reasons[] —
that array IS the badge popover content.

## Conventions and judgment calls
- **Zero network requests, ever.** Don't add fetches to any code path.
- **Wrongly demoting a good product is worse than letting a mediocre one
  rank high.** Bias heuristic tuning accordingly. Never hide on a single
  soft signal (e.g. review-farm profile alone).
- **Every new scoring signal ships with a fixture** in tests/fixtures.js
  and a human-readable entry in reasons[] (the badge popover shows it).
- **Every scraped field is optional**; missing data is null and must never
  throw or produce a NaN score.
- Match existing style: plain ES5-ish JavaScript, comments explain *why*.
