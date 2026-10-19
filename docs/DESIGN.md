# Design and class contract

This document records the design decisions behind the tutorial site front end, the build contract, and the class structure that every article generated from `docs/content/` must follow.

Maintainer: site-dev. Related files: `docs/_layout.html`, `docs/assets/style.css`, `docs/assets/site.js`, `docs/index.html`, `docs/playground.html`, `docs/assets/playground.js`, `tools/serve.mjs`.

---

## 1. Design direction

A quiet, warm-paper reading experience — closer to a printed book than to a marketing page:

- **Warm beige paper** (`#f4efe4`) with slightly lighter panels for cards, tables, and code. Light is the default theme; the optional dark theme is a warm charcoal, not a blue-black terminal.
- **Ink, olive, and terracotta.** Body text is a warm near-black (`#2b2721`); links and active states use a restrained olive (`#566245`); chapter numbers, kickers, and small accents use terracotta (`#95572e`).
- **Flat surfaces, hairline rules, small radii.** No grid texture, no glows, no gradients, no large shadows, no glassmorphism. Borders are 1px; radii are 2–4px; whitespace carries the hierarchy.
- **Serif headings, system sans body, mono code.** All fonts are system stacks: **zero external fonts, zero CDNs, zero external images**.
- Everything works when opened directly through `file://`; no `fetch()`, no JSON files. Chapter data comes from `window.SQL_TOC` in the generated `toc.js`.

Both themes must stay readable: every color is a CSS variable defined in `:root` (light, default) and `html[data-theme="dark"]`.

---

## 2. Color and type tokens

| Token | Light (default) | Dark | Purpose |
| --- | --- | --- | --- |
| `--bg` | `#f4efe4` | `#1b1916` | Page background |
| `--bg-soft` | `#efe9db` | `#1f1d19` | Header, sidebar, status bar |
| `--panel` | `#fbf7ee` | `#24211c` | Cards, callouts, tables |
| `--panel-2` | `#f7f2e7` | `#2a2620` | Second-level panels, table heads |
| `--ink` | `#2b2721` | `#e4dcce` | Body text |
| `--ink-strong` | `#26221c` | `#f5efe4` | Headings |
| `--ink-muted` | `#6e675c` | `#aca293` | Secondary text |
| `--ink-faint` | `#6f6759` | `#948b7c` | Labels, meta, captions |
| `--line` | `#e2d9c8` | `#35302a` | Hairlines |
| `--line-strong` | `#cec2aa` | `#4a433a` | Emphasized borders |
| `--accent` | `#566245` | `#b3c49c` | Links, focus, active state (olive) |
| `--secondary` | `#95572e` | `#d9a077` | Chapter numbers, kickers (terracotta) |
| `--danger` | `#9a3b2c` | `#e89a83` | Errors |
| `--success` | `#4f6b45` | `#a9c79a` | Completion, success text |
| `--note` | `#4a6178` | `#9db6c9` | Note callouts |
| `--code-bg` | `#efe9db` | `#151310` | Code block background |
| `--code-ink` | `#2e2a24` | `#e6ddcb` | Code block text |

Contrast: all body, label, link, and code pairs meet WCAG AA (at least 4.5:1) in both themes. `--ink-faint` is deliberately darker than a typical "muted" gray so 10–12px monospace labels stay legible.

Syntax highlighting uses `--tk-kw` (keyword, terracotta), `--tk-str` (string, olive), `--tk-num`, `--tk-com` (comment, italic), `--tk-fn` (function), `--tk-type` (type, blue-gray), `--tk-op` (operator), and `--tk-ident` (identifier). Each token color is tuned for its code background.

Type stacks:

    --font-serif: Georgia, "Iowan Old Style", "Palatino Linotype", "Noto Serif", "Songti TC", "Times New Roman", serif
    --font-sans:  system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Microsoft JhengHei", sans-serif
    --font-mono:  ui-monospace, "SFMono-Regular", "Cascadia Code", Menlo, Consolas, "Liberation Mono", "Courier New", monospace

---

## 3. Layout and breakpoints

| Width | Behavior |
| --- | --- |
| `>= 1200px` | Fixed left sidebar (272px) + 74ch article column + right on-page TOC (232px) |
| `981–1199px` | Sidebar stays; right-hand TOC is hidden |
| `<= 980px` | Sidebar becomes a drawer (opened by `#sidebar-toggle`, closed by overlay or Esc); `#sidebar-toggle` only appears at this width |
| `<= 640px` | Header hides the chapter label and progress text; article padding shrinks; single-column pager, metadata, and vocabulary |
| `<= 520px` | Header keeps only the `SQL` mark (brand name hidden) so search and theme buttons never overflow |

