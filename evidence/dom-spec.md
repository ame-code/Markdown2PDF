# Typora 1.9.5 print-export DOM specification

Goal: byte-level/attribute-level spec of the HTML that Typora 1.9.5 emits for
`exportToHTML({forPrint:true, exportTheme:"my"})`, so a standalone Node tool can reproduce it
before handing it to Chromium 124 `Page.printToPDF`.

## Sources and confidence legend

| Tag | Meaning |
|---|---|
| `[ART]` | Verified against the real export artifact `E:\work\reverse\reverse-typora-export\evidence\real-export-html-MATH.html` (17 420 chars, Windows, theme `my`, corpus `E:\work\reverse\reverse-typora-export\test\typora-export-test.md`). |
| `[CODE]` | Read from the shipped `D:\Typora\resources\appsrc\window\frame.js` (1 641 581 bytes), offset cited as `frame.js:NNNNNN`. |
| `[DERIVED]` | Emitted by `[CODE]` path but **not** present in the artifact (corpus lacks the construct). Templates are the literal code string concatenations, so they are reliable, but the surrounding whitespace/attribute order has not been byte-verified against a real capture. |
| `UNKNOWN` | Not determined; do not guess. |

Offsets are absolute character offsets into `frame.js`. Reading a region:
`$c=[System.IO.File]::ReadAllText('D:\Typora\resources\appsrc\window\frame.js'); $c.Substring(716516,900)`

Confidence is high on: shell, block containers, inline token mapping, escaping, separator,
print-mode anchors, tables, lists, footnote refs, image/link resolution.
Confidence is low on: exact `cid` numbering (§9), TOC inner markup (§3.11), `setBreakPage`
invocation at runtime (§3.14), and one artifact-vs-code conflict (§10.1).

---

## 1. Export pipeline

### 1.1 Call graph

```
exportToHTML(options)                         frame.js:708929
  ├─ title  = docMenu.getValueInMeta("title")
  │           || File.getFileName().replace(/\.(md|mmd|markdown|txt|text|mdwn)$/i,"")
  ├─ cfg    = {forPrint, noStyle, forImage, fontSize, anchorMap:{}}
  ├─ body   = exportCollection(nodeMap.blocks, footnoteList, cfg)     frame.js:716516
  │            ├─ per block: T(block) + S                            frame.js:707000
  │            ├─ inline: InlineLexer(..., decorateAsExport)         frame.js:700000
  │            └─ inline rendering: decorateAsExport(token, lexer)   frame.js:906932
  ├─ if (footnoteList.length) body += "<div class='footnotes-area' data-breakpage ><hr/>" + I(fn) + "</div>"
  ├─ links/css: T()  frame.js:713370   → head `<link>` block
  ├─ classes:   o = ["typora-export", "typora-print", ("os-windows"|"monocolor-emoji"), …]
  ├─ scripts:   l = setBreakPage script (print only) + table-zoom script
  └─ final template literal                                     frame.js:719600–720560
```

### 1.2 The block separator `S` — **this is why the body has no whitespace**

`frame.js:700000`:

```js
exportCollection(e, r, t) {
  var y = t || {}, v = y.forPrint, b = y.noStyle, t = y.exportFooter,
      o = y.exportInline, w = y.forImage, x = y.anchorMap || {}, n = y.anchorList || h.fetchAnchorList(x,b), …
  var S = (void 0 === y.split || null === y.split) ? (b ? "\n" : "") : y.split;
  …
}
```

* `S === ""` for **all normal exports, including print**. `S === "\n"` only when `noStyle` is true.
* Loop: `for (…; i += T(block) + S, …)` (`frame.js:707000`) → each block is `rendered + S`, so with
  `S === ""` **blocks are concatenated with zero whitespace**. `[ART]` confirms: `<h1>…</h1><h2>…</h2><p>…`
* `S` is also used inside list and table handlers as a decorative separator (see §3.4, §3.5) — it is
  therefore `""` there too in print mode.
* The only newline inside the artifact body is the softbreak of the two-line blockquote (§4.2).

### 1.3 `TOC` placeholder substitution

`frame.js:707000` tail: `i = i.replaceAll("\uE088", s)` — `A.toc` returns the single character
`\uE088`, replaced at the very end by the TOC html (`s()`, §3.11). With `S === ""` this is a plain
string replacement.

### 1.4 `cid` numbering — UNKNOWN

Heading anchors and internal links use `cid` (`n0`, `n2`, `n27` in `[ART]`) produced by
`l(){return "n"+s++}` (module `"13"`), i.e. a **global node-creation counter**, not a document-order
index. `[ART]`: h1 → `n0`, h2 → `n2` (one node created in between), math block → `n27`.
The exact sequence depends on editor/parser internals and is **UNKNOWN**.
Recommendation for the reimplementation: assign `n0, n1, n2, …` in document order and keep the
mapping consistent across `header-nX`, `af://nX`, `#header-nX`, `mathjax-nX`, `data-ref` — the values
only need to be *self-consistent*, because nothing outside the document references them.

---

## 2. Document shell

### 2.1 Template literal (verbatim, `frame.js:720520–720560`)

