/*
 * TopShelf test fixtures. Each fixture is a scenario: a set of tile-data
 * objects, the settings to score them under, and assertions about the
 * resulting relative order and/or hidden flags.
 *
 * RULE (from CLAUDE.md): every new scoring signal ships with a fixture.
 *
 * Assertion vocabulary (kept tiny on purpose):
 *   order:  array of asins that must appear in this relative order, best
 *           first, among the VISIBLE (non-hidden) tiles.
 *   hidden: array of asins that MUST be hidden.
 *   shown:  array of asins that MUST NOT be hidden.
 *   noThrow: true means "just don't crash / produce NaN".
 */

var FIXTURES = [
  {
    name: "high rating + huge reviews beats perfect rating + few reviews",
    settings: { mode: "quality", floor: "off", sponsored: "demote" },
    tiles: [
      { asin: "PERFECT12", rating: 5.0, reviews: 12, price: 20, sponsored: false },
      { asin: "SOLID8240", rating: 4.6, reviews: 8240, price: 20, sponsored: false }
    ],
    order: ["SOLID8240", "PERFECT12"]
  },

  {
    name: "review-farm profile is demoted below an organic tile",
    settings: { mode: "quality", floor: "off", sponsored: "demote" },
    tiles: [
      // 4.9 with 40 reviews trips the >=4.8 && <100 review-farm rule.
      { asin: "FARM49", rating: 4.9, reviews: 40, price: 25, sponsored: false },
      // A solid organic profile.
      { asin: "ORGANIC46", rating: 4.6, reviews: 3000, price: 25, sponsored: false }
    ],
    order: ["ORGANIC46", "FARM49"],
    // Never hidden for the farm profile alone.
    shown: ["FARM49"]
  },

  {
    name: "sponsored tile is demoted below an equivalent organic tile",
    settings: { mode: "quality", floor: "off", sponsored: "demote" },
    tiles: [
      { asin: "SPON", rating: 4.5, reviews: 1000, price: 30, sponsored: true },
      { asin: "ORG", rating: 4.5, reviews: 1000, price: 30, sponsored: false }
    ],
    order: ["ORG", "SPON"]
  },

  {
    name: "value mode flips a cheap 4.5 above an expensive 4.6",
    settings: { mode: "value", floor: "off", sponsored: "demote" },
    tiles: [
      // Similar quality, very different price. In quality mode the 4.6 wins;
      // in value mode the much cheaper 4.5 should win.
      { asin: "CHEAP45", rating: 4.5, reviews: 2000, price: 12, sponsored: false },
      { asin: "PRICEY46", rating: 4.6, reviews: 2000, price: 220, sponsored: false }
    ],
    order: ["CHEAP45", "PRICEY46"]
  },

  {
    name: "quality mode keeps the expensive 4.6 above the cheap 4.5 (control)",
    settings: { mode: "quality", floor: "off", sponsored: "demote" },
    tiles: [
      { asin: "CHEAP45", rating: 4.5, reviews: 2000, price: 12, sponsored: false },
      { asin: "PRICEY46", rating: 4.6, reviews: 2000, price: 220, sponsored: false }
    ],
    order: ["PRICEY46", "CHEAP45"]
  },

  {
    name: "koVerdict flagged is hidden and scores zero",
    settings: { mode: "quality", floor: "off", sponsored: "demote" },
    tiles: [
      { asin: "FLAGGED", rating: 4.7, reviews: 5000, price: 40, sponsored: false, koVerdict: "flagged" },
      { asin: "CLEAN", rating: 4.2, reviews: 800, price: 40, sponsored: false }
    ],
    hidden: ["FLAGGED"],
    shown: ["CLEAN"]
  },

  {
    name: "koVerdict suspect is heavily demoted but not hidden (floor off)",
    settings: { mode: "quality", floor: "off", sponsored: "demote" },
    tiles: [
      { asin: "SUSPECT", rating: 4.7, reviews: 5000, price: 40, sponsored: false, koVerdict: "suspect" },
      { asin: "PLAIN", rating: 4.3, reviews: 1200, price: 40, sponsored: false }
    ],
    order: ["PLAIN", "SUSPECT"],
    shown: ["SUSPECT"]
  },

  {
    name: "koVerdict known gets a small boost",
    settings: { mode: "quality", floor: "off", sponsored: "demote" },
    tiles: [
      { asin: "KNOWN", rating: 4.4, reviews: 1500, price: 40, sponsored: false, koVerdict: "known" },
      { asin: "NEUTRAL", rating: 4.4, reviews: 1500, price: 40, sponsored: false }
    ],
    order: ["KNOWN", "NEUTRAL"]
  },

  {
    name: "standard floor hides a clearly-below-average tile",
    settings: { mode: "quality", floor: "standard", sponsored: "demote" },
    tiles: [
      { asin: "GOOD_A", rating: 4.7, reviews: 5000, price: 30, sponsored: false },
      { asin: "GOOD_B", rating: 4.6, reviews: 4000, price: 30, sponsored: false },
      { asin: "GOOD_C", rating: 4.7, reviews: 6000, price: 30, sponsored: false },
      // Far below the page average -> should trip the standard floor.
      { asin: "TERRIBLE", rating: 2.1, reviews: 900, price: 30, sponsored: false }
    ],
    hidden: ["TERRIBLE"],
    shown: ["GOOD_A", "GOOD_B", "GOOD_C"]
  },

  // ---- Floor regressions (realistic phone-charger page) ----
  // The floor used to compare the FINAL score to m - 0.6. Value mode divides
  // by log10(price + 10) (~1.3-1.6), so every priced product fell under it.
  {
    name: "value mode on standard floor does not hide ordinary products",
    settings: { mode: "value", floor: "standard", sponsored: "demote" },
    tiles: [
      { asin: "ANKER", rating: 4.6, reviews: 4123, price: 25.99, sponsored: false },
      { asin: "UGREEN", rating: 4.7, reviews: 4700, price: 13.99, sponsored: false },
      { asin: "MID", rating: 4.3, reviews: 900, price: 9.99, sponsored: false },
      { asin: "OTHER", rating: 4.5, reviews: 3000, price: 15.99, sponsored: false }
    ],
    shown: ["ANKER", "UGREEN", "MID", "OTHER"],
    order: ["UGREEN", "ANKER"]
  },

  // "Demote" must not silently mean "hide": 4.4 x 0.85 = 3.74 used to fall
  // under the m - 0.6 floor on an average page.
  {
    name: "demoted sponsored tile is not hidden by the standard floor",
    settings: { mode: "quality", floor: "standard", sponsored: "demote" },
    tiles: [
      { asin: "A", rating: 4.6, reviews: 4123, price: 26, sponsored: false },
      { asin: "B", rating: 4.5, reviews: 3000, price: 16, sponsored: false },
      { asin: "SPON44", rating: 4.4, reviews: 20000, price: 20, sponsored: true }
    ],
    shown: ["SPON44"],
    order: ["A", "B", "SPON44"]
  },

  // README promise: the review-farm signal demotes but never hides on its own.
  {
    name: "review-farm tile is not hidden by the standard floor",
    settings: { mode: "quality", floor: "standard", sponsored: "demote" },
    tiles: [
      { asin: "FARM", rating: 4.9, reviews: 40, price: 20, sponsored: false },
      { asin: "ORG1", rating: 4.5, reviews: 3000, price: 20, sponsored: false },
      { asin: "ORG2", rating: 4.4, reviews: 2000, price: 20, sponsored: false }
    ],
    shown: ["FARM"]
  },

  // Unknown review count must not be shown as a real "x 0".
  {
    name: "unknown review count does not crash",
    settings: { mode: "quality", floor: "standard", sponsored: "demote" },
    tiles: [
      { asin: "NOREV", rating: 4.5, reviews: null, price: 20, sponsored: false },
      { asin: "REV", rating: 4.5, reviews: 2000, price: 20, sponsored: false }
    ],
    shown: ["NOREV", "REV"]
  },

  {
    name: "all-null tile does not crash or produce NaN",
    settings: { mode: "value", floor: "aggressive", sponsored: "hide" },
    tiles: [
      { asin: "NULLTILE", rating: null, reviews: null, price: null, sponsored: false },
      { asin: "ALSO_NULL", rating: null, reviews: null, price: null, sponsored: true }
    ],
    noThrow: true
  },

  {
    name: "empty page does not crash",
    settings: { mode: "quality", floor: "standard", sponsored: "demote" },
    tiles: [],
    noThrow: true
  }
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = FIXTURES;
}
