/*
 * TopShelf scorer: tile-data -> {score, hidden, reasons[]}.
 *
 * THIS FILE IS PURE. Zero DOM access, zero chrome.* access, zero I/O.
 * That purity is what lets tests/run.js load it in a vm sandbox and
 * assert ordering without a browser. Keep it that way: all ranking
 * logic lives here.
 *
 * Implements the v1 scoring spec exactly (see README / CLAUDE.md).
 */
(function (global) {
  "use strict";

  var CONFIDENCE = 50; // Bayesian confidence constant C from the spec.

  // Round a number to a fixed number of decimals for display in reasons[].
  function fmt(n, d) {
    if (n === null || n === undefined || isNaN(n)) return "?";
    var p = Math.pow(10, d == null ? 1 : d);
    return String(Math.round(n * p) / p);
  }

  // Group thousands for human-readable review counts, e.g. 8240 -> "8,240".
  function group(n) {
    if (n === null || n === undefined) return "?";
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  // Compute the page prior m = mean rating over tiles that have a rating.
  function pagePrior(tiles) {
    var sum = 0;
    var count = 0;
    for (var i = 0; i < tiles.length; i++) {
      var r = tiles[i].rating;
      if (r !== null && r !== undefined && !isNaN(r)) {
        sum += r;
        count += 1;
      }
    }
    // If NO tile has a rating, fall back to a neutral 3.5 so the page still
    // ranks sensibly (by reviews/price) instead of collapsing to zero.
    if (count === 0) return 3.5;
    return sum / count;
  }

  function scoreOne(tile, m, settings) {
    var reasons = [];
    var hidden = false;

    var rating = tile.rating;
    var reviews =
      tile.reviews !== null && tile.reviews !== undefined ? tile.reviews : null;

    // ---- Bayesian base ----
    var base;
    if (rating === null || rating === undefined || isNaN(rating)) {
      // Unknown quality is demoted but not treated as terrible.
      base = m - 0.3;
      reasons.push("no rating - " + fmt(m - 0.3, 2));
    } else {
      var r = reviews === null ? 0 : reviews;
      base = (CONFIDENCE * m + rating * r) / (CONFIDENCE + r);
      reasons.push(
        fmt(rating, 1) + "★ × " + group(reviews === null ? 0 : reviews)
      );
    }

    var score = base;

    // ---- Compounding multipliers ----
    // Sponsored: demote (default) or hide, per setting. "off" = leave alone.
    var sponsoredSetting = settings.sponsored || "demote";
    if (tile.sponsored) {
      if (sponsoredSetting === "hide") {
        hidden = true;
        reasons.push("sponsored - hidden");
      } else if (sponsoredSetting === "demote") {
        score *= 0.85;
        reasons.push("sponsored −15%");
      } else {
        reasons.push("sponsored (left alone)");
      }
    }

    // Review-farm profile: suspiciously high rating on very few reviews.
    // We demote, never hide on this alone -- false positives are worse.
    if (
      rating !== null &&
      rating !== undefined &&
      !isNaN(rating) &&
      rating >= 4.8 &&
      reviews !== null &&
      reviews < 100
    ) {
      score *= 0.8;
      reasons.push("thin reviews −20%");
    }

    // Knockoff interop. Optional signal from a separate extension.
    var ko = tile.koVerdict;
    if (ko === "flagged") {
      hidden = true;
      score = 0;
      reasons.push("Knockoff: flagged - hidden");
    } else if (ko === "suspect") {
      score *= 0.6;
      reasons.push("Knockoff: suspect −40%");
    } else if (ko === "known") {
      score *= 1.05;
      reasons.push("Knockoff: known brand +5%");
    }

    // ---- Value mode ----
    // Quality per dollar, log-scaled so a $9 item doesn't automatically win.
    // Null price falls back to the quality score (can't compute value).
    if ((settings.mode || "quality") === "value") {
      var price = tile.price;
      if (price !== null && price !== undefined && !isNaN(price) && price > 0) {
        score = score / Math.log10(price + 10);
        reasons.push("value: /log10($" + fmt(price, 2) + ")");
      } else {
        reasons.push("value: no price, quality used");
      }
    }

    return { score: score, hidden: hidden, reasons: reasons };
  }

  // Apply the hide floor. flagged tiles are already hidden in scoreOne.
  function applyFloor(result, m, floor) {
    if (result.hidden) return; // already hidden (flagged / sponsored-hide)
    if (floor === "standard") {
      if (result.score < m - 0.6) {
        result.hidden = true;
        result.reasons.push("below floor (m−0.6)");
      }
    } else if (floor === "aggressive") {
      if (result.score < m - 0.3) {
        result.hidden = true;
        result.reasons.push("below floor (m−0.3)");
      }
    }
    // "off" -> nothing hidden except flagged/sponsored-hide.
  }

  // Public API. tiles: array of tile-data. settings: {mode, floor, sponsored}.
  // Returns an array of {score, hidden, reasons[]} aligned by index to tiles.
  function TopShelfScore(tiles, settings) {
    settings = settings || {};
    var m = pagePrior(tiles);
    var floor = settings.floor || "standard";
    var out = [];
    for (var i = 0; i < tiles.length; i++) {
      var res = scoreOne(tiles[i], m, settings);
      applyFloor(res, m, floor);
      out.push(res);
    }
    return out;
  }

  global.TopShelfScore = TopShelfScore;
  // Exposed for tests / debugging; harmless in the browser.
  global.TopShelfScoreInternals = { pagePrior: pagePrior, CONFIDENCE: CONFIDENCE };

  // CommonJS export so the node test harness can require this file directly
  // if it prefers that over the vm sandbox. Guarded so the browser ignores it.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { TopShelfScore: TopShelfScore, pagePrior: pagePrior };
  }
})(typeof window !== "undefined" ? window : this);
