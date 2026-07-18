/*
 * TopShelf orchestrator: scrape -> score -> render, plus the chip UI and
 * the MutationObserver that keeps up with Amazon's lazy loading and the
 * async Knockoff attribute.
 *
 * Invariants:
 * - We only MOVE Amazon's tile nodes (appendChild) and add classes/badges.
 *   We never remove Amazon's nodes -- Amazon's own JS may hold references.
 * - A module-level `reordering` flag guards the observer so our own DOM
 *   writes don't retrigger us into an infinite loop.
 * - The original ASIN order is snapshotted once so "Original" is exact.
 */
(function () {
  "use strict";

  var DEFAULTS = {
    mode: "quality",
    floor: "standard",
    sponsored: "demote",
    badges: true
  };

  var settings = Object.assign({}, DEFAULTS);
  var reordering = false; // true while we mutate the DOM ourselves
  var currentView = "ranked"; // "ranked" | "original"
  var originalOrder = null; // array of ASINs, snapshotted on first run
  var lastScored = []; // [{tile, result}] for the current page
  var debounceTimer = null;

  function getContainer() {
    return document.querySelector(window.TopShelfSelectors.container);
  }

  // ---- Settings ----
  function loadSettings(cb) {
    if (!chrome || !chrome.storage || !chrome.storage.sync) {
      cb();
      return;
    }
    chrome.storage.sync.get(DEFAULTS, function (stored) {
      settings = Object.assign({}, DEFAULTS, stored || {});
      cb();
    });
  }

  // ---- Snapshot / view helpers ----
  function currentAsins(container) {
    var nodes = container.querySelectorAll(window.TopShelfSelectors.tile);
    var asins = [];
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i].getAttribute("data-asin");
      if (a) asins.push(a);
    }
    return asins;
  }

  // Detect a wholesale replacement (new search / SPA nav): the set of ASINs
  // no longer overlaps meaningfully with our snapshot.
  function isNewPage(container) {
    if (!originalOrder) return true;
    var now = currentAsins(container);
    if (!now.length) return false;
    var setNow = {};
    for (var i = 0; i < now.length; i++) setNow[now[i]] = true;
    var overlap = 0;
    for (var j = 0; j < originalOrder.length; j++) {
      if (setNow[originalOrder[j]]) overlap++;
    }
    // If fewer than 20% of the old ASINs are still present, it's a new page.
    return overlap < originalOrder.length * 0.2;
  }

  // ---- Rendering ----
  function clearDecorations(container) {
    var badges = container.querySelectorAll(".ts-badge, .ts-popover");
    for (var i = 0; i < badges.length; i++) {
      if (badges[i].parentNode) badges[i].parentNode.removeChild(badges[i]);
    }
    var tiles = container.querySelectorAll(".ts-hidden, .ts-tile");
    for (var k = 0; k < tiles.length; k++) {
      tiles[k].classList.remove("ts-hidden");
      tiles[k].classList.remove("ts-tile");
    }
  }

  function makeBadge(rank, reasons) {
    var badge = document.createElement("div");
    badge.className = "ts-badge ts-badge-" + rank;
    badge.textContent = "#" + rank;
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    badge.setAttribute("aria-label", "TopShelf rank " + rank + ". Show why.");

    var pop = document.createElement("div");
    pop.className = "ts-popover";
    pop.hidden = true;
    var ul = document.createElement("ul");
    for (var i = 0; i < reasons.length; i++) {
      var li = document.createElement("li");
      li.textContent = reasons[i];
      ul.appendChild(li);
    }
    pop.appendChild(ul);
    badge.appendChild(pop);

    function toggle(e) {
      e.stopPropagation();
      e.preventDefault();
      pop.hidden = !pop.hidden;
    }
    badge.addEventListener("click", toggle);
    badge.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") toggle(e);
    });
    return badge;
  }

  // Sort scored tiles best-first and re-append them into the container.
  function renderRanked(container) {
    reordering = true;
    try {
      clearDecorations(container);

      // Stable sort desc by score. Hidden tiles keep their score-based slot
      // but get display:none, so "show hidden" reveals them in-rank.
      var ordered = lastScored.slice().sort(function (a, b) {
        return b.result.score - a.result.score;
      });

      var visibleRank = 0;
      for (var i = 0; i < ordered.length; i++) {
        var item = ordered[i];
        var el = item.tile.el;
        el.classList.add("ts-tile");
        // appendChild MOVES the existing node -- this is the whole trick.
        container.appendChild(el);

        if (item.result.hidden) {
          el.classList.add("ts-hidden");
          continue;
        }
        visibleRank++;
        if (settings.badges && visibleRank <= 3) {
          el.style.position = el.style.position || "relative";
          el.appendChild(makeBadge(visibleRank, item.result.reasons));
        }
      }
    } finally {
      reordering = false;
    }
  }

  // Re-append in the snapshotted original order.
  function renderOriginal(container) {
    reordering = true;
    try {
      clearDecorations(container);
      var byAsin = {};
      for (var i = 0; i < lastScored.length; i++) {
        byAsin[lastScored[i].tile.asin] = lastScored[i].tile.el;
      }
      for (var j = 0; j < originalOrder.length; j++) {
        var el = byAsin[originalOrder[j]];
        if (el) container.appendChild(el);
      }
    } finally {
      reordering = false;
    }
  }

  // ---- Chip UI ----
  var chip = null;
  function ensureChip() {
    if (chip) return chip;
    chip = document.createElement("div");
    chip.className = "ts-chip";
    chip.innerHTML =
      '<span class="ts-chip-label"></span>' +
      '<button class="ts-chip-toggle" type="button"></button>' +
      '<button class="ts-chip-hidden" type="button" hidden></button>';
    document.body.appendChild(chip);

    chip.querySelector(".ts-chip-toggle").addEventListener("click", function () {
      currentView = currentView === "ranked" ? "original" : "ranked";
      var c = getContainer();
      if (!c) return;
      if (currentView === "ranked") renderRanked(c);
      else renderOriginal(c);
      updateChip();
    });

    chip.querySelector(".ts-chip-hidden").addEventListener("click", function () {
      var c = getContainer();
      if (!c) return;
      var hiddenTiles = c.querySelectorAll(".ts-hidden");
      var showing = chip.getAttribute("data-showing") === "1";
      for (var i = 0; i < hiddenTiles.length; i++) {
        hiddenTiles[i].style.display = showing ? "" : "block";
      }
      chip.setAttribute("data-showing", showing ? "0" : "1");
      updateChip();
    });
    return chip;
  }

  function updateChip() {
    ensureChip();
    var hiddenCount = 0;
    for (var i = 0; i < lastScored.length; i++) {
      if (lastScored[i].result.hidden) hiddenCount++;
    }
    var label = chip.querySelector(".ts-chip-label");
    var toggle = chip.querySelector(".ts-chip-toggle");
    var hiddenBtn = chip.querySelector(".ts-chip-hidden");

    label.textContent =
      "TopShelf · " + (currentView === "ranked" ? "Ranked" : "Original");
    toggle.textContent =
      currentView === "ranked" ? "Original order" : "Rank best-first";

    if (hiddenCount > 0 && currentView === "ranked") {
      hiddenBtn.hidden = false;
      var showing = chip.getAttribute("data-showing") === "1";
      hiddenBtn.textContent =
        (showing ? "Hide " : "Show ") + hiddenCount + " hidden";
    } else {
      hiddenBtn.hidden = true;
    }
  }

  // ---- Pipeline ----
  function run() {
    var container = getContainer();
    if (!container) return;

    if (isNewPage(container)) {
      originalOrder = currentAsins(container);
      chip && chip.setAttribute("data-showing", "0");
    }

    var tiles = window.TopShelfScrape(container);
    if (!tiles.length) return;

    var results = window.TopShelfScore(tiles, settings);
    lastScored = [];
    for (var i = 0; i < tiles.length; i++) {
      lastScored.push({ tile: tiles[i], result: results[i] });
    }

    if (currentView === "ranked") renderRanked(container);
    else renderOriginal(container);
    updateChip();
  }

  function scheduleRun() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(run, 300);
  }

  // ---- Observer ----
  function observe() {
    var container = getContainer();
    if (!container) return;
    var observer = new MutationObserver(function (mutations) {
      if (reordering) return; // ignore our own writes
      var relevant = false;
      for (var i = 0; i < mutations.length; i++) {
        var mu = mutations[i];
        if (mu.type === "childList" && (mu.addedNodes.length || mu.removedNodes.length)) {
          relevant = true;
          break;
        }
        if (mu.type === "attributes" && mu.attributeName === "data-ko-verdict") {
          relevant = true;
          break;
        }
      }
      if (relevant) scheduleRun();
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-ko-verdict"]
    });
  }

  // ---- Boot ----
  function boot() {
    if (!getContainer()) {
      // Results container not present yet; try again shortly (SPA renders).
      setTimeout(boot, 500);
      return;
    }
    loadSettings(function () {
      run();
      observe();
    });

    if (chrome && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== "sync") return;
        for (var key in changes) {
          if (Object.prototype.hasOwnProperty.call(changes, key)) {
            settings[key] = changes[key].newValue;
          }
        }
        run(); // re-run live on any settings change
      });
    }

    // Close any open popover when clicking elsewhere.
    document.addEventListener("click", function () {
      var open = document.querySelectorAll(".ts-popover:not([hidden])");
      for (var i = 0; i < open.length; i++) open[i].hidden = true;
    });
  }

  boot();
})();
