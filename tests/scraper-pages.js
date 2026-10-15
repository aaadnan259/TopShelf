/*
 * Scraper page fixtures: saved Amazon search pages (tests/pages/*.html)
 * and what TopShelfScrape must extract from them. Run by tests/run.js.
 *
 * Expected values are read off the HTML by hand, not copied from scraper
 * output -- a fixture that just records whatever the scraper returns would
 * pass the very bugs it is meant to catch.
 *
 * Assertion vocabulary:
 *   asins:  the EXACT list of tiles scraped, in DOM order. Anything extra
 *           (an add-to-cart bar, a carousel card) or missing fails.
 *   tiles:  asin -> fields that must match exactly (null included). Only
 *           listed fields are checked; `title` is a substring match.
 *
 * Adding a real saved page: "Save Page As > Web Page, HTML only" on an
 * Amazon search, drop it in tests/pages/, and add an entry here. Inline
 * scripts are fine (the parser treats them as raw text).
 */

var PAGES = [
  {
    file: "us-grid.html",
    asins: ["B0ANKER001", "B0SPONS002", "B0NORATE04", "B0KNOCKO05", "B0OLDMRK06"],
    tiles: {
      B0ANKER001: {
        title: "Anker Portable Charger",
        rating: 4.6,
        // "(4.1K)" -- not 46 from the visible "4.6", not 25 from "25."
        reviews: 4100,
        price: 25.99,
        sponsored: false,
        koVerdict: null,
        koBrand: null
      },
      B0SPONS002: {
        title: "INIU Portable Charger",
        rating: 4.3,
        reviews: 812,
        price: 19.99,
        sponsored: true
      },
      B0NORATE04: {
        title: "Jackery Explorer 1000 v2",
        rating: null,
        // Not 5 ("+5 other colors"), 15 ("Save 15%") or 1299 (the price).
        reviews: null,
        price: 1299,
        sponsored: false
      },
      B0KNOCKO05: {
        rating: 4.9,
        reviews: 47,
        // The real price, not the strike-through $29.99 list price.
        price: 12.99,
        sponsored: false,
        koVerdict: "suspect",
        koBrand: "ZXQWE"
      },
      B0OLDMRK06: {
        title: "Belkin BoostCharge 20K",
        rating: 4.4,
        reviews: 8240,
        price: 34.5,
        sponsored: false
      }
    }
  },
  {
    file: "de-list.html",
    asins: ["B0DEORG001", "B0DESPN002", "B0DENOAL03"],
    tiles: {
      B0DEORG001: {
        title: "Anker Powerbank",
        rating: 4.6,
        // Not 1000 from "Mehr als 1.000 Mal ... gekauft".
        reviews: 1234,
        price: 29.99,
        sponsored: false
      },
      B0DESPN002: {
        rating: 4.7,
        reviews: 12345,
        price: 1299,
        sponsored: true
      },
      B0DENOAL03: {
        rating: 4.1,
        reviews: 87,
        price: null,
        sponsored: false
      }
    }
  }
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = PAGES;
}
