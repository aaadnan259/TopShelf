/*
 * TopShelf test harness. No framework. Loads src/scorer.js into a vm
 * sandbox (proving it truly is DOM-free and chrome-free -- neither exists
 * in the sandbox), scores each fixture, and checks the assertions.
 *
 * Only test command: `node tests/run.js`. Exit 0 = pass, 1 = fail.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.join(__dirname, "..");
var scorerSrc = fs.readFileSync(path.join(ROOT, "src", "scorer.js"), "utf8");
var FIXTURES = require("./fixtures.js");

// A deliberately bare sandbox: no window, no document, no chrome, no fetch.
// scorer.js assigns to `this` (the module wrapper's global arg). We give it
// a plain object as the global and read TopShelfScore back off it.
var sandbox = {};
sandbox.module = { exports: {} };
vm.createContext(sandbox);
try {
  vm.runInContext(scorerSrc, sandbox, { filename: "src/scorer.js" });
} catch (e) {
  console.error("FATAL: scorer.js threw while loading in the sandbox.");
  console.error("This usually means it touched DOM/chrome globals.");
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
}

var TopShelfScore = sandbox.TopShelfScore || sandbox.module.exports.TopShelfScore;
if (typeof TopShelfScore !== "function") {
  console.error("FATAL: TopShelfScore was not exposed by scorer.js.");
  process.exit(1);
}

var passed = 0;
var failed = 0;

function fail(fixtureName, msg) {
  failed++;
  console.error("  FAIL [" + fixtureName + "] " + msg);
}

// Build an asin -> {tile, result} map plus a visible-in-score-order list.
function evaluate(fx) {
  var results = TopShelfScore(fx.tiles, fx.settings);
  var byAsin = {};
  var joined = [];
  for (var i = 0; i < fx.tiles.length; i++) {
    var entry = { asin: fx.tiles[i].asin, tile: fx.tiles[i], result: results[i] };
    byAsin[entry.asin] = entry;
    joined.push(entry);
  }
  var visibleSorted = joined
    .filter(function (e) {
      return !e.result.hidden;
    })
    .sort(function (a, b) {
      return b.result.score - a.result.score;
    })
    .map(function (e) {
      return e.asin;
    });
  return { results: results, byAsin: byAsin, visibleSorted: visibleSorted };
}

function hasNaNScore(results) {
  for (var i = 0; i < results.length; i++) {
    var s = results[i].score;
    if (typeof s !== "number" || isNaN(s)) return true;
  }
  return false;
}

// Check that `order` appears as a subsequence of the visible-sorted asins.
function checkOrder(want, visibleSorted) {
  var idx = 0;
  for (var i = 0; i < visibleSorted.length && idx < want.length; i++) {
    if (visibleSorted[i] === want[idx]) idx++;
  }
  return idx === want.length;
}

console.log("TopShelf scorer tests\n");

FIXTURES.forEach(function (fx) {
  var ev;
  try {
    ev = evaluate(fx);
  } catch (e) {
    fail(fx.name, "threw: " + (e && e.message ? e.message : e));
    return;
  }

  var ok = true;

  // Every fixture implicitly must not produce NaN scores.
  if (hasNaNScore(ev.results)) {
    fail(fx.name, "produced a NaN/invalid score");
    ok = false;
  }

  if (fx.noThrow) {
    if (ok) {
      passed++;
      console.log("  PASS [" + fx.name + "]");
    }
    return;
  }

  if (fx.order && !checkOrder(fx.order, ev.visibleSorted)) {
    fail(
      fx.name,
      "expected order " +
        JSON.stringify(fx.order) +
        " within visible " +
        JSON.stringify(ev.visibleSorted)
    );
    ok = false;
  }

  if (fx.hidden) {
    fx.hidden.forEach(function (asin) {
      if (!ev.byAsin[asin] || !ev.byAsin[asin].result.hidden) {
        fail(fx.name, asin + " should be hidden but was not");
        ok = false;
      }
    });
  }

  if (fx.shown) {
    fx.shown.forEach(function (asin) {
      if (!ev.byAsin[asin] || ev.byAsin[asin].result.hidden) {
        fail(fx.name, asin + " should be shown but was hidden");
        ok = false;
      }
    });
  }

  if (ok) {
    passed++;
    console.log("  PASS [" + fx.name + "]");
  }
});

// ---- Scraper parser tests ----
// scraper.js must also load in a bare sandbox (no DOM touched at load time).
// Each case is a real string shape seen on Amazon tiles.
var PARSE_CASES = [
  ["8,240", 8240, "grouped ratings count"],
  ["(8,240)", 8240, "parenthesized ratings count"],
  ["4.1K", 4100, "compact count (Anker: '4.1K ratings')"],
  ["(4.7K)", 4700, "parenthesized compact count"],
  ["312", 312, "small plain count"],
  ["1.234", 1234, "dot-grouped count (EU locales)"],
  ["4.6", null, "a rating is not a count (old code: 46)"],
  ["25.", null, "split-price dollars are not a count (old code: 25)"],
  ["10K+", null, "'bought in past month' badge is not a count"],
  ["2 sizes", null, "variation text is not a count"],
  ["", null, "empty"]
];

var parseSandbox = {};
vm.createContext(parseSandbox);
console.log("\nTopShelf scraper parser tests\n");
try {
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "src", "scraper.js"), "utf8"),
    parseSandbox,
    { filename: "src/scraper.js" }
  );
  var parseCount = parseSandbox.TopShelfParse.parseCount;
  PARSE_CASES.forEach(function (c) {
    var got = parseCount(c[0]);
    var name = "parseCount " + JSON.stringify(c[0]) + " -> " + c[1] + " (" + c[2] + ")";
    if (got === c[1]) {
      passed++;
      console.log("  PASS [" + name + "]");
    } else {
      fail(name, "got " + got);
    }
  });
} catch (e) {
  fail("scraper.js sandbox load", e && e.message ? e.message : String(e));
}

// ---- Scraper page tests ----
// Runs TopShelfScrape over saved Amazon search pages (tests/pages/) using a
// minimal DOM (tests/dom.js), then feeds the result through the scorer.
var dom = require("./dom.js");
var PAGES = require("./scraper-pages.js");

console.log("\nTopShelf scraper page tests\n");

(function () {
  var Scrape = parseSandbox.TopShelfScrape;
  var SEL = parseSandbox.TopShelfSelectors;
  if (typeof Scrape !== "function" || !SEL) {
    fail("scraper pages", "TopShelfScrape/TopShelfSelectors not exposed by scraper.js");
    return;
  }

  // The scraper's results are only as good as the DOM underneath it, so
  // check the selector engine against a known tree first.
  var probe = dom.parseHTML(
    '<div id="r" class="a b" data-asin="X1"><p><span class="c">1</span></p>' +
      '<span class="c d">2</span><em data-asin="">3</em><i class="a-icon-star-mini">4</i></div>'
  );
  var DOM_CASES = [
    ["div.a.b", 1],
    [".a .c", 2],
    ["div > .c", 1],
    ["p + span", 1],
    ["p ~ em", 1],
    ["[data-asin]:not([data-asin=\"\"])", 1],
    ["[class*='a-icon-star']", 1],
    ["#r span, em", 3],
    ["span .c", 0]
  ];
  DOM_CASES.forEach(function (c) {
    var n = probe.querySelectorAll(c[0]).length;
    var label = "tests/dom.js: " + c[0] + " matches " + c[1];
    if (n === c[1]) {
      passed++;
      console.log("  PASS [" + label + "]");
    } else {
      fail(label, "got " + n);
    }
  });

  // scraper.js wraps every query in try/catch, so a selector our DOM can't
  // parse would silently match nothing. Prove they all parse first.
  var selOk = true;
  Object.keys(SEL).forEach(function (k) {
    try {
      dom.parseSelectorList(SEL[k]);
    } catch (e) {
      fail("SELECTORS." + k + " parses in tests/dom.js", e.message);
      selOk = false;
    }
  });
  if (selOk) {
    passed++;
    console.log("  PASS [every SELECTORS entry is understood by tests/dom.js]");
  }

  function same(a, b) {
    return a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) < 1e-9);
  }

  PAGES.forEach(function (pg) {
    var doc = dom.parseHTML(fs.readFileSync(path.join(__dirname, "pages", pg.file), "utf8"));
    var container = doc.querySelector(SEL.container);
    if (!container) {
      fail(pg.file, "no " + SEL.container + " container found");
      return;
    }

    var tiles;
    try {
      tiles = Scrape(container);
    } catch (e) {
      fail(pg.file, "TopShelfScrape threw: " + (e && e.message ? e.message : e));
      return;
    }
    var byAsin = {};
    tiles.forEach(function (t) {
      byAsin[t.asin] = t;
    });

    // Exactly the product cards: no nested add-to-cart bars, no carousel
    // cards, no data-asin="" rows (the a604d00 tile-extraction bug).
    var got = tiles.map(function (t) {
      return t.asin;
    });
    var name = pg.file + ": scrapes exactly " + pg.asins.length + " product tiles";
    if (JSON.stringify(got) === JSON.stringify(pg.asins)) {
      passed++;
      console.log("  PASS [" + name + "]");
    } else {
      fail(name, "got " + JSON.stringify(got));
    }

    // Rank badges are appended to tile.el, so it must be the outer card --
    // never an element nested inside another scraped tile.
    var anchorsOk = true;
    tiles.forEach(function (t) {
      if (t.el.getAttribute("data-component-type") !== "s-search-result") {
        fail(pg.file + " " + t.asin, "tile.el is not the outer s-search-result card");
        anchorsOk = false;
      }
      tiles.forEach(function (o) {
        if (o !== t && o.el.parentElement && o.el.parentElement.closest("[data-asin]") === t.el) {
          fail(pg.file + " " + o.asin, "tile.el is nested inside " + t.asin);
          anchorsOk = false;
        }
      });
    });
    if (anchorsOk) {
      passed++;
      console.log("  PASS [" + pg.file + ": every tile.el is a top-level product card]");
    }

    Object.keys(pg.tiles).forEach(function (asin) {
      var want = pg.tiles[asin];
      var t = byAsin[asin];
      if (!t) return; // already reported by the asins check
      Object.keys(want).forEach(function (field) {
        var label = pg.file + " " + asin + "." + field + " = " + JSON.stringify(want[field]);
        var ok =
          field === "title"
            ? typeof t.title === "string" && t.title.indexOf(want.title) !== -1
            : same(t[field], want[field]);
        if (ok) {
          passed++;
          console.log("  PASS [" + label + "]");
        } else {
          fail(label, "got " + JSON.stringify(t[field]));
        }
      });
    });

    // End to end: real scraped data must score without throwing or NaN.
    var label = pg.file + ": scraped tiles score without NaN";
    try {
      var results = TopShelfScore(tiles, { mode: "value", floor: "standard", sponsored: "demote" });
      if (hasNaNScore(results)) fail(label, "NaN score");
      else {
        passed++;
        console.log("  PASS [" + label + "]");
      }
    } catch (e) {
      fail(label, "threw: " + (e && e.message ? e.message : e));
    }
  });
})();

console.log("\n" + passed + " passed, " + failed + " failed.");
process.exit(failed === 0 ? 0 : 1);