```js
`<!doctype html>
<html${v}>
<head>
<meta charset='UTF-8'><meta name='viewport' content='width=device-width initial-scale=1'>
${b[0]}
${m}<style type='text/css'>html {overflow-x: initial !important;}${r}
</style>${b[1]}
</head>
<body class='${o.join(" ")}'><div class='typora-export-content'>
${e}<div id='write' ${h?"style='top:auto'":""} class='${s}'>${t}</div></div>
${l}${w}</body>
</html>`
```

Substitutions:

| Var | Value in the PDF-print case |
|---|---|
| `v` | font-size override: `""`, or ` style='font-size:Npx !important'` when `options.fontSize` / `document.body.parentElement.style.fontSize` is set (`frame.js:716900`) |
| `b[0]` | `S(appendedHead)` → head inner HTML: starts with `"\n"` + the built-in `<link>`s (no separators) |
| `m` | theme `<link>`s: `my.css\n`, `base.user.css\n`, `my.user.css\n` (each ends with `\n`) |
| `r` | generated CSS (MathJax stylesheet, heading `::after` spacers, white-space rules, `@page` margins, `extraCss`) |
| `b[1]` | `""` if the appended head already contained a `<title>`, else `<title>${escape(title)}</title>` |
| `o` | class array → `typora-export typora-print os-windows` |
| `h` | `forPrint` → `true` ⇒ `style='top:auto'` is emitted |
| `s` | `File.isMac ? "is-mac" : "is-node"` ⇒ `is-node` on Windows (`frame.js:716900`) |
| `e` | sidebar html; `""` when `options.sidebar` is false |
| `t` | the exported body |
| `l` | scripts (`setBreakPage`) — print only |
| `w` | `appendBody` html (empty by default) |

### 2.2 Exact bytes of the observed shell `[ART]`

```
<!doctype html>\n<html>\n<head>\n<meta charset='UTF-8'><meta name='viewport' content='width=device-width initial-scale=1'>\n
\n
<link rel='stylesheet' href='file://D:\Typora\resources\/lib.asar/diagram/css/mermaid.css' type='text/css' /><link rel='stylesheet' href='file://D:\Typora\resources\/style/base.css' type='text/css' /><link rel='stylesheet' href='file://D:\Typora\resources\/style/codemirror.css' type='text/css' /><link rel='stylesheet' href='file://C:\\Users\\14578\\AppData\\Roaming\\Typora\themes\my.css' type='text/css' />\n
<link rel='stylesheet' href='…base.user.css' type='text/css' />\n
<link rel='stylesheet' href='…my.user.css' type='text/css' />\n
\n
<style type='text/css'>html {overflow-x: initial !important;}\n<MathJax svgStylesheet innerHTML>\n<mjx stroke-width override>\n</style><title>typora-export-test</title>\n
</head>\n
<body class='typora-export typora-print os-windows'><div class='typora-export-content'>\n
<div id='write' style='top:auto' class='is-node'><BODY></div></div>\n
<script> window.setBreakPage = …</script><script>(function(){…table zoom…})();</script></body>\n
</html>
```
(no trailing newline after `</html>`; file ends at byte 17420)

