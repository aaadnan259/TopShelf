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

console.log("\n" + passed + " passed, " + failed + " failed.");
process.exit(failed === 0 ? 0 : 1);
