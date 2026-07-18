# TopShelf

**Amazon, best products first.**

TopShelf re-ranks Amazon search results by statistically honest quality,
demotes review-farmed and sponsored listings, and pairs with
[Knockoff](#pairs-with-knockoff) to hide the junk entirely. It runs
entirely in your browser: **no accounts, no analytics, no tracking, zero
network requests.**

A 4.6★ product with 8,000 reviews should beat a 5.0★ with 12. Amazon's sort
disagrees. TopShelf fixes it.

---

## Install

**Unpacked (works today)**

1. Clone or download this repo.
2. (Optional, for the toolbar icon) install a rasterizer and render the
   icons: `npm i -D sharp && node scripts/render-icons.mjs`.
3. Go to `chrome://extensions`, enable **Developer mode**, click
   **Load unpacked**, and select the repo root.
4. Open any Amazon search results page.

**Chrome Web Store:** _(link placeholder — pending first review)_

---

## How ranking works (plain English)

Amazon lets a 5.0★ from 12 reviews outrank a 4.6★ from 8,000. TopShelf
doesn't. For every product on the page it computes a **confidence-weighted
rating** — a Bayesian average that pulls ratings with few reviews toward the
page's average until they've earned their spot. Then it applies a few honest
adjustments:

- **Review-farm demotion.** A 4.8★+ rating on fewer than 100 reviews looks
  manufactured, so it's pushed down — but never hidden on this signal alone.
  Wrongly burying a good product is worse than letting a mediocre one rank
  high.
- **Sponsored listings** are demoted by default (you can hide them or leave
  them alone in settings).
- **Value mode** ranks by quality *per dollar*, log-scaled so a $9 item
  doesn't automatically sweep the page.

Every rank explains itself: click a badge on the top-3 tiles to see exactly
which numbers and penalties produced the score.

You stay in control. A chip in the bottom-right toggles instantly back to
**Amazon's original order**, and hidden tiles are one click from reappearing
— TopShelf only ever *moves* Amazon's own tiles, it never deletes anything.

The full scoring specification lives in [CLAUDE.md](CLAUDE.md).

---

## Modes & settings

Open the extension's options page:

- **Ranking mode:** Quality (default) or Value.
- **Hidden-tile floor:** Off / Standard / Aggressive.
- **Sponsored:** Demote / Hide / Leave alone.
- **Rank badges:** on/off.

Settings live in Chrome sync storage and take effect on the next re-rank.

---

## Zero network requests

TopShelf makes **no network requests of any kind**. Everything it needs is
already on the page you're looking at, or in your own Chrome sync storage.
No servers, no accounts, no telemetry. You can verify this in the code —
there is no `fetch`, `XMLHttpRequest`, or remote resource anywhere.

---

## Pairs with Knockoff

[Knockoff](https://knockoff.example) answers *"is this a real brand?"*
TopShelf answers *"of what's left, what's actually best?"*

If Knockoff is installed, it tags tiles with `data-ko-verdict`. TopShelf
reads that optional signal:

- `flagged` → hidden
- `suspect` → heavy demotion
- `known` → small boost

If Knockoff isn't installed, the attribute simply isn't there and TopShelf
behaves neutrally — **zero coupling, no requirement.**

---

## Development

Plain classic JavaScript. No build step, no dependencies, no frameworks. The
repo root *is* the extension.

```
node tests/run.js     # the only test command
```

- `src/scorer.js` is pure (no DOM, no `chrome.*`) so it's unit-testable.
- All Amazon CSS selectors live in the `SELECTORS` block at the top of
  `src/scraper.js` — the single place to fix when Amazon changes markup.
- Every new scoring signal ships with a fixture in `tests/fixtures.js`.

Contributions welcome — see [CLAUDE.md](CLAUDE.md) for architecture and
conventions. If you touch scoring, add a fixture.

---

## License

[MIT](LICENSE).

_Not affiliated with Amazon. "Amazon" is a trademark of Amazon.com, Inc._