- Header is sticky, 56px tall (`--header-h`); `#reading-progress` is a fixed 2px bar at the top.
- Home and playground use the block version of `.layout` (the home page still has the sidebar; the playground has no sidebar, so its header omits `#sidebar-toggle`).
- Article text is capped at `74ch`; prose line-height is 1.75.
- Print styles hide header, sidebar, TOC, footer, and copy buttons, and let code wrap.

---

## 4. Theme switching

- The `<head>` of `_layout.html`, `index.html`, and `playground.html` contains an inline bootstrap that reads `localStorage["sql-theme"]` and sets `<html data-theme>` before first paint. **When no value is stored the default is `light`.**
- `#theme-toggle` is wired by `site.js`; each click writes `localStorage["sql-theme"]`.
- Icons are controlled by CSS: `.theme-icon--sun` is shown in light mode and `.theme-icon--moon` in dark mode.
- `:root` carries the light palette; `html[data-theme="dark"]` overrides the same variables. No component hard-codes a hex value.

---

## 5. Build contract: `docs/_layout.html`

The build script (`tools/build-docs.mjs`) fills the following placeholders by string replacement. **No other placeholders exist:**

| Placeholder | Content |
| --- | --- |
| `{{PAGE_KIND}}` | Goes into `<body class="page page--{{PAGE_KIND}}">` and `data-page-kind`; values are `home`, `chapter`, `reference`, `playground`. Generated chapter pages use `chapter`; the reference page uses `reference`. |
| `{{TITLE}}` | Plain text for `<title>` and `og:title` (must be HTML-escaped) |
| `{{DESCRIPTION}}` | Plain text for the meta description and `og:description` |
| `{{ASSET_PREFIX}}` | `""` (home, reference) or `"../"` (`docs/chapters/*.html`), prefixed to `assets/…` |
| `{{NAV}}` | The complete chapter list as `<ol class="toc-list">…</ol>` (the sidebar already provides the container) |
| `{{CONTENT}}` | The article body (`<article class="prose">…`) |
| `{{PREV}}` / `{{NEXT}}` | `<a class="pager-link pager-link--prev">…</a>` for the previous/next chapter; empty when there is none |
| `{{CHAPTER_TITLE}}` | Short chapter label shown in the header (for example `Chapter 3 · Parser`) |
| `{{PREV_URL}}` / `{{NEXT_URL}}` | **Two extra placeholders**: go into `<body data-prev-url="…" data-next-url="…">` for the `[` / `]` keyboard shortcuts; empty when there is none. Both must be usable links or empty strings. |

Resource order (fixed in the layout):

1. `{{ASSET_PREFIX}}assets/style.css`
2. `{{ASSET_PREFIX}}assets/toc.js` (generated by the build, `<script defer>`, may be missing)
3. `{{ASSET_PREFIX}}assets/site.js` (`<script defer>`)

`toc.js` must contain `window.SQL_TOC = [{ n, slug, title, summary, href }, …]`.

- `n`: chapter number (a number or `"01"` both work; the code normalizes it)
- `title` / `summary`: plain text, escaped by `site.js`
- `href`: path **relative to `docs/`** (for example `chapters/ch01.html`); when omitted it is derived as `chapters/chNN.html`. On chapter pages `site.js` prepends `../` so search results navigate correctly.
- Optional `minutes` / `time` / `eta`: estimated time on the home roadmap; defaults to about 30 minutes when absent.

### Chapter footer (important)

`_layout.html` ships a fallback `.chapter-foot.site-chapter-foot` containing:

    <button id="mark-complete" class="btn btn--complete" type="button" data-chapter="" aria-pressed="false">Mark chapter complete</button>
    <nav class="pager">{{PREV}}{{NEXT}}</nav>

- `site.js` fills `data-chapter` from the `chNN.html` URL, so the layout needs no chapter-number placeholder.
- If the generated `article.prose` already contains a `.chapter-foot` (with the real `#mark-complete[data-chapter]`), `site.js` removes the layout fallback to avoid duplicates. Both approaches are supported.
- On non-chapter pages (the reference page) CSS hides this footer: `body:not(.page--chapter) .site-chapter-foot { display:none }`.

### Generated labels

Pager labels, file-block metadata, and chapter titles come from `tools/build-docs.mjs`, not from this layout. Keep those generated strings in English when editing the build so the shell and the generated pages stay consistent.

