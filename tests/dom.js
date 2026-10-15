/*
 * A tiny, dependency-free HTML parser + DOM, just big enough to run
 * src/scraper.js against saved Amazon search pages under plain `node`.
 *
 * Why not jsdom: the test command is `node tests/run.js` with nothing to
 * install, and the extension itself has zero dependencies. The scraper only
 * needs querySelector(All), closest, getAttribute, parentElement,
 * textContent and dataset, so that is all this implements.
 *
 * Selector support: type, *, .class, #id, [attr], [attr=v], [attr*=v],
 * [attr^=v], [attr$=v], [attr~=v], :not(<selector list>), selector lists,
 * and the descendant / > / + / ~ combinators. Anything else THROWS, so an
 * unsupported selector in scraper.js fails loudly instead of silently
 * matching nothing (scraper.js's q() would swallow it -- run.js checks
 * every SELECTORS entry parses up front for that reason).
 */
"use strict";

// ---------------------------------------------------------------- parser

var VOID = {
  area: 1, base: 1, br: 1, col: 1, embed: 1, hr: 1, img: 1, input: 1,
  link: 1, meta: 1, param: 1, source: 1, track: 1, wbr: 1
};
// Content of these is raw text, not markup (real saved pages are full of
// inline <script> containing "<div" strings).
var RAW_TEXT = { script: 1, style: 1, textarea: 1, title: 1, noscript: 1 };

var ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (all, body) {
    if (body[0] === "#") {
      var code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return isNaN(code) ? all : String.fromCodePoint(code);
    }
    var k = body.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENTITIES, k) ? ENTITIES[k] : all;
  });
}

function Node(type) {
  this.nodeType = type;
  this.parentNode = null;
  this.childNodes = [];
}

function Text(data) {
  Node.call(this, 3);
  this.data = data;
}
Text.prototype = Object.create(Node.prototype);
Object.defineProperty(Text.prototype, "textContent", {
  get: function () {
    return this.data;
  }
});

function Element(tag, attrs) {
  Node.call(this, 1);
  this.tagName = tag.toUpperCase();
  this.localName = tag.toLowerCase();
  this.attributes = attrs || {};
}
Element.prototype = Object.create(Node.prototype);

Element.prototype.getAttribute = function (name) {
  var k = name.toLowerCase();
  return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
};
Element.prototype.hasAttribute = function (name) {
  return Object.prototype.hasOwnProperty.call(this.attributes, name.toLowerCase());
};

Object.defineProperty(Element.prototype, "parentElement", {
  get: function () {
    var p = this.parentNode;
    return p && p.nodeType === 1 ? p : null;
  }
});
Object.defineProperty(Element.prototype, "children", {
  get: function () {
    return this.childNodes.filter(function (n) {
      return n.nodeType === 1;
    });
  }
});
Object.defineProperty(Element.prototype, "textContent", {
  get: function () {
    var out = "";
    (function walk(n) {
      for (var i = 0; i < n.childNodes.length; i++) {
        var c = n.childNodes[i];
        if (c.nodeType === 3) out += c.data;
        else walk(c);
      }
    })(this);
    return out;
  }
});
Object.defineProperty(Element.prototype, "className", {
  get: function () {
    return this.getAttribute("class") || "";
  }
});
// data-ko-verdict -> dataset.koVerdict, as browsers do.
Object.defineProperty(Element.prototype, "dataset", {
  get: function () {
    var ds = {};
    for (var k in this.attributes) {
      if (k.indexOf("data-") === 0) {
        ds[k.slice(5).replace(/-([a-z])/g, function (m, c) {
          return c.toUpperCase();
        })] = this.attributes[k];
      }
    }
    return ds;
  }
});

Element.prototype.matches = function (sel) {
  return matchesList(this, parseSelectorList(sel));
};
Element.prototype.closest = function (sel) {
  var list = parseSelectorList(sel);
  for (var el = this; el; el = el.parentElement) {
    if (matchesList(el, list)) return el;
  }
  return null;
};
Element.prototype.querySelectorAll = function (sel) {
  var list = parseSelectorList(sel);
  var out = [];
  (function walk(n) {
    for (var i = 0; i < n.childNodes.length; i++) {
      var c = n.childNodes[i];
      if (c.nodeType !== 1) continue;
      if (matchesList(c, list)) out.push(c);
      walk(c);
    }
  })(this);
  return out;
};
Element.prototype.querySelector = function (sel) {
  return this.querySelectorAll(sel)[0] || null;
};

// The document is an element-like root so querySelector works on it too.
function Document() {
  Element.call(this, "#document", {});
  this.nodeType = 9;
}
Document.prototype = Object.create(Element.prototype);
Object.defineProperty(Document.prototype, "parentElement", {
  get: function () {
    return null;
  }
});

