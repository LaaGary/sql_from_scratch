/* ==========================================================================
   sql-from-scratch tutorial site - shared behaviour
   Zero dependencies, works from file://, and degrades safely when the
   matching elements are missing.
     1) theme toggle      2) reading progress   3) chapter completion
     4) on-page contents  5) copy code          6) search
     7) mobile sidebar    8) prev/next ([ / ])  9) home roadmap rendering
   ========================================================================== */
(function () {
  "use strict";

  var docEl = document.documentElement;
  var body = document.body;
  var THEME_KEY = "sql-theme";
  var PROGRESS_KEY = "sql-progress";
  var FALLBACK_TOTAL = 10;
  var hasDOM = document.readyState !== "loading";

  /* ---------- Small helpers ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function storeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* ignore private mode / file:// limits */ }
  }

  function pad2(n) {
    var s = String(n);
    return s.length < 2 ? "0" + s : s;
  }

  function toChapterNumber(value) {
    if (value === null || value === undefined) return null;
    var m = String(value).match(/(\d+)/);
    if (!m) return null;
    var n = parseInt(m[1], 10);
    return isNaN(n) ? null : n;
  }

  function chapterFromPath() {
    var m = window.location.pathname.match(/ch(\d+)\.html?(?:[?#].*)?$/i);
    return m ? toChapterNumber(m[1]) : null;
  }

  function chapterFromHref(href) {
    if (!href) return null;
    var m = String(href).match(/ch(\d+)\.html?/i);
    return m ? toChapterNumber(m[1]) : null;
  }

  function escapeHTML(text) {
    return String(text === null || text === undefined ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function slugify(text, used) {
    var base = String(text || "section")
      .trim()
      .toLowerCase()
      .replace(/[\s\u3000]+/g, "-")
      .replace(/[~!@#$%^&*()+=[\]{}|\\:;"'<>,.?/]/g, "")
      .replace(/[\u3000-\u303f\uff00-\uffef\u4e00-\u9fff]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    if (!base) base = "section";
    if (!/^[a-z]/.test(base)) base = "sec-" + base;
    var id = base;
    var i = 2;
    while (used[id] || document.getElementById(id)) {
      id = base + "-" + i;
      i += 1;
    }
    used[id] = true;
    return id;
  }

  function chapterList() {
    return Array.isArray(window.SQL_TOC) ? window.SQL_TOC : null;
  }

  // Chapter pages live in docs/chapters/ while the hrefs in SQL_TOC are
  // relative to docs/, so prepend "../" when rendering from a chapter page.
  function tocBasePrefix() {
    var pathname = String(window.location.pathname || "").replace(/\\/g, "/");
    return /\/chapters\/[^/]*$/.test(pathname) ? "../" : "";
  }

  function chapterHref(item) {
    var href = item && typeof item.href === "string" && item.href
      ? item.href
      : "";
    if (!href) {
      var n = item && item.n ? toChapterNumber(item.n) : null;
      href = n ? "chapters/ch" + pad2(n) + ".html" : "#";
    }
    if (href.charAt(0) === "#" || /^(?:[a-z]+:)?\/\//i.test(href)) return href;
    if (/^\.\.\//.test(href)) return href;
    href = href.replace(/^\.\//, "").replace(/^\//, "");
    return tocBasePrefix() + href;
  }

  /* ---------- 1. Theme toggle ---------- */
  var Theme = {
    init: function () {
      var btn = document.getElementById("theme-toggle");
      if (!btn) return;
      this.sync(btn);
      btn.addEventListener("click", function () {
        var next = docEl.getAttribute("data-theme") === "light" ? "dark" : "light";
        docEl.setAttribute("data-theme", next);
        storeSet(THEME_KEY, next);
        Theme.sync(btn);
      });
      // Default is light. The inline bootstrap in each page already applied it
      // before first paint; this only keeps the button label in sync.
    },
    sync: function (btn) {
      var light = docEl.getAttribute("data-theme") === "light";
      btn.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
      btn.setAttribute("title", light ? "Switch to dark theme" : "Switch to light theme");
      btn.setAttribute("aria-pressed", light ? "true" : "false");
    }
  };

  /* ---------- 2. Reading progress bar ---------- */
  function initReadingProgress() {
    var bar = document.getElementById("reading-progress");
    if (!bar) return;
    var reading = body.classList.contains("page--chapter") || body.classList.contains("page--reference");
    if (!reading) { bar.style.display = "none"; return; }
    var ticking = false;
    function update() {
      ticking = false;
      var max = docEl.scrollHeight - window.innerHeight;
      var ratio = max > 0 ? window.scrollY / max : 0;
      ratio = Math.max(0, Math.min(1, ratio));
      bar.style.transform = "scaleX(" + ratio + ")";
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update);
    update();
  }

  /* ---------- 3. Chapter completion ---------- */
  var Progress = {
    read: function () {
      var raw = storeGet(PROGRESS_KEY);
      if (!raw) return [];
      try {
        var parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        var seen = {};
        return parsed.map(toChapterNumber).filter(function (n) {
          if (n === null || seen[n]) return false;
          seen[n] = true;
          return true;
        });
      } catch (e) {
        return [];
      }
    },
    write: function (list) {
      var seen = {};
      var clean = list.filter(function (n) {
        if (typeof n !== "number" || isNaN(n) || seen[n]) return false;
        seen[n] = true;
        return true;
      }).sort(function (a, b) { return a - b; });
      storeSet(PROGRESS_KEY, JSON.stringify(clean.map(String)));
      return clean;
    },
    total: function () {
      var toc = chapterList();
      return toc && toc.length ? toc.length : FALLBACK_TOTAL;
    },
    count: function () {
      var total = this.total();
      return this.read().filter(function (n) { return n >= 1 && n <= total; }).length;
    }
  };

  function initCompletion() {
    // Generated chapter pages ship their own footer; drop the layout fallback
    // so the mark-complete button only appears once.
    var articleFoot = $("article.prose .chapter-foot");
    var layoutFoot = $(".site-chapter-foot");
    if (articleFoot && layoutFoot && layoutFoot.parentNode) layoutFoot.parentNode.removeChild(layoutFoot);

    var btn = document.getElementById("mark-complete");
    var chapter = null;
    if (btn) {
      chapter = toChapterNumber(btn.getAttribute("data-chapter"));
      if (chapter === null) chapter = chapterFromPath();
      if (chapter !== null) btn.setAttribute("data-chapter", String(chapter));
      if (chapter !== null) {
        var done = Progress.read();
        if (done.indexOf(chapter) !== -1) setDone(btn, true);
        btn.addEventListener("click", function () {
          var list = Progress.read();
          var at = list.indexOf(chapter);
          if (at === -1) {
            list.push(chapter);
            setDone(btn, true);
          } else {
            list.splice(at, 1);
            setDone(btn, false);
          }
          Progress.write(list);
          syncProgressUI();
        });
      } else {
        btn.addEventListener("click", function () {
          btn.classList.toggle("is-done");
          btn.setAttribute("aria-pressed", btn.classList.contains("is-done") ? "true" : "false");
        });
      }
    }

    syncProgressUI();
  }

  function setDone(btn, done) {
    btn.classList.toggle("is-done", done);
    btn.setAttribute("aria-pressed", done ? "true" : "false");
    btn.textContent = done ? "\u2713 Chapter complete (click to undo)" : "Mark chapter complete";
  }

  function syncProgressUI() {
    var done = Progress.read();
    var total = Progress.total();
    var count = done.filter(function (n) { return n >= 1 && n <= total; }).length;
    var label = count + "/" + total + " complete";
    $$("[data-progress-label]").forEach(function (el) { el.textContent = label; });

    var current = chapterFromPath();
    $$("a.toc-link, a.toc-list a").forEach(function (link) {
      var n = chapterFromHref(link.getAttribute("href"));
      if (n === null) return;
      var isDone = done.indexOf(n) !== -1;
      link.classList.toggle("is-done", isDone);
      if (current !== null) link.classList.toggle("is-current", n === current);
      if (isDone) link.setAttribute("data-done", "true");
      else link.removeAttribute("data-done");
    });

    $$(".roadmap__item").forEach(function (item) {
      var n = chapterFromHref(item.getAttribute("data-chapter")) || toChapterNumber(item.getAttribute("data-chapter"));
      if (n === null) return;
      item.classList.toggle("is-done", done.indexOf(n) !== -1);
    });
  }

  /* ---------- 4. On-page contents ---------- */
  function initPageToc() {
    var host = document.getElementById("page-toc");
    if (!host) return;
    var article = $("article.prose") || $(".prose");
    if (!article) {
      host.innerHTML = '<p class="page-toc__heading">On this page</p><p class="page-toc__empty">No contents on this page</p>';
      return;
    }
    var headings = $$("h2, h3", article).filter(function (h) {
      if (h.closest(".callout, .chapter-meta, .file, .checkpoint, .exercise")) return false;
      return (h.textContent || "").trim().length > 0;
    });
    if (!headings.length) {
      host.innerHTML = '<p class="page-toc__heading">On this page</p><p class="page-toc__empty">This chapter has no section headings</p>';
      return;
    }

    var usedIds = {};
    var links = [];
    var list = document.createElement("ol");
    list.className = "page-toc__list";

    headings.forEach(function (heading) {
      if (!heading.id) heading.id = slugify(heading.textContent, usedIds);
      else usedIds[heading.id] = true;

      var li = document.createElement("li");
      li.className = heading.tagName === "H3" ? "toc-h3" : "toc-h2";
      var a = document.createElement("a");
      a.href = "#" + heading.id;
      a.textContent = (heading.textContent || "").trim();
      li.appendChild(a);
      list.appendChild(li);
      links.push({ id: heading.id, a: a });
    });

    host.innerHTML = "";
    var label = document.createElement("p");
    label.className = "page-toc__heading";
    label.textContent = "On this page";
    host.appendChild(label);
    host.appendChild(list);

    var linkMap = {};
    links.forEach(function (entry) { linkMap[entry.id] = entry.a; });

    var currentId = null;
    function setActive(id) {
      if (!id || id === currentId || !linkMap[id]) return;
      currentId = id;
      links.forEach(function (entry) { entry.a.classList.toggle("is-active", entry.id === id); });
    }

    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) setActive(entry.target.id);
        });
      }, { rootMargin: "-80px 0px -68% 0px", threshold: 0 });
      headings.forEach(function (heading) { observer.observe(heading); });
    } else {
      var onScroll = function () {
        var offset = 96;
        var active = headings[0] ? headings[0].id : null;
        headings.forEach(function (heading) {
          if (heading.getBoundingClientRect().top <= offset) active = heading.id;
        });
        setActive(active);
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
    }

    // Move focus to the heading after a TOC click so keyboard users keep place.
    list.addEventListener("click", function (event) {
      var a = event.target.closest ? event.target.closest("a") : null;
      if (!a) return;
      var id = a.getAttribute("href").slice(1);
      var target = document.getElementById(id);
      if (!target) return;
      target.setAttribute("tabindex", "-1");
      window.setTimeout(function () { target.focus({ preventScroll: true }); }, 60);
    });
  }

  /* ---------- 5. Copy code blocks ---------- */
  function copyText(text, done) {
    function fallback() {
      var ok = false;
      try {
        var area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.top = "-2000px";
        area.style.left = "0";
        document.body.appendChild(area);
        area.select();
        area.setSelectionRange(0, area.value.length);
        ok = document.execCommand("copy");
        document.body.removeChild(area);
      } catch (e) {
        ok = false;
      }
      done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    } else {
      fallback();
    }
  }

  function initCopyButtons() {
    $$("pre.code").forEach(function (pre) {
      if (pre.getAttribute("data-copy-ready") === "true") return;
      pre.setAttribute("data-copy-ready", "true");

      var button = document.createElement("button");
      button.type = "button";
      button.className = "copy-btn";
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy this code block");

      var file = pre.closest ? pre.closest(".file") : null;
      var head = file ? $(".file__head", file) : null;
      if (head) head.appendChild(button);
      else pre.appendChild(button);

      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        var code = pre.querySelector("code") || pre;
        var text = (code.innerText || code.textContent || "").replace(/\n+$/, "");
        copyText(text, function (ok) {
          button.textContent = ok ? "Copied" : "Copy failed";
          button.classList.add("is-copied");
          window.setTimeout(function () {
            button.textContent = "Copy";
            button.classList.remove("is-copied");
          }, 1600);
        });
      });
    });
  }

  /* ---------- 6. Search ---------- */
  var Search = {
    overlay: null,
    input: null,
    results: null,
    entries: [],
    activeIndex: -1,
    opener: null,
    open: function () {
      if (!this.overlay) return;
      this.opener = document.activeElement;
      this.overlay.classList.add("is-open");
      this.overlay.setAttribute("aria-hidden", "false");
      body.classList.add("is-search-open");
      if (this.input) {
        this.input.value = "";
        this.render("");
        window.setTimeout(function () {
          try { Search.input.focus({ preventScroll: true }); } catch (e) { Search.input.focus(); }
        }, 20);
      }
    },
    close: function () {
      if (!this.overlay) return;
      this.overlay.classList.remove("is-open");
      this.overlay.setAttribute("aria-hidden", "true");
      body.classList.remove("is-search-open");
      this.activeIndex = -1;
      if (this.opener && this.opener.focus) {
        try { this.opener.focus({ preventScroll: true }); } catch (e) { /* noop */ }
      }
    },
    isOpen: function () {
      return this.overlay ? this.overlay.classList.contains("is-open") : false;
    },
    buildEntries: function () {
      var toc = chapterList();
      if (toc && toc.length) {
        return toc.map(function (item) {
          var n = toChapterNumber(item.n);
          return {
            n: n,
            num: n ? pad2(n) : "\u00b7\u00b7",
            title: item.title || ("Chapter " + (n || "?")),
            summary: item.summary || "",
            href: chapterHref(item)
          };
        });
      }
      // No toc.js: fall back to the h2/h3 headings of the current page.
      var article = $("article.prose") || $(".prose");
      if (!article) return [];
      return $$("h2, h3", article).map(function (heading) {
        if (!heading.id) heading.id = slugify(heading.textContent, {});
        return {
          n: null,
          num: heading.tagName === "H3" ? "\u00b7" : "\u25b8",
          title: (heading.textContent || "").trim(),
          summary: "Section on this page",
          href: "#" + heading.id
        };
      });
    },
    render: function (query) {
      if (!this.results) return;
      var q = String(query || "").trim().toLowerCase();
      var entries = this.entries;
      var matched = entries.filter(function (entry) {
        if (!q) return true;
        return (entry.title + " " + entry.summary).toLowerCase().indexOf(q) !== -1;
      });
      this.activeIndex = matched.length ? 0 : -1;
      if (!matched.length) {
        this.results.innerHTML = '<li class="search-empty">No chapters match \u201c' + escapeHTML(q) + '\u201d. Try \u201cselect\u201d, \u201cindex\u201d, or \u201ctransaction\u201d.</li>';
        return;
      }
      this.results.innerHTML = matched.map(function (entry, index) {
        return '<li>' +
          '<a class="search-result' + (index === 0 ? " is-active" : "") + '" href="' + escapeHTML(entry.href) + '" data-index="' + index + '">' +
            '<span class="search-result__num">' + escapeHTML(entry.num) + '</span>' +
            '<span class="search-result__title">' + escapeHTML(entry.title) + '</span>' +
            (entry.summary ? '<span class="search-result__summary">' + escapeHTML(entry.summary) + '</span>' : "") +
          '</a>' +
        '</li>';
      }).join("");
    },
    move: function (delta) {
      if (!this.results) return;
      var items = $$(".search-result", this.results);
      if (!items.length) return;
      this.activeIndex = (this.activeIndex + delta + items.length) % items.length;
      items.forEach(function (item, index) {
        item.classList.toggle("is-active", index === Search.activeIndex);
      });
      var active = items[this.activeIndex];
      if (active && active.scrollIntoView) {
        active.scrollIntoView({ block: "nearest" });
      }
    },
    go: function () {
      if (!this.results) return;
      var items = $$(".search-result", this.results);
      var target = items[this.activeIndex >= 0 ? this.activeIndex : 0] || items[0];
      if (target && target.getAttribute("href")) window.location.href = target.getAttribute("href");
    },
    init: function () {
      this.overlay = document.getElementById("search-overlay");
      this.input = document.getElementById("search-input");
      this.results = document.getElementById("search-results");
      var toggle = document.getElementById("search-toggle");
      if (!this.overlay || !this.input || !this.results) return;
      this.entries = this.buildEntries();

      var self = this;
      if (toggle) {
        toggle.addEventListener("click", function () {
          if (self.isOpen()) self.close();
          else self.open();
        });
      }
      this.input.addEventListener("input", function () { self.render(self.input.value); });
      this.input.addEventListener("keydown", function (event) {
        if (event.key === "ArrowDown") { event.preventDefault(); self.move(1); }
        else if (event.key === "ArrowUp") { event.preventDefault(); self.move(-1); }
        else if (event.key === "Enter") { event.preventDefault(); self.go(); }
      });
      this.overlay.addEventListener("click", function (event) {
        if (event.target === self.overlay) self.close();
      });
      this.results.addEventListener("click", function (event) {
        var link = event.target.closest ? event.target.closest("a") : null;
        if (link) self.close();
      });
      this.overlay.addEventListener("keydown", function (event) {
        if (event.key === "Escape") { event.preventDefault(); self.close(); }
      });
    }
  };

  function initGlobalKeys() {
    document.addEventListener("keydown", function (event) {
      var target = event.target;
      var tag = target && target.tagName ? target.tagName : "";
      var typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
        (target && target.isContentEditable);

      if (event.key === "Escape") {
        if (Search.isOpen()) { Search.close(); return; }
        var sidebar = document.getElementById("sidebar");
        if (sidebar && sidebar.classList.contains("is-open")) {
          sidebar.classList.remove("is-open");
          var overlay = document.getElementById("sidebar-overlay");
          if (overlay) overlay.classList.remove("is-open");
          var toggle = document.getElementById("sidebar-toggle");
          if (toggle) toggle.setAttribute("aria-expanded", "false");
        }
        return;
      }

      if (typing) return;

      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        var overlayEl = document.getElementById("search-overlay");
        if (!overlayEl) return;
        event.preventDefault();
        Search.open();
        return;
      }
      if (event.key === "[" || event.key === "]") {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        var url = body.getAttribute(event.key === "[" ? "data-prev-url" : "data-next-url");
        if (url) {
          event.preventDefault();
          window.location.href = url;
        }
      }
    });
  }

  /* ---------- 7. Mobile sidebar ---------- */
  function initSidebar() {
    var toggle = document.getElementById("sidebar-toggle");
    var sidebar = document.getElementById("sidebar");
    var overlay = document.getElementById("sidebar-overlay");
    if (!sidebar) return;
    function setOpen(open) {
      sidebar.classList.toggle("is-open", open);
      if (overlay) overlay.classList.toggle("is-open", open);
      if (toggle) {
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.setAttribute("aria-label", open ? "Close chapter navigation" : "Open chapter navigation");
      }
    }
    if (toggle) {
      toggle.addEventListener("click", function () {
        setOpen(!sidebar.classList.contains("is-open"));
      });
    }
    if (overlay) overlay.addEventListener("click", function () { setOpen(false); });
    sidebar.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest("a") : null;
      if (link && window.innerWidth <= 980) setOpen(false);
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 980) setOpen(false);
    });
  }

  /* ---------- 9. Home page: roadmap and sidebar rendered from SQL_TOC ---------- */
  function renderHomeToc() {
    var toc = chapterList();
    var roadmap = document.getElementById("roadmap-list");
    var skeleton = document.getElementById("roadmap-skeleton");
    var homeNav = document.getElementById("home-nav");

    if (!toc || !toc.length) {
      if (skeleton) skeleton.hidden = true;
      if (roadmap) roadmap.hidden = false;
      return;
    }

    if (roadmap) {
      roadmap.innerHTML = toc.map(function (item) {
        var n = toChapterNumber(item.n);
        var href = chapterHref(item);
        var minutes = item.minutes || item.time || item.eta || "";
        var meta = n ? "Chapter " + pad2(n) : "Chapter";
        if (minutes) {
          var mins = String(minutes).replace(/\s*(?:minutes?|min|\u5206|\u5206\u9418)\s*$/i, "");
          meta += " \u00b7 ~" + mins + " min";
        } else {
          meta += " \u00b7 ~30 min";
        }
        return '<li class="roadmap__item" data-chapter="' + (n || "") + '">' +
          '<a class="roadmap__card" href="' + escapeHTML(href) + '">' +
            '<span class="roadmap__num">' + escapeHTML(n ? pad2(n) : "\u00b7\u00b7") + '</span>' +
            '<span class="roadmap__title">' + escapeHTML(item.title || ("Chapter " + n)) + '</span>' +
            '<span class="roadmap__summary">' + escapeHTML(item.summary || "") + '</span>' +
            '<span class="roadmap__meta">' + escapeHTML(meta) + '</span>' +
          '</a>' +
        '</li>';
      }).join("");
      roadmap.hidden = false;
    }
    if (skeleton) skeleton.hidden = true;

    if (homeNav) {
      homeNav.innerHTML = toc.map(function (item) {
        var n = toChapterNumber(item.n);
        return '<li><a class="toc-link" href="' + escapeHTML(chapterHref(item)) + '">' +
          '<span class="toc-num">' + escapeHTML(n ? pad2(n) : "\u00b7\u00b7") + '</span>' +
          '<span class="toc-title">' + escapeHTML(item.title || ("Chapter " + n)) + '</span>' +
        '</a></li>';
      }).join("");
    }
  }

  /* ---------- Boot ---------- */
  function boot() {
    Theme.init();
    initSidebar();
    renderHomeToc();
    initCompletion();
    initPageToc();
    initCopyButtons();
    initReadingProgress();
    initGlobalKeys();
    Search.init();
    syncProgressUI();
  }

  if (hasDOM) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