---

## 6. Article HTML class contract

`{{CONTENT}}` should be:

    <aside class="chapter-meta">…</aside>
    <article class="prose">
      <header class="chapter-head">
        <p class="chapter-kicker">Chapter 03 / Parser</p>
        <h1>…</h1>
        <p class="chapter-lead">…</p>
      </header>
      …content…
    </article>

All classes below are fully styled in `style.css`; keep the nesting intact so the styles apply.

### 6.1 Chapter opening

- `.chapter-head` > `.chapter-kicker` + `h1` + `.chapter-lead`
- `.chapter-meta`: the `<aside>` above the article. The build emits `.chapter-meta__title` (small heading) plus `.chapter-meta__list` (a `ul` whose items use `<strong>` as the label); both have dedicated styles (2-column grid, monospace labels). Headings inside `chapter-meta` are excluded from the right-hand TOC by `site.js`.

### 6.2 Base elements

| Element | Styling notes |
| --- | --- |
| `h2` / `h3` (with `id`) | Serif headings; `h2` gets a hairline rule above and large top margin. **`id` is required for the on-page TOC and scroll-spy**; `site.js` generates one when missing. |
| `p` / `ul` / `ol` | Body copy 1.02rem, line-height 1.75; list markers in terracotta |
| `blockquote` | Left rule + muted text |
| `hr` | Hairline |
| `table` | **Must be wrapped in `.table-wrap`**: `<div class="table-wrap"><table>…</table></div>`; the wrapper scrolls horizontally and draws the border |
| `code` | Inline code (mono, hairline border, `--panel-2` background) |
| `kbd` | Keyboard key styling |

### 6.3 Callouts

    <div class="callout callout--tip">
      <p class="callout__title">Tip</p>
      <p>…</p>
    </div>

`.callout--tip` (olive/green), `.callout--warn` (terracotta), `.callout--note` (blue-gray). The `.callout__title` is intended as the first child; it is optional.

### 6.4 Code file blocks

    <div class="file">
      <div class="file__head">
        <span class="file__name">src/storage/page.js</span>
        <span class="file__meta">Node.js · 120 lines</span>
      </div>
      <pre class="code"><code>…</code></pre>
    </div>

- `.file` > `.file__head` (`.file__name` + `.file__meta`) + `pre.code > code`.
- The copy button is inserted by `site.js` into the right side of `.file__head` (`.file__meta` leaves room for it).
- Highlight spans: `.tk-kw`, `.tk-str`, `.tk-num`, `.tk-com`, `.tk-fn`, `.tk-type`, `.tk-op`, `.tk-ident`.

### 6.5 Diff blocks

    <div class="diff">
      <pre class="code code--diff"><code><span class="d-add">+ new line</span>
    <span class="d-del">- old line</span>
    <span class="d-ctx">  unchanged line</span></code></pre>
    </div>

Each `<span class="d-*">` is one line (`display:block`). The build keeps the `+` / `-` / space prefix at the start of the line.

The build also emits a label **before** `.diff`: `<p class="diff__label">src/engine/query.js: step 6 → step 7</p>`. It is styled as a quiet monospace caption (`.prose .diff__label`, with a `▸` prefix) and sits tight against the following `.diff`.

### 6.6 Checkpoint

    <div class="checkpoint">
      <p class="checkpoint__title">Checkpoint — persist a page</p>
      <pre class="code"><code>node tests/ch02.js</code></pre>
      <p class="checkpoint__expect">PASS page round-trip</p>
    </div>

`.checkpoint` > `.checkpoint__title` + `pre.code` + `.checkpoint__expect`. The "expected output" label is produced by CSS `::before`; put plain text inside (multi-line text may use newlines).

### 6.7 Exercise

    <div class="exercise">
      <p class="exercise__title">Exercise</p>
      <p>…</p>
    </div>

### 6.8 Vocabulary

    <dl class="vocab">
      <dt>Page</dt><dd>A fixed-size block of data, usually 4096 bytes.</dd>
      <dt>Heap file</dt><dd>…</dd>
    </dl>

### 6.9 Chapter footer

See section 5; `.chapter-foot` > `.chapter-foot__inner` (explanation + `#mark-complete`) + `.pager` (`.pager-link--prev` / `.pager-link--next`).
A `.pager-link` should contain `.pager-link__title` and optionally `.pager-link__meta`.

---

## 7. `site.js` behavior

Every feature degrades safely when its elements are missing, and all of them are guarded by existence checks or try/catch.

