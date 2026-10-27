# Typora 1.9.5 fenced-code-block DOM — spec & verification

Status: **complete**. `src/fence/index.js` reproduces the reference fence from the
real Typora print export **byte for byte**:

| | bytes | sha256 |
|---|---|---|
| reference `<pre>` (from `real-export-html-MATH.html`) | 2069 | `e0bbc1ada53fc06b9e421f62cece6c5cc2be7b9d698807b7561e50d2a134a8da` |
| `renderFence(code,'cpp')` | 2069 | `e0bbc1ada53fc06b9e421f62cece6c5cc2be7b9d698807b7561e50d2a134a8da` |

Reference fence source text (the corpus block):

```cpp
#include <bits/stdc++.h>
int main() { return 0; }
```

Reference fence markup (the target, 2069 B, one line):

<!-- prettier-ignore -->
<pre class="md-fences md-end-block ty-contain-cm modeLoaded" spellcheck="false" lang="cpp"><div class="CodeMirror cm-s-inner cm-s-null-scroll CodeMirror-wrap" lang="cpp"><div style="overflow: hidden; position: relative; width: 3px; height: 0px; top: 9.51875px; left: 8px;"><textarea autocorrect="off" autocapitalize="off" spellcheck="false" tabindex="0" style="position: absolute; bottom: -1em; padding: 0px; width: 1000px; height: 1em; outline: none;"></textarea></div><div class="CodeMirror-scrollbar-filler" cm-not-content="true"></div><div class="CodeMirror-gutter-filler" cm-not-content="true"></div><div class="CodeMirror-scroll" tabindex="-1"><div class="CodeMirror-sizer" style="margin-left: 0px; margin-bottom: 0px; border-right-width: 0px; padding-right: 0px; padding-bottom: 0px;"><div style="position: relative; top: 0px;"><div class="CodeMirror-lines" role="presentation"><div role="presentation" style="position: relative; outline: none;"><div class="CodeMirror-measure"></div><div class="CodeMirror-measure"></div><div style="position: relative; z-index: 1;"></div><div class="CodeMirror-code" role="presentation"><div class="CodeMirror-activeline" style="position: relative;"><div class="CodeMirror-activeline-background CodeMirror-linebackground"></div><div class="CodeMirror-gutter-background CodeMirror-activeline-gutter" style="left: 0px; width: 0px;"></div><pre class=" CodeMirror-line " role="presentation"><span role="presentation" style="padding-right: 0.1px;"><span class="cm-meta">#include &lt;bits/stdc++.h&gt;</span></span></pre></div><pre class=" CodeMirror-line " role="presentation"><span role="presentation" style="padding-right: 0.1px;"><span class="cm-variable-3">int</span> <span class="cm-def">main</span>() { <span class="cm-keyword">return</span> <span class="cm-number">0</span>; }</span></pre></div></div></div></div></div><div style="position: absolute; height: 0px; width: 1px; border-bottom: 0px solid transparent; top: 46px;"></div><div class="CodeMirror-gutters" style="display: none; height: 46px;"></div></div></div></pre>

## 1. Approach

Typora does not highlight fences with a third-party highlighter: every fence is a
**real CodeMirror 5.26.0 instance** in read-only form, built by the app and then
surgically flattened for export. Re-tokenising with another highlighter cannot
match it (token classes, per-character spans, active-line wrapper, inline
pixel styles all differ), so this module **runs Typora's own vendored
CodeMirror + mode bundle** in headless Chromium and applies Typora's own export
surgery.

CodeMirror 5 core is not a separate file on disk — it lives inside the SystemJS
bundle `D:\Typora\resources\appsrc\window\frame.js`
(1 641 581 B, sha256 `1b698f43…8f0ee4ba`) as module `"20"` at byte offset
1 010 235; the language modes come from `D:\Typora\resources\lib.asar`
`/codemirror/mode.min.js` (566 433 B). Both are extracted verbatim by
`src/fence/scratch/extract-assets.cjs` into `src/fence/assets/` (see §6).

## 2. API (ESM — the package is `"type":"module"`)

