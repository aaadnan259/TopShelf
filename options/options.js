/*
 * TopShelf popup & options script.
 * Reads/writes chrome.storage.sync for user preferences and reads
 * chrome.storage.local for live page stats.
 * Zero network requests. Zero tracking.
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

  var state = Object.assign({}, DEFAULTS);

  var els = {
    enabled: document.getElementById("opt-enabled"),
    badges: document.getElementById("opt-badges"),
    statTotal: document.getElementById("stat-total"),
    statTotalSub: document.getElementById("stat-total-sub"),
    statHidden: document.getElementById("stat-hidden"),
    statHiddenSub: document.getElementById("stat-hidden-sub"),
    segGroups: document.querySelectorAll(".seg-group")
  };

  function setSegValue(groupEl, val) {
    var btns = groupEl.querySelectorAll(".seg-btn");
    for (var i = 0; i < btns.length; i++) {
      var isMatch = btns[i].getAttribute("data-val") === val;
      btns[i].setAttribute("aria-checked", isMatch ? "true" : "false");
    }
  }

  function getSegValue(groupEl) {
    var active = groupEl.querySelector('.seg-btn[aria-checked="true"]');
    return active ? active.getAttribute("data-val") : null;
  }

  function renderState() {
    if (els.enabled) els.enabled.checked = !!state.enabled;
    if (els.badges) els.badges.checked = !!state.badges;

    for (var i = 0; i < els.segGroups.length; i++) {
      var grp = els.segGroups[i];
      var key = grp.getAttribute("data-for");
      if (state[key] !== undefined) {
        setSegValue(grp, state[key]);
      }
    }
  }

  function save() {
    state.enabled = !!(els.enabled && els.enabled.checked);
    state.badges = !!(els.badges && els.badges.checked);

    for (var i = 0; i < els.segGroups.length; i++) {
      var grp = els.segGroups[i];
      var key = grp.getAttribute("data-for");
      var val = getSegValue(grp);
      if (val !== null) state[key] = val;
    }

    if (chrome && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set(state);
    }
  }

  function loadSettings() {
    if (!chrome || !chrome.storage || !chrome.storage.sync) {
      renderState();
      return;
    }
    chrome.storage.sync.get(DEFAULTS, function (stored) {
      state = Object.assign({}, DEFAULTS, stored || {});
      renderState();
    });
  }

  function loadStats() {
    if (!chrome || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(["topShelfPageStats"], function (res) {
      var stats = res && res.topShelfPageStats;
      // If stats are recent (within 45 minutes) and non-zero
      if (stats && stats.total !== undefined && Date.now() - (stats.time || 0) < 45 * 60 * 1000) {
        if (els.statTotal) els.statTotal.textContent = stats.total;
        if (els.statTotalSub) els.statTotalSub.textContent = "On current search";
        if (els.statHidden) els.statHidden.textContent = stats.hidden;
        if (els.statHiddenSub) {
          els.statHiddenSub.textContent = stats.hidden > 0 ? "Filtered below floor" : "None below floor";
        }
      }
    });
  }

  // Setup event listeners
  function initEvents() {
    if (els.enabled) {
      els.enabled.addEventListener("change", save);
    }
    if (els.badges) {
      els.badges.addEventListener("change", save);
    }

    for (var i = 0; i < els.segGroups.length; i++) {
      (function (grp) {
        grp.addEventListener("click", function (e) {
          var btn = e.target.closest(".seg-btn");
          if (!btn) return;
          var val = btn.getAttribute("data-val");
          setSegValue(grp, val);
          save();
        });
      })(els.segGroups[i]);
    }
  }

  initEvents();
  loadSettings();
  loadStats();
})();
