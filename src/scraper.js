/*
 * TopShelf scraper: Amazon search DOM -> plain tile-data objects.
 *
 * Design rule: EVERY Amazon selector lives in the SELECTORS block below.
 * When Amazon changes its markup (they do, often), this is the ONE place
 * to fix. Nothing else in the extension knows a CSS selector.
 *
 * Every extracted field is optional. Missing data becomes null. We never
 * throw on a malformed tile -- one weird tile must not break the page.
 */
(function (global) {
  "use strict";

  // ---- The single point of repair for Amazon markup changes ----
  var SELECTORS = {
    // The results container. Amazon has used .s-main-slot for years.
    container: ".s-main-slot",

    // A product tile. Real products carry a non-empty data-asin. Amazon
    // also emits data-asin="" spacer/ad rows -- those are excluded.
    tile:
      'div[data-component-type="s-search-result"], div.s-result-item[data-asin]:not([data-asin=""]), div[data-asin]:not([data-asin=""])',

    // Title text. h2 covers the current layout; the anchor is a fallback.
    title: "h2 span, h2 a span, h2",

    // Star rating lives in an element whose class starts with a-icon-star
    // and whose accessible text reads e.g. "4.6 out of 5 stars".
    ratingIcon: "i.a-icon-star-small, i.a-icon-star, [class*='a-icon-star']",
    ratingAltText: ".a-icon-alt",

    // The ratings-count link, e.g. "8,240". Amazon marks it up a few ways.
    reviewCount:
      "[aria-label*='rating'] + span a, a .s-underline-text, span[aria-label] a",

    // Price. The .a-offscreen span holds the clean machine-readable value.
    price: ".a-price .a-offscreen",
    // The whole price block (same wrapper as above). Its visible digit
    // fragments ("25." / "99") must never be read as a review count.
    priceBlock: ".a-price",

    // Sponsored disclosure. Amazon varies the wording/markup; we match a
    // few known shapes and also fall back to a text scan in the extractor.
    sponsored:
      ".s-sponsored-label-text, .puis-sponsored-label-text, [aria-label='Sponsored'], [data-component-type='sp-sponsored-result']"
  };

  // Safe query helpers: never throw, always return null / "" on miss.
  function q(root, sel) {
    try {
      return root.querySelector(sel);
    } catch (e) {
      return null;
    }
  }
  function text(el) {
    return el && el.textContent ? el.textContent.trim() : "";
  }

  // Pull the first float out of a string, tolerant of thousands separators
  // and both "." and "," decimal marks (Amazon is localized).
  function firstNumber(str) {
    if (!str) return null;
    // Grab a run of digits, dots, commas, spaces (some locales use spaces
    // as thousands separators).
    var m = str.match(/[\d.,\s]+/);
    if (!m) return null;
    var raw = m[0].replace(/\s/g, "");
    // Heuristic: if both separators present, the LAST one is the decimal.
    var lastComma = raw.lastIndexOf(",");
    var lastDot = raw.lastIndexOf(".");
    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) {
        raw = raw.replace(/\./g, "").replace(",", ".");
      } else {
        raw = raw.replace(/,/g, "");
      }
    } else if (lastComma > -1) {
      // Only commas. If it looks like a decimal (one comma, <=2 trailing
      // digits) treat as decimal, else thousands separator.
      var parts = raw.split(",");
      if (parts.length === 2 && parts[1].length <= 2) {
        raw = parts[0] + "." + parts[1];
      } else {
        raw = raw.replace(/,/g, "");
      }
    }
    var n = parseFloat(raw);
    return isNaN(n) ? null : n;
  }

  function extractRating(tile) {
    // Prefer the accessible alt text: "4.6 out of 5 stars".
    var alt = q(tile, SELECTORS.ratingAltText);
    var candidate = alt ? text(alt) : "";
    if (!candidate) {
      var icon = q(tile, SELECTORS.ratingIcon);
      if (icon) {
        candidate =
          icon.getAttribute("aria-label") ||
          (icon.querySelector
            ? text(icon.querySelector(SELECTORS.ratingAltText))
            : "") ||
          "";
      }
    }
    if (!candidate) return null;
    var n = firstNumber(candidate);
    // Sanity clamp: ratings live in 1..5. Reject anything outside.
    if (n === null || n < 0 || n > 5) return null;
    return n;
  }

  // Parse a ratings-count string. Pure: no DOM. Accepts only shapes a count
  // can take -- "8,240", "1.234", "12 345", "312", optionally wrapped in
  // parens "(8,240)", and Amazon's compact form "4.1K" / "(4.1K)" / "2M".
  // Rejects, by construction:
  //   "4.6"   a rating (old code read this as 46 reviews)
  //   "25."   the dollar part of a split price (old code read 25 reviews)
  //   "10K+"  the "bought in past month" badge
  function parseCount(str) {
    if (!str) return null;
    var t = String(str).trim();
    var paren = t.match(/^\((.*)\)$/);
    if (paren) t = paren[1].trim();

    var compact = t.match(/^(\d+(?:[.,]\d+)?)\s?([KkMm])$/);
    if (compact) {
      var base = parseFloat(compact[1].replace(",", "."));
      var mult = /k/i.test(compact[2]) ? 1000 : 1000000;
      var v = Math.round(base * mult);
      return isNaN(v) || v < 1 ? null : v;
    }

    // Plain integer, or an integer grouped in threes by , . or space.
    if (/^\d+$/.test(t) || /^\d{1,3}(?:[.,\s]\d{3})+$/.test(t)) {
      var n = parseInt(t.replace(/\D/g, ""), 10);
      return isNaN(n) || n < 1 ? null : n;
    }
    return null;
  }

  function extractReviews(tile) {
    // Scan text nodes in DOM order and take the first that is shaped like a
    // ratings count. Numbers inside the price block are never counts.
    var nodes = [];
    try {
      nodes = tile.querySelectorAll("a, span");
    } catch (e) {
      nodes = [];
    }
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      try {
        if (node.closest && node.closest(SELECTORS.priceBlock)) continue;
      } catch (e) {
        // closest() unsupported/invalid -> just don't skip
      }
      var n = parseCount(text(node));
      if (n !== null) return n;
    }
    return null;
  }

  function extractPrice(tile) {
    var el = q(tile, SELECTORS.price);
    if (!el) return null;
    return firstNumber(text(el));
  }

  function extractSponsored(tile) {
    if (q(tile, SELECTORS.sponsored)) return true;
    // Fallback: some layouts only expose the word "Sponsored" as loose text.
    // Cheap scan of a bounded slice to avoid scanning huge subtrees.
    var t = "";
    try {
      t = (tile.textContent || "").slice(0, 400).toLowerCase();
    } catch (e) {
      t = "";
    }
    return t.indexOf("sponsored") !== -1;
  }

  function scrapeTile(el) {
    // dataset values are set by the separate Knockoff extension, if present.
    // Absent -> undefined -> we normalize to null. Never require them.
    var ds = el.dataset || {};
    return {
      el: el,
      asin: el.getAttribute("data-asin") || null,
      title: text(q(el, SELECTORS.title)) || null,
      rating: extractRating(el),
      reviews: extractReviews(el),
      price: extractPrice(el),
      sponsored: extractSponsored(el),
      koVerdict: ds.koVerdict != null ? ds.koVerdict : null,
      koBrand: ds.koBrand != null ? ds.koBrand : null
    };
  }

  // Public API. Given a container element, return an array of tile-data
  // objects (one per real product tile). Order is DOM order.
  function TopShelfScrape(container) {
    if (!container) return [];
    var tiles = [];
    var nodes;
    try {
      nodes = container.querySelectorAll(SELECTORS.tile);
    } catch (e) {
      return [];
    }
    for (var i = 0; i < nodes.length; i++) {
      try {
        var el = nodes[i];
        // 1. Must not be a subcomponent nested inside another matched tile (e.g. Add to cart container)
        if (el.parentElement && el.parentElement.closest(SELECTORS.tile)) {
          continue;
        }
        // 2. Must not be an item inside a horizontal carousel widget
        if (el.closest && el.closest(".a-carousel-container, [data-component-type='s-carousel']")) {
          continue;
        }
        // 3. Must have an actual product title
        if (!q(el, SELECTORS.title)) {
          continue;
        }
        tiles.push(scrapeTile(el));
      } catch (e) {
        // One bad tile must not break the batch. Skip it silently.
      }
    }
    return tiles;
  }

  global.TopShelfScrape = TopShelfScrape;
  global.TopShelfSelectors = SELECTORS; // exposed so content.js can find the container
  // Pure parsers, exposed for tests/run.js (no DOM needed to exercise them).
  global.TopShelfParse = { parseCount: parseCount, firstNumber: firstNumber };
})(typeof window !== "undefined" ? window : this);