```js
import {
  FENCE_ASSETS,    // string[] - every css+js file the page needs
  FENCE_STYLES,    // string[] - the css files, in cascade order
  FENCE_SCRIPTS,   // string[] - scripts to inject BEFORE FENCE_INPAGE
  FENCE_INPAGE,    // string   - browser JS defining md2pdfRenderFences(items, options)
  mountFenceAssets,// ({includeThemeMetrics?,includeBaseControl?}) -> {styles,css,inline,links}
  renderFence,     // (code, lang, options?) -> Promise<string>
  renderFences,    // ([{code,lang,lineNumbers?,firstLineNumber?}], options?) -> Promise<string[]>
} from './src/fence/index.js';
```

* `renderFences` launches **one** Chromium for the whole batch and always closes
  it (`try/finally`); a failed launch/close cannot leak a process.
* Both return the `<pre …>…</pre>` outerHTML, trimmed, exactly as Typora's
  export returns `l[0].outerHTML.trim()`.
* Options (all optional): `displayScale` (default **1.25**, see §5.1),
  `width`/`height` (viewport, default 1000×1400), `deviceScaleFactor`,
  `chromium` (explicit executable), plus Typora's own file options
  `codeIndentSize` (4), `noLineWrapping` (false), `noPairingMatch` (false),
  `showLineNumbersForFence` (false), `lineWiseCopyCut` (false).
* Chromium resolution order: `FENCE_CHROMIUM` env → Playwright
  `chromium-1112\chrome-win\chrome.exe` → Chrome → Edge.

### 2.1 Pipeline integration (2-load flow)

1. Stage 1 HTML = Typora's print shell
   (`<body class="typora-export typora-print os-windows">`, `<div id="write" style="top:auto" class="is-node">`)
   with a placeholder per fence:
   `<pre class="md-fences md-end-block ty-contain-cm" spellcheck="false" lang="cpp" data-mdpdf-fence="0"></pre>`.
2. In `<head>`, inline `mountFenceAssets().css` as one `<style>` (20 540 B) or
   link `FENCE_STYLES`. Then, before `FENCE_INPAGE`, run `FENCE_SCRIPTS` in the
   given order, then `FENCE_INPAGE`.
3. `await window.md2pdfRenderFences([{index:0, code, lang}, …], options)` → fills
   each placeholder in place (adds `modeLoaded`, drops `data-mdpdf-fence`) and
   returns `[{index, html}]`.
4. Serialise `#write.innerHTML` and print.

No CSS beyond Typora's own `base.css` + `codemirror.css` is needed for layout:
`mountFenceAssets()` adds only (a) the **user theme's** `html{font-size}` /
`body{line-height}` rules — without them geometry differs, but a host that
already inlines the real theme file can pass `{includeThemeMetrics:false}`, and
(b) one `base-control.css` rule
`.cm-s-inner .CodeMirror-vscrollbar{display:none!important}` (no geometric
effect). Everything can be inlined; there is no `url()`/`@import`.

## 3. How Typora builds the fence (frame.js, verbatim)

### 3.1 The mock `<pre>` (frame.js @107655)

```js
f.renderFences=function(e){var t=document.createElement("PRE"),
  n=(t.classList.add("md-fences"),t.classList.add("mock-cm"),t.classList.add("md-end-block"),
     File.option.showLineNumbersForFence&&t.classList.add("md-fences-with-lineno"),e.get("lang")),i=e.get("text");
  return t.setAttribute("spellcheck","false"),t.setAttribute("contenteditable","false"),
    t.setAttribute("lang",n||""),t.setAttribute("cid",e.cid),t.setAttribute("mdtype",e.get("type")),
    t.innerText=i,t.innerText||(t.innerHTML="<br/>"),f.renderFencesByUpdate(e,t,n),t.outerHTML}
```

`lang` is set **unconditionally** — a language-less fence keeps an empty
`lang=""` attribute. The editor then removes `mock-cm`, adds `ty-contain-cm`,
clears the element and mounts CodeMirror into it.

### 3.2 CodeMirror construction (frame.js @99356)

