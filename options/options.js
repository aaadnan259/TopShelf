/*
 * TopShelf options page. Reads/writes chrome.storage.sync. No network.
 * Keys and defaults MUST match DEFAULTS in src/content.js.
 */
(function () {
  "use strict";

  var DEFAULTS = {
    mode: "quality",
    floor: "standard",
    sponsored: "demote",
    badges: true
  };

  var els = {
    mode: document.getElementById("mode"),
    floor: document.getElementById("floor"),
    sponsored: document.getElementById("sponsored"),
    badges: document.getElementById("badges"),
    status: document.getElementById("status")
  };

  var statusTimer = null;
  function flash(msg) {
    els.status.textContent = msg;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      els.status.textContent = "";
    }, 1500);
  }

  function restore() {
    chrome.storage.sync.get(DEFAULTS, function (s) {
      s = s || DEFAULTS;
      els.mode.value = s.mode;
      els.floor.value = s.floor;
      els.sponsored.value = s.sponsored;
      els.badges.checked = !!s.badges;
    });
  }

  function save() {
    var next = {
      mode: els.mode.value,
      floor: els.floor.value,
      sponsored: els.sponsored.value,
      badges: els.badges.checked
    };
    chrome.storage.sync.set(next, function () {
      flash("Saved. Reload any open Amazon search to see it.");
    });
  }

  // Save on every change -- the content script re-ranks live via onChanged.
  ["mode", "floor", "sponsored", "badges"].forEach(function (k) {
    els[k].addEventListener("change", save);
  });

  restore();
})();