function parseHTML(html) {
  var doc = new Document();
  var stack = [doc];
  var i = 0;
  var len = html.length;

  function top() {
    return stack[stack.length - 1];
  }
  function append(node) {
    node.parentNode = top();
    top().childNodes.push(node);
  }

  while (i < len) {
    var lt = html.indexOf("<", i);
    if (lt === -1) lt = len;
    if (lt > i) append(new Text(decodeEntities(html.slice(i, lt))));
    if (lt >= len) break;
    i = lt;

    if (html.startsWith("<!--", i)) {
      var endC = html.indexOf("-->", i + 4);
      i = endC === -1 ? len : endC + 3;
      continue;
    }
    if (html[i + 1] === "!" || html[i + 1] === "?") {
      // <!DOCTYPE ...>, <![CDATA[...]]>, <?xml ...?>: skip.
      var endD = html.indexOf(">", i);
      i = endD === -1 ? len : endD + 1;
      continue;
    }
    if (html[i + 1] === "/") {
      var endT = html.indexOf(">", i);
      var name = html.slice(i + 2, endT === -1 ? len : endT).trim().toLowerCase();
      i = endT === -1 ? len : endT + 1;
      // Pop to the matching open element; ignore stray end tags.
      for (var s = stack.length - 1; s > 0; s--) {
        if (stack[s].localName === name) {
          stack.length = s;
          break;
        }
      }
      continue;
    }

    var tagMatch = /^<([a-zA-Z][\w:-]*)/.exec(html.slice(i, i + 64));
    if (!tagMatch) {
      // A bare "<" in text.
      append(new Text("<"));
      i++;
      continue;
    }
    var tag = tagMatch[1].toLowerCase();
    i += tagMatch[0].length;

    var attrs = {};
    var selfClose = false;
    var attrRe = /\s*([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?|\s*(\/?)>/y;
    for (;;) {
      attrRe.lastIndex = i;
      var m = attrRe.exec(html);
      if (!m) {
        // Malformed tag: bail to the next ">".
        var gt = html.indexOf(">", i);
        i = gt === -1 ? len : gt + 1;
        break;
      }
      i = attrRe.lastIndex;
      if (m[1] === undefined) {
        selfClose = m[5] === "/";
        break;
      }
      var val = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
      var key = m[1].toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(attrs, key)) attrs[key] = decodeEntities(val);
    }

    var el = new Element(tag, attrs);
    append(el);
    if (VOID[tag] || selfClose) continue;

    if (RAW_TEXT[tag]) {
      var close = html.toLowerCase().indexOf("</" + tag, i);
      if (close === -1) close = len;
      if (close > i) {
        var t = new Text(tag === "textarea" || tag === "title" ? decodeEntities(html.slice(i, close)) : html.slice(i, close));
        t.parentNode = el;
        el.childNodes.push(t);
      }
      var gt2 = html.indexOf(">", close);
      i = gt2 === -1 ? len : gt2 + 1;
      continue;
    }
    stack.push(el);
  }
  return doc;
}

// -------------------------------------------------------------- selectors

var cache = {};

function parseSelectorList(sel) {
  if (Object.prototype.hasOwnProperty.call(cache, sel)) return cache[sel];
  var p = { s: sel, i: 0 };
  var list = readList(p, false);
  skipWs(p);
  if (p.i !== sel.length) throw new SyntaxError("dom.js: unsupported selector near: " + sel.slice(p.i));
  cache[sel] = list;
  return list;
}

function skipWs(p) {
  while (p.i < p.s.length && /\s/.test(p.s[p.i])) p.i++;
}

function readList(p, inParen) {
  var list = [readComplex(p)];
  for (;;) {
    skipWs(p);
    if (p.s[p.i] === ",") {
      p.i++;
      list.push(readComplex(p));
    } else break;
  }
  if (inParen) {
    if (p.s[p.i] !== ")") throw new SyntaxError("dom.js: expected ) in " + p.s);
    p.i++;
  }
  return list;
}

// A complex selector is stored right-to-left: [{compound, comb}, ...] where
// comb is how this compound relates to the NEXT entry (its left neighbour).
function readComplex(p) {
  skipWs(p);
  var parts = [{ compound: readCompound(p), comb: null }];
  for (;;) {
    var start = p.i;
    skipWs(p);
    var c = p.s[p.i];
    var comb;
    if (c === ">" || c === "+" || c === "~") {
      comb = c;
      p.i++;
      skipWs(p);
    } else if (p.i > start && p.i < p.s.length && c !== "," && c !== ")") {
      comb = " ";
    } else {
      p.i = start;
      break;
    }
    // Stored on the right-hand compound: it says how to step leftwards.
    parts.push({ compound: readCompound(p), comb: comb });
  }
  parts.reverse();
  return parts;
}

function readIdent(p) {
  var m = /^-?[_a-zA-Z][\w-]*/.exec(p.s.slice(p.i));
  if (!m) throw new SyntaxError("dom.js: expected identifier in " + p.s + " at " + p.i);
  p.i += m[0].length;
  return m[0];
}

function readCompound(p) {
  var cmp = { tag: null, ids: [], classes: [], attrs: [], nots: [] };
  var any = false;
  if (p.s[p.i] === "*") {
    p.i++;
    any = true;
  } else if (/[a-zA-Z]/.test(p.s[p.i] || "")) {
    cmp.tag = readIdent(p).toLowerCase();
    any = true;
  }
  for (;;) {
    var c = p.s[p.i];
    if (c === ".") {
      p.i++;
      cmp.classes.push(readIdent(p));
    } else if (c === "#") {
      p.i++;
      cmp.ids.push(readIdent(p));
    } else if (c === "[") {
      p.i++;
      skipWs(p);
      var name = readIdent(p).toLowerCase();
      skipWs(p);
      var op = null;
      var val = null;
      var m = /^([*^$~|]?=)/.exec(p.s.slice(p.i));
      if (m) {
        op = m[1];
        p.i += op.length;
        skipWs(p);
        var q = p.s[p.i];
        if (q === '"' || q === "'") {
          var end = p.s.indexOf(q, p.i + 1);
          if (end === -1) throw new SyntaxError("dom.js: unterminated string in " + p.s);
          val = p.s.slice(p.i + 1, end);
          p.i = end + 1;
        } else {
          val = readIdent(p);
        }
        skipWs(p);
      }
      if (p.s[p.i] !== "]") throw new SyntaxError("dom.js: expected ] in " + p.s);
      p.i++;
      cmp.attrs.push({ name: name, op: op, val: val });
    } else if (p.s.startsWith(":not(", p.i)) {
      p.i += 5;
      cmp.nots.push(readList(p, true));
    } else if (c === ":") {
      throw new SyntaxError("dom.js: unsupported pseudo-class in " + p.s);
    } else break;
    any = true;
  }
  if (!any) throw new SyntaxError("dom.js: empty compound selector in " + p.s + " at " + p.i);
  return cmp;
}

function matchCompound(el, cmp) {
  if (el.nodeType !== 1) return false;
  if (cmp.tag && el.localName !== cmp.tag) return false;
  var i;
  for (i = 0; i < cmp.ids.length; i++) {
    if (el.getAttribute("id") !== cmp.ids[i]) return false;
  }
  if (cmp.classes.length) {
    var cls = " " + el.className.split(/\s+/).join(" ") + " ";
    for (i = 0; i < cmp.classes.length; i++) {
      if (cls.indexOf(" " + cmp.classes[i] + " ") === -1) return false;
    }
  }
  for (i = 0; i < cmp.attrs.length; i++) {
    var a = cmp.attrs[i];
    var v = el.getAttribute(a.name);
    if (v === null) return false;
    if (a.op === "=" && v !== a.val) return false;
    if (a.op === "*=" && (a.val === "" || v.indexOf(a.val) === -1)) return false;
    if (a.op === "^=" && (a.val === "" || v.indexOf(a.val) !== 0)) return false;
    if (a.op === "$=" && (a.val === "" || v.slice(-a.val.length) !== a.val)) return false;
    if (a.op === "~=" && (" " + v.split(/\s+/).join(" ") + " ").indexOf(" " + a.val + " ") === -1) return false;
    if (a.op === "|=" && v !== a.val && v.indexOf(a.val + "-") !== 0) return false;
  }
  for (i = 0; i < cmp.nots.length; i++) {
    if (matchesList(el, cmp.nots[i])) return false;
  }
  return true;
}

function prevElement(el) {
  var sibs = el.parentNode ? el.parentNode.childNodes : [];
  for (var i = sibs.indexOf(el) - 1; i >= 0; i--) {
    if (sibs[i].nodeType === 1) return sibs[i];
  }
  return null;
}

// parts is right-to-left; parts[k].comb links parts[k] to parts[k+1].
function matchComplex(el, parts, k) {
  if (!matchCompound(el, parts[k].compound)) return false;
  if (k === parts.length - 1) return true;
  var comb = parts[k].comb;
  var n;
  if (comb === ">") {
    n = el.parentElement;
    return !!n && matchComplex(n, parts, k + 1);
  }
  if (comb === " ") {
    for (n = el.parentElement; n; n = n.parentElement) {
      if (matchComplex(n, parts, k + 1)) return true;
    }
    return false;
  }
  if (comb === "+") {
    n = prevElement(el);
    return !!n && matchComplex(n, parts, k + 1);
  }
  if (comb === "~") {
    for (n = prevElement(el); n; n = prevElement(n)) {
      if (matchComplex(n, parts, k + 1)) return true;
    }
    return false;
  }
  return false;
}

function matchesList(el, list) {
  if (el.nodeType !== 1) return false;
  for (var i = 0; i < list.length; i++) {
    if (matchComplex(el, list[i], 0)) return true;
  }
  return false;
}

module.exports = { parseHTML: parseHTML, parseSelectorList: parseSelectorList };
