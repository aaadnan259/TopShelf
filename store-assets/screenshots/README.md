# Screenshots

The Chrome Web Store wants 1–5 images at **1280×800** (or 640×400). These
must be captured from a real Amazon search with the extension loaded — they
can't be generated here. Suggested shot list:

1. **Before/after hero.** The same real search in Amazon's order vs. ranked
   by TopShelf, side by side or as a labeled pair. Show the rank badges.
2. **A badge popover open**, revealing the reasons[] for a #1 tile
   ("4.6★ × 8,240", "sponsored −15%", etc.) — this sells "explainable".
3. **The control chip** bottom-right showing "TopShelf · Ranked · N hidden"
   and the "show hidden" link.
4. **Value mode** on a price-varied search, showing a cheaper item ranked
   above a pricier one.
5. **The options page.**

Tip (matching Knockoff's approach): use a real listing from a real search and
say so in the landing-page footer for credibility.

Save the final PNGs in this folder as `01-*.png … 05-*.png`.

## Capturing them in one command

`scripts/capture-screenshots.mjs` drives Playwright's Chromium with the
unpacked extension loaded, runs a real Amazon search, and writes all five
shots here at exactly 1280×800:

```
npm i -D playwright
node scripts/capture-screenshots.mjs --query "smart watch" --value-query "usb c cable"
```

The browser window stays visible: if Amazon asks for a robot check or a
delivery location, handle it in that window and the script carries on.
Shot 3 uses the Aggressive floor so a "Show N hidden" link is likely; if the
script warns that nothing was hidden, re-run with a different `--query`.
Look over every PNG before uploading, since a real search can surface
anything.