```js
var p=S("[cid = "+r.id+"]").removeClass("mock-cm");
p.addClass("ty-contain-cm").html("");
{ lineWrapping:!File.option.noLineWrapping, mode:getCodeMirrorMode(r.get("lang")),
  styleSelectedText:!0, maxHighlightLength:1/0, viewportMargin:1/0, styleActiveLine:!0,
  autoCloseBrackets:!File.option.noPairingMatch, autoCloseTags:!File.option.noPairingMatch,
  theme:" inner null-scroll", lineNumbers:File.option.showLineNumbersForFence,
  resetSelectionOnContextMenu:!0, cursorScrollMargin:60, dragDrop:!1,
  indentUnit:File.option.codeIndentSize, tabSize:File.option.codeIndentSize,
  lineWiseCopyCut:File.option.lineWiseCopyCut, scrollbarStyle:"null",
  value:r.safeGetStrAttr("text") }            // then Object.assign(…, M(lang))
p.children(".CodeMirror").attr("lang",(r.get("lang")||"").toLowerCase());
this.modeLoaded&&p.addClass("modeLoaded");
!File.option.showLineNumbersForFence&&m.lineNumbers&&p.addClass("md-fences-with-lineno");
```

Why each option shows up in the output:

| option | effect in the exported DOM |
|---|---|
| `theme:" inner null-scroll"` | wrapper classes `cm-s-inner cm-s-null-scroll` (`regex replace(/(^|\s)\s*/g," cm-s-")` in core) |
| `lineWrapping:true` | `CodeMirror-wrap` class; `.CodeMirror-wrap pre{white-space:pre-wrap}` |
| `styleActiveLine:true` | line 0 wrapped in `.CodeMirror-activeline` + background + gutter divs (module "38", addon) |
| `viewportMargin:Infinity` | no viewport clipping ⇒ all lines rendered |
| `maxHighlightLength:Infinity` | long lines are still tokenised |
| `scrollbarStyle:"null"` | no h/v scrollbar elements at all |
| `lineNumbers:false` | `.CodeMirror-gutters{display:none; height:46px}` |

`getCodeMirrorMode()` (frame.js @89996) lower-cases the info string, strips a
leading `lang-`/`language-` prefix and braces, takes the first `[ ,\s]+` token,
then maps it through Typora's alias table `u()` (frame.js @82873..89720,
extracted as `assets/cm/tw-lang-mode.js`). Typora's `M(lang)` (@100327) parses
`{.numberLines}` / `{startFrom='5'}` and is merged over the options.

`modeLoaded` is a **manager-wide** flag, not per-language: `lazyload()`
(frame.js @104014) loads `./lib.asar/codemirror/mode.min.js` and only then sets
`e.modeLoaded=!0`. Since we always load that bundle, every fence gets
`modeLoaded`, including unknown languages.

### 3.3 Export surgery (frame.js @704163-706700)

```js
l.children(".CodeMirror").length && (
  l.removeAttr("cid").removeAttr("contenteditable").removeAttr("mdtype")
   .html(l.children(".CodeMirror")[0].outerHTML)
   .find(".CodeMirror-cursors, .CodeMirror-hscrollbar, .CodeMirror-vscrollbar, .CodeMirror-selected").remove().end()
   .find(".CodeMirror-sizer").css("min-height","").end()
   .find(".CodeMirror-selectedtext").removeClass("CodeMirror-selectedtext").end()
   .find("[cm-zwsp]").text("\n") ),
y.fenceLineFontSize && … .find(".CodeMirror-gutters").css("height","100%"),
v && File.option.noLineWrapping && l.children(".CodeMirror").addClass("CodeMirror-wrap")
   .find(".CodeMirror-sizer").css("min-width",""),
a && l.css("page-break-inside","unset"),
v && File.isNode && /* ";" / "-" rewrite, see §4.4 */
l[0].outerHTML.trim();
```

Replayed step for step in `FENCE_INPAGE` (same order, same selectors), plus two
additions documented in §5.2/§5.3. `a` is `13 < code.split("\n").length`, and
`v` is `forPrint` (the `typora-print` body class).

## 4. Answers to the Lead's four questions

### 4.1 Fence with **no** language

```
<pre class="md-fences md-end-block ty-contain-cm modeLoaded" spellcheck="false" lang="">
  <div class="CodeMirror cm-s-inner cm-s-null-scroll CodeMirror-wrap" lang="">
```

* `lang=""` **is present, empty** — `renderFences` always calls
  `setAttribute("lang", lang||"")`. The inner wrapper gets
  `.attr("lang", (lang||"").toLowerCase())`, so also `lang=""`.