1. **Theme**: `#theme-toggle`, `localStorage["sql-theme"]`, default **light**.
2. **Reading progress**: `#reading-progress`, active only on `page--chapter` / `page--reference`.
3. **Chapter completion**: `#mark-complete[data-chapter]` writes `localStorage["sql-progress"]` (a JSON array of chapter-number strings such as `["1","3"]`); the button keeps `.is-done`, `aria-pressed`, and its label in sync; every `[data-progress-label]` shows "N/10 complete"; sidebar `a.toc-link` links gain `.is-done` and `.is-current` based on `chNN.html`; home `.roadmap__item[data-chapter]` mirrors `.is-done`.
4. **On-page contents**: `#page-toc` is built from `h2`/`h3` inside `article.prose` (excluding callouts, files, checkpoints, exercises, and chapter-meta), rendered as `.page-toc__list`, with IntersectionObserver scroll-spy (`.is-active`).
5. **Copy**: every `pre.code` gets a `.copy-btn`; file blocks place it inside `.file__head`; success shows "Copied".
6. **Search**: `#search-toggle` / `#search-overlay` / `#search-input` / `#search-results`; filters `window.SQL_TOC` (title + summary) live; falls back to the current page's `h2`/`h3` when `toc.js` is missing. Enter opens the match, Esc closes, `/` opens search, `↑`/`↓` select.
7. **Mobile sidebar**: `#sidebar-toggle` + `#sidebar-overlay` + `.is-open` + `aria-expanded`.
8. **Keyboard**: `[` / `]` read `body[data-prev-url]` / `[data-next-url]`; keystrokes inside inputs and textareas are ignored.
9. **Home dynamic content**: `#roadmap-list`, `#roadmap-skeleton`, and `#home-nav` are rendered from `SQL_TOC`; without `toc.js` the static placeholder list in `index.html` remains (and a `noscript` style block covers JavaScript-disabled readers).

`body` requires: `class="page page--{kind}"`, `data-page-kind`, `data-prev-url`, `data-next-url`.

---

## 8. Playground

`playground.html` loads `assets/sql-engine.js` (a classic script defining `window.SqlEngine`) and then `assets/playground.js`.

Engine API (may be absent before the build; `playground.js` guards everything with try/catch):

    window.SqlEngine.createDatabase() // → db
    db.exec(sql)      // → { type:"select", columns:[{name,type}], rows:[[v,…]], rowCount }
                      //   or { type:"command", message, changes, lastInsertRowid }
                      //   throws Error on failure (may carry err.position offset)
    db.execScript(sql) // → { results:[…] }
    db.tables()        // → [{ name, columns:[{name,type}] }]

- When `SqlEngine` is missing: show the `.pg-warn` hint ("run node tools/build-docs.mjs, then reload") without `console.error`.
- Editor: Tab inserts two spaces; Ctrl/Cmd+Enter runs.
- Results: each run appends `.pg-result` cards with `.pg-result__idx` (#1, #2, …) and the matching statement title (using `splitStatements()`, so the first statement is not repeated). SELECT renders a `.pg-table` (NULL as `.pg-null`); commands show affected rows; errors render `.pg-result--error` with position (line, column, offset).
- History: SQL from this browsing session, click to restore.
- Three built-in samples (independent and runnable): `books`, `GROUP BY`, `JOIN`. Samples give explicit primary keys because the current engine does not auto-generate rowids for `INTEGER PRIMARY KEY`.

---

## 9. Local server

    node tools/serve.mjs          # http://localhost:8080/docs/
    node tools/serve.mjs 3000
    node tools/serve.mjs --help

Root is `SQL/`, zero npm dependencies; correct MIME types, directory `index.html`, 404 page, path-traversal rejection, `no-store`.

---

## 10. Acceptance checklist (for redesigns)

- [ ] `_layout.html` contains every placeholder (including `{{PREV_URL}}` / `{{NEXT_URL}}`)
- [ ] All `href` / `src` values are relative; no `http(s)://` external resources
- [ ] No `fetch()`, no JSON files, no npm packages
- [ ] `node --check` passes for `site.js`, `playground.js`, and `serve.mjs`
- [ ] Light (default) and dark themes both checked across article, tables, code, callouts
- [ ] Default theme is light when `localStorage["sql-theme"]` is empty
- [ ] Sidebar drawer and header behave at 980px and 640px; no horizontal overflow at 500px
- [ ] Without `toc.js` the home page still shows a readable static roadmap
