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
    enabled: true,
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
  var showHidden = false; // "Show N hidden" toggle state
  var observer = null; // shared so renders can drain their own records
  var observedContainer = null;

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
    var tiles = container.querySelectorAll(
      ".ts-hidden, .ts-tile, .ts-revealed, .ts-anchor"
    );
    for (var k = 0; k < tiles.length; k++) {
      tiles[k].classList.remove("ts-hidden", "ts-tile", "ts-revealed", "ts-anchor");
    }
  }

  // Reorder tiles IN PLACE: the set of positions the tiles occupy stays the
  // same, only which tile sits in each position changes. Appending to the
  // end of the container (the old approach) dragged every product past
  // Amazon's non-tile children -- pagination, related searches, widgets --
  // leaving those stranded above the results.
  function placeInSlots(els) {
    var inDom = els.filter(function (e) {
      return e && e.parentNode;
    });
    var domOrder = inDom.slice().sort(function (a, b) {
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    var slots = domOrder.map(function (e) {
      var marker = document.createComment("ts-slot");
      e.parentNode.insertBefore(marker, e);
      return marker;
    });
    for (var i = 0; i < slots.length; i++) {
      slots[i].parentNode.replaceChild(inDom[i], slots[i]);
    }
  }

  // Our DOM writes queue MutationObserver records that are delivered AFTER
  // this synchronous code returns -- by then `reordering` is false again.
  // Draining the queue here is what actually stops the self-trigger loop.
  function endReorder() {
    if (observer) observer.takeRecords();
    reordering = false;
  }

  function makeBadge(rank, reasons) {
    var badge = document.createElement("div");
    badge.className = "ts-badge ts-badge-" + rank;
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    badge.setAttribute("aria-label", "TopShelf rank " + rank + ". Show why.");

    var mark = document.createElement("span");
    mark.className = "ts-badge-mark";
    mark.innerHTML = "<i></i><i></i><i></i>";
    badge.appendChild(mark);

    var txt = document.createElement("span");
    txt.textContent = "#" + rank;
    badge.appendChild(txt);

    var pop = document.createElement("div");
    pop.className = "ts-popover";
    pop.hidden = true;

    var head = document.createElement("div");
    head.className = "ts-pop-head";
    head.innerHTML =
      '<span class="ts-pop-title">TopShelf Rank #' + rank + '</span>' +
      '<span class="ts-pop-sub">Scored</span>';
    pop.appendChild(head);

    var ul = document.createElement("ul");
    for (var i = 0; i < reasons.length; i++) {
      var r = reasons[i];
      var li = document.createElement("li");
      li.textContent = r;
      if (/^[45]\.|\+|known/i.test(r)) li.className = "ts-good";
      else if (/[−\-]|\blow\b|farm|suspect|flagged|below/i.test(r)) li.className = "ts-bad";
      else li.className = "ts-info";
      ul.appendChild(li);
    }
    pop.appendChild(ul);

    var foot = document.createElement("div");
    foot.className = "ts-pop-foot";
    foot.textContent = "Confidence-weighted Bayesian rank";
    pop.appendChild(foot);

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

  // Sort scored tiles best-first and place them into the tiles' own slots.
  function renderRanked(container) {
    reordering = true;
    try {
      clearDecorations(container);

      // Stable sort desc by score. Hidden tiles keep their score-based slot
      // but get display:none, so "show hidden" reveals them in-rank.
      var ordered = lastScored.slice().sort(function (a, b) {
        return b.result.score - a.result.score;
      });

      placeInSlots(
        ordered.map(function (item) {
          return item.tile.el;
        })
      );

      var visibleRank = 0;
      for (var i = 0; i < ordered.length; i++) {
        var item = ordered[i];
        var el = item.tile.el;
        el.classList.add("ts-tile");

        if (item.result.hidden) {
          // Revealed hidden tiles are dimmed and never take a rank badge.
          el.classList.add(showHidden ? "ts-revealed" : "ts-hidden");
          continue;
        }
        visibleRank++;
        if (settings.badges && visibleRank <= 3) {
          el.classList.add("ts-anchor");
          el.appendChild(makeBadge(visibleRank, item.result.reasons));
        }
      }
    } finally {
      endReorder();
    }
  }

  // Restore the snapshotted original order (tiles that arrived later, and
  // are not in the snapshot, keep their relative order after the rest).
  function renderOriginal(container) {
    reordering = true;
    try {
      clearDecorations(container);
      var byAsin = {};
      for (var i = 0; i < lastScored.length; i++) {
        byAsin[lastScored[i].tile.asin] = lastScored[i].tile.el;
      }
      var list = [];
      var used = {};
      for (var j = 0; j < originalOrder.length; j++) {
        var el = byAsin[originalOrder[j]];
        if (el && !used[originalOrder[j]]) {
          list.push(el);
          used[originalOrder[j]] = true;
        }
      }
      for (var k = 0; k < lastScored.length; k++) {
        if (!used[lastScored[k].tile.asin]) list.push(lastScored[k].tile.el);
      }
      placeInSlots(list);
    } finally {
      endReorder();
    }
  }
  // ---- Chip UI ----
  var chip = null;
  function ensureChip() {
    if (chip) return chip;
    chip = document.createElement("div");
    chip.className = "ts-chip";
    chip.innerHTML =
      '<div class="ts-chip-brand">' +
        '<span class="ts-chip-logo"><i></i><i></i><i></i></span>' +
        '<span>TopShelf</span>' +
      '</div>' +
      '<div class="ts-seg">' +
        '<button class="ts-seg-btn ts-chip-toggle ts-btn-ranked" type="button" aria-pressed="true">Ranked</button>' +
        '<button class="ts-seg-btn ts-chip-toggle ts-btn-original" type="button" aria-pressed="false">Original</button>' +
      '</div>' +
      '<button class="ts-chip-hidden" type="button" hidden></button>';
    document.body.appendChild(chip);

    var btnRanked = chip.querySelector(".ts-btn-ranked");
    var btnOriginal = chip.querySelector(".ts-btn-original");

    btnRanked.addEventListener("click", function () {
      if (currentView === "ranked") return;
      currentView = "ranked";
      var c = getContainer();
      if (!c) return;
      renderRanked(c);
      updateChip();
    });

    btnOriginal.addEventListener("click", function () {
      if (currentView === "original") return;
      currentView = "original";
      var c = getContainer();
      if (!c) return;
      renderOriginal(c);
      updateChip();
    });

    chip.querySelector(".ts-chip-hidden").addEventListener("click", function () {
      var c = getContainer();
      if (!c) return;
      // State, not inline styles: the old inline display:block outlived the
      // next re-render, so hidden tiles stayed visible for good.
      showHidden = !showHidden;
      if (currentView === "ranked") renderRanked(c);
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
    var btnRanked = chip.querySelector(".ts-btn-ranked");
    var btnOriginal = chip.querySelector(".ts-btn-original");
    var hiddenBtn = chip.querySelector(".ts-chip-hidden");

    if (btnRanked && btnOriginal) {
      btnRanked.setAttribute("aria-pressed", currentView === "ranked" ? "true" : "false");
      btnOriginal.setAttribute("aria-pressed", currentView === "original" ? "true" : "false");
    }

    if (hiddenCount > 0 && currentView === "ranked") {
      hiddenBtn.hidden = false;
      hiddenBtn.textContent =
        (showHidden ? "Hide " : "Show ") + hiddenCount + " hidden";
    } else {
      hiddenBtn.hidden = true;
    }
  }

  // ---- Pipeline ----
  function run() {
    var container = getContainer();
    if (!container) return;

    // Amazon can swap the whole results container on SPA navigation.
    if (container !== observedContainer) observe(container);

    if (isNewPage(container)) {
      originalOrder = currentAsins(container);
      showHidden = false;
    } else {
      // Lazy-loaded tiles: remember where Amazon put them so "Original"
      // can restore them too.
      var seen = {};
      for (var s = 0; s < originalOrder.length; s++) seen[originalOrder[s]] = true;
      var now = currentAsins(container);
      for (var n = 0; n < now.length; n++) {
        if (!seen[now[n]]) {
          originalOrder.push(now[n]);
          seen[now[n]] = true;
        }
      }
    }

    if (settings.enabled === false) {
      clearDecorations(container);
      if (currentView === "ranked") renderOriginal(container);
      if (chip) chip.style.display = "none";
      return;
    }
    if (chip) chip.style.display = "flex";

    var tiles = window.TopShelfScrape(container);
    if (!tiles.length) return;

    var results = window.TopShelfScore(tiles, settings);
    lastScored = [];
    var hiddenCount = 0;
    for (var i = 0; i < tiles.length; i++) {
      lastScored.push({ tile: tiles[i], result: results[i] });
      if (results[i].hidden) hiddenCount++;
    }

    if (chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({
        topShelfPageStats: {
          total: tiles.length,
          hidden: hiddenCount,
          time: Date.now()
        }
      });
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
  function observe(container) {
    if (!container) return;
    if (observer) observer.disconnect();
    observedContainer = container;
    observer = new MutationObserver(function (mutations) {
      if (reordering) return; // belt-and-braces; endReorder() drains our records
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
      run(); // also attaches the observer to the current container
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