* Mode is `""`: `getCodeMirrorMode("")` returns `""` (alias miss, `e===r`), so
  no `cm-*` spans are emitted at all — the text is a single text node inside
  `<span role="presentation" style="padding-right: 0.1px;">`.
* `cm-s-inner`/`cm-s-null-scroll`/`CodeMirror-wrap`/`modeLoaded` are unchanged;
  the block is still a CodeMirror instance (that is what `ty-contain-cm` means
  for every fence).

### 4.2 Unknown language (e.g. `notalanguage`)

* `modeLoaded` **is** present (see §3.2 — it gates on the mode bundle being
  loaded, not on a mode existing for this language).
* `lang="notalanguage"` on the pre (raw), `lang="notalanguage"` on the wrapper
  (lower-cased copy).
* No `cm-*` token spans: `getCodeMirrorMode` returns `""` for anything `u()`
  does not know, and CodeMirror installs no mode, so the line content is plain
  text. `cm-tab` can still appear for literal tab characters (that is a
  core-rendered span, not a mode token).
* Nothing else differs from a known language.

### 4.3 `data-breakpage`, `md-end-block`, `ty-contain-cm`, `md-fences-with-lineno`

| name | rule |
|---|---|
| `md-fences` | always (building block of the mock pre) |
| `md-end-block` | **always** — set in `renderFences` for every fence (also used by `<p>`, headings, `<hr>`, meta blocks) |
| `ty-contain-cm` | **always** — added by the fence editor before mounting CodeMirror; every Typora fence is a CM instance |
| `modeLoaded` | always once `lib.asar/codemirror/mode.min.js` is loaded (i.e. always in a normal app run) |
| `md-fences-with-lineno` | iff the **final** `lineNumbers` option is true: `File.option.showLineNumbersForFence` (class added at build) **or** `!showLineNumbersForFence && M(lang).lineNumbers` (class added after init, e.g. ```` ```js {.numberLines} ````) |
| `data-breakpage` | **never on a fence.** Only `h1` (depth 1, no parent, with a "break-before" meta) at @702759 and the footnotes container (@716600). CSS: `@media print {[data-breakpage]{page-break-before:always\|avoid}}` per `File.option.splitPages`. Fences instead get an **inline** `page-break-inside: unset` when the block has **more than 13** lines (`13 < text.split(/\n/).length`), which Chromium serialises as `break-inside: unset`. |

### 4.4 The Windows `;` / `-` re-wrapping — do not reproduce it

The branch (`v && File.isNode`, i.e. print/PDF export on Windows) walks every
`.CodeMirror-line > span` and, for each **Text** node, does:

```js
i = e.textContent.split(/(;|-)/).map(function(e){
      return ";"==e||"-"==e ? "<span style='font-family:"+n+"'>"+e+"</span>" : M.escape(e) }).join("");
i != e.textContent && (e.innerHTML = i);
```

It splits on **every** `;` and `-` in **every** line, and it writes that markup
via **`.innerHTML` on a Text node**. Text nodes have no `innerHTML`; in
Chromium 124 the assignment is a silent expando (verified: `ownProp:true`,
`textContent` unchanged, no exception), so the DOM is never modified. That is
why the reference — exported with `typora-print` set, i.e. `forPrint === true` —
still contains a bare `;` in `int main() { return 0; }`. **Not required for
visual parity and deliberately not implemented.**

## 5. Residual differences, and the two normalisations we do apply

### 5.1 Sub-pixel geometry needs the export machine's display scale

`top: 9.51875px` on the hidden textarea wrapper is
`(cursorBox.top + cursorBox.bottom)/2 - 2`, i.e. it encodes the measured line
box: `9.51875 ⇒ 23.0375px` for a 2-line block, while CSS says
`14.4px × 1.6 = 23.04px`. Chromium rounds line boxes onto its layout grid, and
the grid depends on the *display scale factor*:

| `--force-device-scale-factor` | measured line box | emitted `top` |
|---|---|---|
| 1.0 | 23.046875 (= ceil(23.04) on the 1/64 grid) | `9.52344px` |
| **1.25** | **23.0375** | **`9.51875px`** ← reference |
| 1.5 | 23.03125 | `9.51562px` |

The reference Typora export therefore ran on a Windows **125 %** display. The
module defaults to `displayScale: 1.25` (→ `--force-device-scale-factor=1.25`),
override it if the target machine differs. `heightForcer top:46px` and
`gutters height:46px` are integers and do not depend on this.

### 5.2 Normalisation: textarea attribute order

Chromium does not keep a stable serialisation position for the `style`
attribute (it lives outside the attribute vector; `el.style.cssText=…` emits it
last, `setAttribute('style',…)` keeps its slot), so the same DOM serialised as
`… style="…" tabindex="0"` here and as `… tabindex="0" style="…"` in the
reference. `FENCE_INPAGE` re-creates the five attributes on the `textarea` in
Typora's order (`autocorrect, autocapitalize, spellcheck, tabindex, style`) with
identical values. Zero rendering effect; it is what makes the byte comparison
come out clean.

### 5.3 Normalisation: empty CodeMirror measurement probes

When a fence is serialised in the same task that created it, CodeMirror can
still have a measurement in flight and leave `<span><span>\u200b</span>x</span>`
inside `.CodeMirror-measure`. In Typora the editor has long since finished
measuring, and the reference carries two **empty**
`<div class="CodeMirror-measure"></div>`. We empty them; `.CodeMirror-measure`
is `position:absolute;height:0;visibility:hidden`, so nothing moves, and it
also removes the last zero-width space from the output.

### 5.4 Not implemented / out of scope (with reasons)

| item | why it does not matter here |
|---|---|
| `.CodeMirror-linenumber` font-size rewrite + `gutters{height:100%}` font-size path | only runs when the export is given an explicit `fontSize` override (`y.fenceLineFontSize`, @705432). We do apply `gutters{height:100%}` whenever line numbers are on, which is the geometric half of the same branch. |
| `.md-fences-adv-panel` clone | only exists for fences with an attached panel (e.g. mermaid controls); its clone is appended *after* the CodeMirror child and dropped by `.html(l.children(".CodeMirror")[0].outerHTML)` anyway |
| `contenteditable`, `cid`, `mdtype` | set by the builder, removed by the export — never emitted |
| `;`/`-` rewrite | inert, §4.4 |
| `styleSelectedText` selection spans | no selection exists in a freshly created instance; the addon is not even loaded in Typora's bundle |
| fonts | glyph metrics come from the host CSS (`--monospace: "Lucida Console", Consolas, "Courier", monospace`). Line boxes are line-height driven, so the reference numbers reproduce on any machine that has the CSS; per-glyph advances can differ if a font is missing. |

## 6. Assets, provenance, licences

Everything needed is vendored under `src/fence/assets/` — **the module has no
runtime dependency on the Typora installation**. Sizes and sha256 are recorded in
`assets/manifest.json`, which also pins the source bundle:
`frame.js` 1 641 581 B sha256 `1b698f43e78a29d7c4fb29de724befb984f26fe14a883ab0e283ad7c8f0ee4ba`.

| asset | bytes | origin | licence |
|---|---|---|---|
| `cm/codemirror5.js` | 162 545 | CodeMirror **5.26.0** core, `frame.js` module `"20"` (@1010235, body 1010296–1171922), wrapped in a shim that assigns `global.CodeMirror` | MIT (CodeMirror 5) |
| `cm/mode.min.js` | 566 433 | `lib.asar` `/codemirror/mode.min.js`, byte-identical | MIT (CodeMirror 5 modes) |
| `cm/active-line.js` | 1 929 | `frame.js` module `"38"` (styleActiveLine addon) | MIT |
| `cm/tw-lang-mode.js` | 7 518 | `frame.js` language alias table `u()` (@82873–89720), exposed as `window.__typoraModeAlias` | derived from CodeMirror mode/MIME data, MIT |
| `cm/typora-globals.js` | 1 377 | **hand-written** stand-in for the `File` global that Typora's *patched* CM reads (10 references; without it `init` throws `Cannot read properties of undefined (reading 'passiveEvents')`) | our code |
| `style/typora-base.css` | 13 386 | `D:\Typora\resources\style\base.css`, verbatim | Typora app CSS (proprietary, typora.io) — analysis excerpt |
| `style/typora-codemirror.css` | 4 607 | `D:\Typora\resources\style\codemirror.css`, verbatim | Typora/CodeMirror theme |
| `style/typora-base-control-subset.css` | 133 | one rule from `style/base-control.css` | as above |
| `style/user-theme-metrics.css` | 2 297 | metric rules of the export's user theme `%APPDATA%\Typora\themes\my.css` (not Typora-shipped) | user's theme |

Regenerate all of it with `node src/fence/scratch/extract-assets.cjs`
(re-reads `frame.js` / `lib.asar`; asar header = LE uint32 size @12, JSON @16,
data base = 8 + uint32 @4). MathJax (`lib.asar/MathJax3`, Apache-2.0) is not
needed by this module.

## 7. Verification (`node src/fence/verify.js`)

One browser launch, 14 cases, all assertions pass; `ref-cpp` is byte-identical.

| case | bytes | lines | token classes emitted | notes |
|---|---|---|---|---|
| `ref-cpp` | 2069 | 2 | `cm-meta cm-variable-3 cm-def cm-keyword cm-number` | **byte-identical to the real export** |
| `js` | 2476 | 2 | `cm-keyword cm-variable cm-def cm-operator cm-comment cm-string-2 cm-property cm-variable-2 cm-number` | |
| `python` | 2714 | 5 | `cm-keyword cm-def cm-variable cm-comment cm-string cm-builtin` | blank line keeps a `cm-zwsp` span whose text became `\n` |
| `html` | 2575 | 3 | `cm-tag cm-attribute cm-string cm-atom cm-bracket` | entities stay escaped (`&amp;`) |
| `bash` | 2503 | 4 | `cm-meta cm-keyword cm-builtin cm-string cm-def cm-attribute` | |
| `unknown-lang` | 1995 | 2 | `cm-tab` only | plain text, `modeLoaded` still present |
| `no-lang` | 1876 | 2 | – | `lang=""` on pre and wrapper |
| `trailing-blank-lines` | 2350 | 5 | – | blank lines survive as `CodeMirror-line` + `cm-zwsp` |
| `non-ascii` | 2134 | 2 | `cm-string cm-variable cm-builtin cm-operator` | `中文测试 — emoji 🎉 ünïcødé` preserved as UTF-8 |
| `tabs` | 2767 | 5 | `cm-tab cm-keyword …` | tab rendered as `<span class="cm-tab">` |
| `long-block-14-lines` | 5264 | 14 | `cm-keyword …` | inline `break-inside: unset` appears |
| `block-13-lines` | 4976 | 13 | `cm-keyword …` | no inline break rule (threshold is `>13`) |
| `empty` | 1774 | 1 | – | single empty line, `<br>`-less; `cm-zwsp` text `\n` |
| `info-string-numberLines` | 2423 | 2 | – | `{.numberLines}` ⇒ `md-fences-with-lineno`, gutters `height:100%`, wrapper `lang="{.numberlines}"` |

Invariants asserted for every case:

* exactly `md-fences md-end-block ty-contain-cm modeLoaded`, `spellcheck="false"`,
  raw `lang`, and **no** `cid`/`contenteditable`/`mdtype`/`data-mdpdf-fence`;
* inner wrapper is exactly `CodeMirror cm-s-inner cm-s-null-scroll CodeMirror-wrap`
  with the lower-cased `lang`;
* no `CodeMirror-cursors`/`-hscrollbar`/`-vscrollbar`/`-selectedtext`/`-selected`,
  no `min-height` on the sizer, no U+200B anywhere;
* one `.CodeMirror-line` per source line, `CodeMirror-activeline` on exactly one
  line, `break-inside` present iff `lines > 13`.

Also checked outside the suite (`scratch/t5.mjs`):
`renderFence(cpp) === renderFences([…14 items…])[0] === renderFence(cpp)` on a
second run — batch/position/repeat independent.

## 8. Rerun

```powershell
cd E:\work\reverse\markdown2pdf
node src\fence\verify.js          # human summary, exit 0 = pass
node src\fence\verify.js --json   # machine-readable report
```

Scratch probes kept for audit: `scratch/probe2.mjs` (line box / DPR / Text-node
`innerHTML`), `scratch/probe3.mjs` (device-scale table, attribute order),
`scratch/probe4.mjs` (`page-break-inside` CSSOM normalisation),
`scratch/t5.mjs` (batch equality), `scratch/ref-fence.txt` (ground truth copy).