Notes:
* There is **no newline** between `codemirror.css` link and the `my.css` link (head links are concatenated), but there **is** one after each theme link.
* There are **two** `\n` between the last theme link and `<style type='text/css'>` (the theme-link builder's trailing `\n` plus one more).
* Link href backslashes in `[ART]` are literal and **mixed**: `…Typora\themes\my.css` while the user-data prefix is `C:\\Users\\14578\\AppData\\Roaming\\Typora` (hex-verified: `43 3a 5c 5c 55 73 65 72 73 … 5c 54 79 70 6f 72 61 5c 74 68 65 6d 65 73 5c 6d 79`). Cause: `C(e)="file://"+path.join(userDataPath,"themes",e)` where the configured `userDataPath` itself contained doubled backslashes. **For the reimplementation emit a clean `file:///` URL with forward slashes** — the href only has to load the CSS.
* Built-in CSS hrefs are `file://` + `File.resourcePath` + `"\/lib.asar/diagram/css/mermaid.css"`, `"\/style/base.css"`, `"\/style/codemirror.css"` → hence the quirky `resources\/` .

### 2.3 Body classes `[ART]`/`[CODE]` `frame.js:718600–719540`

```js
var o = ["typora-export"];
if (forImage) { o.push("for-image"); r += " ::-webkit-scrollbar {display: none;} "; }
else if (forPrint) { o.push("typora-print"); /* h1..h6 ::after spacer css */ }
if (File.option.indentFirstLine) s += " first-line-indent";
if (document.body.classList.contains("os-windows") && (o.push("os-windows"), File.option.monocolorEmoji))
    o.push("monocolor-emoji");
```

* Print on Windows ⇒ `<body class='typora-export typora-print os-windows'>` — exactly this order `[ART]`.
* `monocolor-emoji` is appended only when the OS class was pushed **and** `File.option.monocolorEmoji` is true.
* `#write` class is `is-node` (Windows) / `is-mac`; `first-line-indent` appended if configured.
* `#write` always has `style='top:auto'` in print mode (and no `style` attribute at all otherwise).

### 2.4 Generated CSS `r` (order matters)

1. Heading spacer loop (`frame.js:718600`): for each of `h1..h6`, if the live element has
   `border` starting `0px`, `outline` ending `0px`, `boxShadow === "none"`, `backgroundImage === "none"`,
   `backgroundColor === "rgba(0, 0, 0, 0)"` and a non-empty `::after` content, append
   `.typora-export hN::after {content: "";display: block;height: 100px;margin-bottom: -100px;}`
   (joined with `"\n"`; absent for theme `my` in `[ART]`).
2. If the live document contains `mjx-container`: `MathJax.svgStylesheet().innerHTML`; if not `forImage`,
   additionally
   ```
   mjx-container[jax="SVG"] path[data-c], mjx-container[jax="SVG"] use[data-c] {
   							stroke-width: 0;
   						}
   ```
   (tabs preserved) `[ART]` contains both.
3. Non-Mac: if `options["paper.margin"]` is truthy — `"custom"` ⇒
   `" @media print { @page {margin: $1mm 0 $3mm 0;} body.typora-export {padding-left: $2mm; padding-right: $4mm;} #write {max-width: initial;}}"` with `$1..$4` =
   `paper.marginTop/Left/Bottom/Right` (default `"16"`); otherwise push body class
   `"typora-export-margin-"+(options["paper.margin"]||"default")` (so body class becomes
   `typora-export typora-print typora-export-margin-default os-windows` when a non-custom margin is
   configured). `options["paper.margin"]` absent ⇒ **nothing** `[ART]` has no `@page` rule.
   Mac: `" @media print { @page {margin: 0 0 0 0;} body.typora-export {padding-left: 0; padding-right: 0;} #write {padding:0;}}"`.
4. `if (!File.option.preLinebreakOnExport) r += " .typora-export li, .typora-export p, .typora-export,  .footnote-line {white-space: normal;} h1,h2,h3,h4,h5 {white-space:pre-line}"`
   (note the **double space** before `.footnote-line`). Default `preLinebreakOnExport:!1`.
   → **CONFLICT: this rule is absent from `[ART]`** — see §10.1.
5. `options.extraCss` appended as `" " + extraCss`.

### 2.5 Scripts `[ART]`/`[CODE]` `frame.js:716660`

Print only (`h` truthy), inserted between `</div></div>` and `</body>` with no separator:

```html
<script> window.setBreakPage = function(b){var node = document.querySelectorAll('[data-breakpage]'); for(var i=0;i<node.length;i++){node[i].style.pageBreakBefore = b ? 'always':'auto' } return node[0] && node[0].style.pageBreakBefore};</script><script>(function(){for(var e=document.querySelectorAll("figure>table"),t=0;t<e.length;t++){var n=e[t],i=n.parentElement,r=i.scrollWidth,o=i.offsetWidth;o<r&&50<r&&(n.style.zoom=o/r,i.style.overflowX="visible")}})();</script>
```

* The zoom script runs immediately (IIFE) and shrinks over-wide tables by `zoom = offsetWidth/scrollWidth`.
  It is a **no-op in print** unless the measured box overflows; when reimplementing, keep it (harmless)
  or drop it — it cannot help `printToPDF` and it *can* change layout if a table overflows.
* `setBreakPage` is only *defined* here; whether the PDF flow calls it is `UNKNOWN` (§3.14).
* The Mac-only anchor script (`frame.js:717521`) is **not** emitted on Windows `[ART]`.

### 2.6 Title

`<title>${escape(title)}</title>` where `title = getValueInMeta("title") || File.getFileName()` with
markdown extensions stripped `[ART]`: `<title>typora-export-test</title>`, placed **after** `</style>`
and before `</head>`.

---

## 3. Block layer

Every block is `render(block) + S` with `S === ""`. Blocks therefore touch each other.

### 3.1 Paragraph `[ART]`, `frame.js:701930`

```html
<p><span>普通段落，包含 </span><strong><span>粗体</span></strong><span>、</span><em><span>斜体</span></em><span>、</span><code>inline code</code><span>、</span><a href='https://example.com'><span>链接</span></a><span>。</span></p>
```

* Structure: `<p>` + inline content + `</p>`.
* Empty result ⇒ `<p>&nbsp;</p>` (code: `"<p>"+(r||"&nbsp;")+"</p>"`).
* A paragraph whose inline content is exactly one floated/aligned `<img>` ⇒
  `<p><span class='md-image'>IMG</span></p>` (only when `!noStyle` and the img has `style.float` or an
  `align` attribute). `[ART]`'s image has neither ⇒ plain `<p><img …></p>`.
* Before rendering, a paragraph with no `\n` is re-parsed; if that parse yields a heading/def they are
  exported in place with `cid` copied over (`frame.js:701930`).

### 3.2 Headings `[ART]`, `frame.js:702820`

Print mode (`v === forPrint`):

```html
<h1><a name="header-n0" class="md-header-anchor md-print-anchor" href="af://n0"> </a><span>Heading 1</span></h1>
<h2><a name="header-n2" class="md-header-anchor md-print-anchor" href="af://n2"> </a><span>Heading 2</span></h2>
```

* Anchor element is built with `document.createElement("a")` then
  `setAttribute("name","header-"+cid)`, `setAttribute("class","md-header-anchor md-print-anchor")`,
  `setAttribute("href","af://"+cid)`, `innerText=" "`, and inserted via `r.outerHTML`.
  DOM serialization ⇒ **double quotes**, attribute order `name, class, href`, content a single space.
* **No `id` attribute is emitted in print mode.** The anchor's `name="header-nX"` is the fragment
  target used by internal links (`href="#header-nX"`) and by the TOC.
* Heading text is the normal inline pipeline (so `# **Bold**` ⇒
  `<h1><a …> </a><strong><span>Bold</span></strong></h1>`), i.e. inline `<span>` wrapping applies inside headings.
* `data-breakpage` (see §3.14) is added as `<h1 data-breakpage>` when
  `forPrint && depth===1 && !parent && previousSiblingExists`.
* HTML mode (`forPrint` false) instead emits `<hN id='header-<cid>'>` with **no** anchor element.

### 3.3 Blockquote `[ART]`, `frame.js:703180`

```html
<blockquote><p><span>blockquote 引用</span>
<span>第二行</span></p></blockquote>
```

* Nested blockquote ⇒ nested `<blockquote>` inside the outer one (`<blockquote><blockquote>…`), `[DERIVED]`.
* A blockquote whose `alert` attr is one of `note|warning|important|tip|caution` is exported as
  `<div class="md-alert md-alert-NOTE NOTE">…</div>` instead `[DERIVED]` (`frame.js:703180`).

### 3.4 Lists `[ART]`, `frame.js:703190`, `frame.js:703500`

```html
<ul><li><p><span>list</span></p></li><li><p><span>list</span></p></li><li><p><span>list</span></p></li></ul>
<ol start='' ><li><p><span>ordered</span></p></li><li><p><span>ordered</span></p></li></ol>
```

* Wrapper: `"<"+style+startAttr+">" + S + children + S + "</"+style+">"` → `S=""`, so
  `<ul><li>…` with no newlines.
* **`<ol start='' >` is real and must be reproduced** for a list written as `1.`/`2.` in a file:
  the empty `start` attr yields `n = void 0`, `Number.isNaN(void 0) === false`, `1 == void 0 === false`,
  so the code emits ` start='' ` — note the **space before `>`**: `<ol start='' >`.
  Only `start` numerically equal to `1` suppresses the attribute (e.g. stored `"1"` ⇒ `<ol>`), and a
  numeric start such as `3.` ⇒ `<ol start='3' >` `[DERIVED]`. Which of `""` vs `"1"` the file loader
  stores is `UNKNOWN`; a real file export produced `""`, so **match the artifact**.
* `<li>` in print mode **always keeps a `<p>`** even in a tight list
  (`frame.js:703500`: the unwrap only happens when `noStyle`), giving `<li><p><span>x</span></p></li>`.
  Loose items add nothing extra: the extra paragraph(s) simply appear as siblings.
* Nested list `[DERIVED]`: `<li><p><span>a</span></p><ul><li><p><span>b</span></p></li></ul></li>` — the
  child list is inside the parent `<li>`, after its paragraph(s).
* Task list `[DERIVED]` (`frame.js:703500`):
  `<li class='md-task-list-item task-list-item task-list-not-done' ><input type='checkbox' /><p>…</p></li>`
  and for a checked item `… task-list-done …<input type='checkbox' checked/>…`
  (note: no space before `/>` when checked, one space when not; also a trailing space after the class value).

### 3.5 Tables `[ART]`, `frame.js:707382`

```html
<figure class='table-figure'><table><thead><tr><th><span>A</span></th><th><span>B</span></th></tr></thead><tbody><tr><td><span>1</span></td><td><span>2</span></td></tr></tbody></table></figure>
```

* Wrapper is `figure.table-figure` (single quotes in source). **No `colgroup`.**
* First row (the row with no previous sibling) becomes `<thead>…</thead>`; all following rows go into a
  single `<tbody>…</tbody>`.
* Header row cells are `<th>`, body cells `<td>`.
* Alignment: source text is `" style='text-align:"+p+";' "` `[DERIVED]` (`frame.js:707382`), i.e. the
  attribute value is `text-align:left;` (semicolon inside the value, **no** trailing space) and the
  single trailing space sits **after the closing quote**, before `>`:
  `<th style='text-align:center;' ><span>A</span></th>`, `<td style='text-align:right;' >…</td>`.
  Only emitted for columns that have an alignment marker.
* Empty cell ⇒ `<td>&nbsp;</td>` (`frame.js:707382` tail: `E(cell)||"&nbsp;"`).
* Cell content is the regular inline pipeline ⇒ `<span>` wrapping.

### 3.6 Horizontal rule `[ART]`

```html
<hr />
```

`frame.js:707000`-area switch: `case A.hr: return "<hr />"`. Note the space before `/>`.

### 3.7 Code fence — wrapper only `[ART]`

```html
<pre class="md-fences md-end-block ty-contain-cm modeLoaded" spellcheck="false" lang="cpp">…cloned live CodeMirror DOM…</pre>
```

* In print mode Typora **clones the live editor DOM** of the fence (`frame.js:703560`):
  `removeAttr("cid").removeAttr("contenteditable").removeAttr("mdtype")`, then
  `.html(cloneOf(".CodeMirror")[0].outerHTML)`, then removes `.CodeMirror-cursors`,
  `.CodeMirror-hscrollbar`, `.CodeMirror-vscrollbar`, `.CodeMirror-selected`, clears
  `.CodeMirror-sizer{min-height}`, removes class `.CodeMirror-selectedtext`, and replaces
  `[cm-zwsp]` text with `"\n"`. If the fence has more than 13 lines it gets
  `style="page-break-inside: unset"`. Returns `outerHTML.trim()`.
* ⇒ The export contains **live editor markup**, not `<code>` text. A reimplementation must synthesise the
  equivalent structure (owned by the code-fence teammate); from my side only the outer element matters:
  `pre.md-fences.md-end-block`, `spellcheck="false"`, `lang="<lang>"`, `ty-contain-cm` class.
* `noStyle` mode is completely different: `<pre><code class='language-cpp' lang='cpp'>escaped</code></pre>`.

### 3.8 Math block — outer wrappers only `[ART]`

```html
<div contenteditable="false" spellcheck="false" class="mathjax-block md-end-block md-math-block md-rawblock" id="mathjax-n27" cid="n27" mdtype="math_block" data-math-tag-before="0" data-math-tag-after="0" data-math-labels="[]"><div class="md-math-container"><mjx-container class="MathJax" jax="SVG" display="true" style="position: relative;">…</mjx-container></div></div>
```

* Because `getSVGForExport` clones the whole live raw block element, **editor attributes survive here**
  (`cid`, `mdtype`, `id="mathjax-nX"`, `contenteditable="false"`, `spellcheck="false"`) — unlike headings/fences.
  The only mutation: the mjx content is wrapped in `<div class="md-math-container">`.
* Inline math `[ART]`: `…<span>行内公式 </span><mjx-container class="MathJax" jax="SVG" style="position: relative;">…svg…</mjx-container><script type="math/tex">E = mc^2</script><span>，…</span>` —
  i.e. the mjx container plus a sibling `<script type="math/tex">` carrying the TeX source.
* `noStyle` + `mathFormatOnCopy:"latex"` yields raw `$…$` / `$$…$$` instead.

### 3.9 Raw HTML block `[DERIVED]`, `frame.js:707020` → `frame.js:1216622`

* Returns the sanitized HTML **with no wrapper** (no `<div class='md-htmlblock'>`).
* Sanitizer config for blocks (`frame.js:1207411`):
  `{FORBID_ATTR:[], ADD_ATTR:["async","srcdoc","class","alt","for","title","charset"], FORBID_TAGS:[],
   ADD_TAGS:["iframe","dialog","footer","style","template","svg"], ALLOW_DATA_ATTR:!0,
   ALLOW_UNKNOWN_PROTOCOLS:!0, forHTMLBlock:!0, forPrint:!0}` merged over
  `{FORBID_ATTR:["class","contenteditable","cid","id","loop","autoplay","preload"], RETURN_DOM:!0,
   FORBID_TAGS:["head","style"], ADD_TAGS:["iframe","dialog","footer"], USE_PROFILES:{html:!0,svg:!0,svgFilters:!0,mathMl:!0}}`.
  ⇒ in blocks `class`, `id`, `style`, `svg`, `template` survive. When `window.reqnode` exists
  (Electron renderer) `iframe` is removed from `ADD_TAGS` and forbidden.
* Print-specific rewrites on `iframe, video, audio, img`: protocol-relative `//x` → `https://x`;
  `src` rewritten through `imgEdit.getAbsolutePath()` + `addDateQuery()` (`?lastModify=<ms>`), and
  non-iframe elements get `onError="this.style.display = 'none';"`. `<video>` may be replaced by an
  `<img>` screenshot in print mode. `epub` mode removes `controls`.
* Inline raw tags (`w.tag`, `html_inline`) go through the same function `[DERIVED]`; `<img src=…>` inline
  gets its `src` rewritten to an absolute `file://` URL in print mode.

### 3.10 Dropped blocks `[CODE]`

| Type | Output |
|---|---|
| `meta_block` (YAML front matter) | `""` — **completely removed** from the body |
| `def_link` (`[id]: url`) | `""` |
| `def_footnote` (`[^x]: text`) | `""` (consumed by the footnote machinery instead) |
| `toc` (`[TOC]`) | the placeholder char `\uE088`, replaced by §3.11 |
| unknown/other | `"<p>" + inline + "</p>"` |

### 3.11 TOC `frame.js:701540`

`noStyle` ⇒ `<div>[TOC]</div>`. Otherwise a clone of the live `.md-toc-content`:

* each `[data-ref] a` gets `href = "#header-"+dataRef` (Windows print) — on Mac `"at://"+dataRef`;
* `.md-meta` elements are removed;
* wrapper: `<div class='md-toc' mdtype='toc'>` + clone.outerHTML + `</div>`.

Item markup (from `getTocInnerHTML`, `frame.js:357023`) `[DERIVED, partial]`:

```html
<span class="md-toc-item md-toc-h1" role="listitem" data-ref="n0"><a class="md-toc-inner" href="#header-n0"><span>Heading 1</span></a></span>
```

Exact ordering/whitespace of the real clone is `UNKNOWN` (needs a live TOC capture).

### 3.12 Footnotes `[DERIVED]`, `frame.js:700500`, `frame.js:716600`, `frame.js:719857`

Reference (inline, 1-based numbering):

```html
<sup class='md-footnote'><a href='#dfref-footnote-1' name='ref-footnote-1'>1</a></sup>
```

Definition (one `div` per note, in the footnotes area appended after **all** blocks):

```html
<div class='footnotes-area' data-breakpage ><hr/><div class='footnote-line'><span class='md-fn-count'>1</span> <span>note text</span> <a name='dfref-footnote-1' href='#ref-footnote-1' title='back to document' class='reversefootnote' >↩</a></div></div>
```

* `data-breakpage` on the footnotes area is emitted in print mode (note the space before `>`).
* Multiple notes: `footnote-line` divs joined with `"\n"` (`I()` at `frame.js:719857`).
* The footnote text is the normal inline pipeline; `md-fn-count` carries the number.
* Unresolved ref (no definition) ⇒ `<span>[^x]</span>`.

### 3.13 `<div>` / custom containers

There is no container block type. A raw `<div>…</div>` block is just an `html_block` and is passed
through sanitized (§3.9); `class`/`id` survive. There is no Typora wrapper such as `md-htmlblock`.

### 3.14 Page breaks / `data-breakpage`

`[CODE]`: the attribute is emitted in exactly two places:

1. **Top-level H1 that is not the first block** — `frame.js:702820`:
   `forPrint && depth===1 && !node.get("parent") && node.get("before") && (n=" data-breakpage")`
   (`get("before")` = previous sibling, proven by the table handler using the same property for "is header row").
2. **Footnotes area** — `frame.js:716600`: `<div class='footnotes-area' data-breakpage >…`.

Consumption:
* `S.length && h` — `frame.js:713425/713472`: if `options.splitPages !== undefined`, an extra
  `<style type='text/css'>@media print {[data-breakpage]{page-break-before: always;}#write>[data-breakpage]:first-child {page-break-before: avoid}}</style>`
  (or `avoid` when `splitPages` is false) is inserted into `m` (i.e. in the head, before `<style ...>html {overflow-x…}`).
* `window.setBreakPage(true|false)` sets `pageBreakBefore` inline on every `[data-breakpage]` (`frame.js:716666`).
  Who calls it during PDF export: `UNKNOWN` (no caller inside `frame.js`). If Typora's PDF flow calls it
  with `true`, **every non-first top-level H1 starts a new page** — integration-critical, verify against a
  real multi-H1 PDF.
* There is **no `\pagebreak` markdown construct** in the export path: no such string exists in `frame.js`
  (regex search for `pagebreak` = 0 hits; only `breakpage`/`data-breakpage`).

---

## 4. Inline layer — `decorateAsExport` (`frame.js:906932`)

`decorateAsExport(token, lexer)`; `lexer` carries `{noStyle, forPrint, forImage, nodeMap, anchorList, footnoteList, appendFootnote}`.

### 4.1 Token → HTML

| Token | Emitted HTML (print mode) |
|---|---|
| `plain` | `<span>` + `escape(text)` + `</span>` |
| `escape` (backslash escapes) | `<span>` + `escape(text)` + `</span>` |
| `tab` | `<span>` + inner + `</span>` |
| `strong` | `<strong>` + inner + `</strong>` |
| `em` | `<em>` + inner + `</em>` |
| `del` | `<del>` + inner + `</del>` |
| `underline` | `<u>` + inner + `</u>` |
| `highlight` | `<mark>` + inner + `</mark>` |
| `superscript` | `<sup>` + inner + `</sup>` |
| `subscript` | `<sub>` + inner + `</sub>` |
| `softbreak` | `"\n"` (a literal newline, no tag) |
| `linebreak` (hard break) | `<br/>` (no space) |
| `br` / `imgtag` / `ruby` / `html_inline` | `buildHTMLForExport(...)` — raw passthrough (§3.9) |
| `code` | `<code>` + escaped text + `</code>` — **no inner `<span>`**, text is `.trim()`ed |
| `autolink` / `url` | `<a href='…' target='_blank' class='url'>` + text + `</a>` |
| `link` | `<a href='…'` (+ ` title='…'`) + `>` + inner + `</a>` |
| `reflink` | `<a href='…' target='_blank'` (+ title) `>` + inner + `</a>` |
| `image` | `<img src='…' referrerPolicy='no-referrer' />` built as a **real DOM node** then `outerHTML` ⇒ `<img src="file:///…?lastModify=123" referrerpolicy="no-referrer" alt="…">` |
| `refimg` | `<img alt='…' src='…' title='…' referrerPolicy='no-referrer'></img>` |
| `footnote` | §3.12 |
| `inline_math` | live `<mjx-container class="MathJax" jax="SVG">…</mjx-container>` + `<script type="math/tex">…</script>`; fallback `<span class='math-in-toc'>$tex$</span>` |
| `emoji` | raw emoji (`<span class='md-emoji'>…</span>` only if `monocolorEmoji`) |
| `alert_text` | `<span class='md-alert-text md-alert-text-NOTE'>` + label + `</span>` |
| `attr` | `""` |
| default | `inner || text || ""` |

### 4.2 The `<span>` rule (most important inline fact)

Every run of plain text is wrapped in `<span>`:

```html
<span>普通段落，包含 </span><strong><span>粗体</span></strong>…
```

* `[ART]` shows it everywhere: paragraph, heading, table cell, list item, blockquote, TOC.
* `noStyle` mode drops the wrapper (`escape(text)` only).
* Consequence: **do not "clean up" these spans** — theme CSS (`my.css`, `base.user.css`) targets
  `#write p span`-style selectors in many user themes; removing them changes rendering.

### 4.3 Link / image URL resolution (`s()` inside `decorateAsExport`)

```
if (forPrint) {
  if (href starts with "#") {
     hit = findAnchorElem(href, true)              // resolves via the anchor list
     return hit ? ("#header-" + hit.cid) : href    // Windows; Mac uses "at://"
  }
  if (!isFullUrl(href) && File.isNode) {
     abs = path.resolve(currentFileFolder + "/", href)
     return isFile(abs)       ? "file://" + abs
          : isFile(abs+".md") ? "file://" + abs + ".md"
          : isFile(abs+".markdown") ? …
          : isFile(abs+".pdf") ? …
          : "http://" + href
  }
} else if (href starts with "#") return normalizeAnchor(href, anchorList, !noStyle)
```

* ⇒ Internal links become `<a href='#header-nX'>…</a>` in print mode (they rely on the heading anchor's
  `name="header-nX"`, since print headings have no `id`).
* Relative links are absolutised to `file://` (or `http://` fallback).
* The `href` value is then passed through `x = escapeForPreWrap` = HTML-escape (`&`→`&amp;`, `'`→`&#39;`, …),
  so single-quoted attributes are safe and `&` in URLs is escaped.

### 4.4 Images `[ART]`

```html
<p><img src="file://E:/code/reverse-typora-export/test/typora-export-test-image.png?lastModify=1791301838282" referrerpolicy="no-referrer" alt="image"></p>
```

* Source is `addDateQuery(escapeURL(getRealSrc(href), true))`: backslashes → `/`,
  `^file:\/\/\/?` → `file:///`, then `?lastModify=<file mtime in ms>`.
* The element is produced by jQuery parsing then `outerHTML`, hence **double quotes, lowercased
  `referrerpolicy`, no self-closing slash**, attribute order `src, referrerpolicy, alt, title`.
* `alt` only when the markdown had alt text; `title` only when given.
* Inline (not alone in its paragraph), or when it has `align`/`float`, it is wrapped:
  `<span class='md-image'>…</span>`.
* Failed image loads (`failImgCache`) are emitted as `""` in print mode (`[CODE]`, unverified behaviour).

---

## 5. Escaping — exact semantics

`escape` / `escapeForPreWrap` are the same function (`frame.js:1517380` module, exported at `frame.js:1528049` and `frame.js:1528093`):

```js
o = function(e,t,n){
  if (null==e || ""==e) return "";
  if (typeof e=="string" || typeof e=="number")
     e = (e+"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
                .replace(/"/g,"&quot;").replace(/'/g,"&#39;"),
     t && (e = escapeMarkdown(e));      // t = "also markdown-escape" (copy-as-markdown only)
  return e;
};
```

* Five entities: `& < > " '` — **both double and single quotes are escaped in text content**.
* The third argument is ignored by this implementation.
* Attribute values use the same function (`x = escapeForPreWrap` in `decorateAsExport`).
* `escapeInQuote` (used for ` id='…'` on headings, `frame.js:1531121`) is a *JS-string* escaper
  (`"'\\` + control characters) and strips U+200B; for `header-nX` it is a no-op.
* `noStyle` mode escapes code with `escape(text.trim(), false, true)` (3rd arg ignored).

---

## 6. Print vs HTML mode — differences

| Construct | print (`forPrint:true`) | HTML export (`forPrint:false`) |
|---|---|---|
| `<body>` classes | `typora-export typora-print os-windows` | `typora-export os-windows` |
| `#write` | `<div id='write' style='top:auto' class='is-node'>` | `<div id='write' class='is-node'>` (no style) |
| Heading anchor | `<a name="header-nX" class="md-header-anchor md-print-anchor" href="af://nX"> </a>`, **no id** | `<hN id='header-nX'>`, no anchor |
| Internal link | `#header-nX` | `#header-nX` via `normalizeAnchor("#…")` |
| Scripts | `setBreakPage` + table-zoom | `setBreakPage`: absent; zoom script: absent |
| `data-breakpage` | on non-first top-level h1, footnotes area | never |
| Image `src` | absolute `file://` + `?lastModify=`; failed images dropped | as-written (escaped) |
| Link href | internal → `#header-nX`; relative → `file://` abs | `#…` normalized, relative untouched |
| Mac anchor script | `<a class="md-print-anchor" href="uaf://…">` + `href "#x"→"uat://x"` | absent |
| `md-print-anchor` class | present on heading anchors | absent |
| `head` CSS | includes `::after` spacers + MathJax (image mode differs) | no spacer loop |

`uaf://` / `uat://` only exist on macOS (`frame.js:717521`); on Windows the only special scheme is
`af://nX` in the heading anchors. `af://` is never resolved by the page — the fragment target is the
`name="header-nX"` attribute.

---

## 7. Which editor attributes survive in the body

| Construct | Surviving editor attrs | Removed |
|---|---|---|
| h1–h6 | none (no `cid`, no `id` in print; `data-breakpage` optional) | `cid`, `id` |
| p, li, blockquote, table | none | `cid`, `mdtype`, `md-end-block` |
| code fence `<pre>` | `class="md-fences md-end-block ty-contain-cm modeLoaded"`, `spellcheck="false"`, `lang` | `cid`, `contenteditable`, `mdtype` |
| math block | **`cid`, `mdtype="math_block"`, `id="mathjax-nX"`, `contenteditable="false"`, `spellcheck="false"`, `data-math-*`** | nothing (raw-block clone) |
| raw HTML block | sanitized form of the user's own attrs (`class`, `id` allowed) | `cid`, `mdtype` (never present) |
| images | `referrerpolicy="no-referrer"` | `cid` |
| footnotes | `data-breakpage` on the area div | — |

---

## 8. Whitespace / newline summary

* `S === ""` in print ⇒ **no whitespace between any blocks**: `</h1><h2>`, `</ul><ol`, `</figure><pre`, `</pre><p>`.
* Newlines appear only from: the template (§2.1 — 10 of them, positions enumerated in §2.2), theme
  `<link>` lines, softbreaks inside paragraphs (`"\n"`, §4.1), multiple footnote lines (`"\n"`),
  and multi-line generated CSS (MathJax stylesheet, `stroke-width` block with tabs).
* Inside a `<p>`, consecutive lines are separated by a literal `\n` (softbreak) → visible in the
  blockquote fixture. That newline is significant when `h1..h5 {white-space:pre-line}` /
  `preLinebreakOnExport:true` is in effect.
* No `\n` between `<li>` items, between `<tr>`/`<td>`, or around `<figure>`.

---

## 9. Open / UNKNOWN

1. **`cid` numbering** (`n0`, `n2`, `n27`) — global node counter; exact sequence `UNKNOWN` (§1.4). Use a
   self-consistent document-order counter.
2. **TOC inner markup** — clone of a live DOM node; exact attribute order/whitespace `UNKNOWN` (§3.11).
3. **`setBreakPage` invocation during PDF export** — `UNKNOWN`; decides whether a non-first H1 forces a
   page break (§3.14).
4. **`<ol start>`** — `""` vs `"1"` in the model; the real file export emitted ` start='' `; the `1.`
   incremental-editor path would emit `<ol>`. Match the artifact (§3.4).
5. **Definition lists** — no `def_list` block type exists in module `"13"`; `dl/dt/dd` only via raw HTML.
   Likely unsupported by Typora markdown → treat as `UNKNOWN/unsupported`.
6. **`window.reqnode` presence** changes the raw-HTML sanitizer (iframe forbidden). On the Typora renderer
   it is present; in a standalone Node tool it will not be — mimic the renderer (forbid `iframe` in blocks).
7. **`failImgCache` emission** (`""`) — code path read but untested.

---

## 10. Conflicts and risks

### 10.1 `[ART]` is missing a CSS rule the code always emits

`frame.js:719774` adds, unless `File.option.preLinebreakOnExport` is true (default `false`):

```
 .typora-export li, .typora-export p, .typora-export,  .footnote-line {white-space: normal;} h1,h2,h3,h4,h5 {white-space:pre-line}
```

`[ART]`'s `<style>` contains only `html {overflow-x: initial !important;}` + MathJax stylesheet +
`stroke-width` override — no such rule, and no `@page`/`::-webkit-scrollbar` (both correctly conditional).
Two explanations: (a) that machine had `"preLinebreakOnExport": true` in `conf.user.json`;
(b) the artifact's `<head>` was partly reconstructed by an earlier analysis and lost the tail of `r`.
Everything else in `[ART]` matches the code exactly, so the body is trustworthy; treat the head CSS as
suspect and **decide explicitly**: for layout parity with `preLinebreakOnExport:false` (the default),
emit the rule.

### 10.2 Body has no `<title>`-adjacent whitespace variance

The template is a raw template literal; reproducing it requires the same literal newlines (§2.2).
A pretty-printed shell will change CSS cascade only through whitespace inside `#write`, which is empty —
so cosmetic whitespace in the shell is safe, but **whitespace inside `#write` is not**.

### 10.3 Attribute quoting

Two systems coexist and both must be reproduced exactly because tests compare bytes:

* **String templates** (most block markup) use **single quotes**: `<figure class='table-figure'>`,
  `<p>`, `<a href='…'>`, `<hr />`, `<ol start='' >`, ` data-breakpage`.
* **DOM serialization** (`outerHTML`) uses **double quotes** and lowercased attribute names: heading
  anchors (`name="header-n0"`), images (`src="…" referrerpolicy="no-referrer"`).

---

## 11. Reimplementation checklist

1. Emit the shell byte-for-byte per §2.1/§2.2 (body class order, `style='top:auto'`, `is-node`,
   `typora-export-content`, scripts, `</html>` with no trailing newline).
2. Render blocks with **no separator** between them.
3. Wrap every plain-text run in `<span>`, escape `& < > " '`.
4. Print-mode heading = anchor with `name`/`class`/`href="af://cid"` and **no id**; keep heading inline markup.
5. Lists: `<li><p>…</p></li>` always; `<ol start='' >` for `1.` lists; task items keep the
   `md-task-list-item task-list-item task-list-*` class + `<input type='checkbox'>`.
6. Tables: `figure.table-figure` > `table` > `thead`(one row) + `tbody`(rest); `&nbsp;` for empty cells;
   `style='text-align:X;' ` (space after the quote) when aligned.
7. Add `data-breakpage` to non-first top-level h1s (and the footnotes area), plus decide on
   `setBreakPage` / `splitPages` (§3.14, §10.1).
8. Keep image `?lastModify=` URLs and `referrerpolicy="no-referrer"`.
9. Do not emit `cid`/`mdtype`/`md-end-block` except where a raw clone keeps them (math block, fences).
10. Never emit a `<title>` in the body, a `meta_block`, a `def_link`, or a `def_footnote`.
