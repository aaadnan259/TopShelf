# Chrome Web Store listing

## Name
TopShelf for Amazon

## Single-purpose description (required by CWS)
Re-ranks Amazon search results by statistically honest quality.

## Short description (≤132 chars)
Reorders Amazon search results best-first with a confidence-weighted rating. No accounts, no tracking, zero network requests.

## Full description

A 4.6★ product with 8,000 reviews should beat a 5.0★ with 12. Amazon's sort
disagrees. TopShelf fixes it.

TopShelf re-ranks every Amazon search results page best-first using a
confidence-weighted (Bayesian) rating, so products with a handful of reviews
can't leapfrog genuinely proven ones. It also:

• Demotes suspected review-farm listings (very high ratings on very few
  reviews) — without ever hiding a product on that signal alone.
• Demotes sponsored listings by default (hide them or leave them alone in
  settings).
• Offers a Value mode: quality per dollar, log-scaled so cheap junk doesn't
  sweep the page.
• Explains every rank — click a badge on the top listings to see the exact
  numbers and penalties behind the score.

You stay in control. One tap on the on-page chip returns to Amazon's original
order, and hidden listings are one click from reappearing. TopShelf only ever
reorders Amazon's own tiles — it never deletes anything.

Private by design: no accounts, no analytics, no tracking, and zero network
requests. Everything happens in your browser using only what's already on the
page. Your settings are stored in Chrome sync storage and nowhere else.

Pairs with Knockoff: if you also run the Knockoff extension, TopShelf reads
its brand verdicts to hide flagged listings and demote suspect ones. Not
installed? TopShelf works exactly the same, minus that one optional signal.

Not affiliated with Amazon.

## Category
Shopping

## Permissions justification
- storage: save your ranking preferences in Chrome sync storage.
- host permissions (amazon.com and international marketplaces): read the
  search results page in order to re-rank it. No other sites, no <all_urls>.

## Remote code (Privacy practices tab)
No, I am not using remote code. All JavaScript ships in the package; nothing
is fetched or eval'd.

## Privacy
Single data practice: none. No data is collected or transmitted. In the
Privacy practices tab, leave every data-type box unticked and tick all three
certifications. Privacy policy URL:
https://github.com/aaadnan259/TopShelf/blob/master/store-assets/privacy-policy.md

## Images
- Store icon: icons/icon-128.png (also inside the zip).
- Small promo tile (required): store-assets/promo/small-tile-440x280.png.
- Screenshots: store-assets/screenshots/01-*.png ... 05-*.png (1280x800).
