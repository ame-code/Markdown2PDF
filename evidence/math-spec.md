# Math rendering spec — Typora 1.9.5 print export parity

Scope: reproduce **exactly** the math HTML Typora 1.9.5 emits into its print/PDF
export: MathJax 3 `tex-svg` output as `<mjx-container class="MathJax" jax="SVG">…</mjx-container>`
plus the `MathJax.svgStylesheet()` `<style>` payload, plus Typora's own wrappers and
export fix-ups. Owned by `math-analyst`; code lives in `src/math/`.

Everything below is evidence-backed; offsets refer to
`D:\Typora\resources\appsrc\window\frame.js` (1.6 MB minified, 2026-10 Typora 1.9.5
install) and `D:\Typora\resources\window.html` (91,579 B).

---

## 1. Version and assets

| item | value |
|---|---|
| MathJax version | **3.2.2** (runtime `MathJax.version`; matches the `3.2.2` banner in the bundle) |
| bundle | `lib.asar` → `lib/MathJax3/es5/tex-svg-full.js`, 2,275,148 B, sha256 `99cae0214ad02619caed5d636401181e5572b36d8f668d0a8db51afc7b268e46` |
| required sibling component | `lib/MathJax3/es5/input/tex/extensions/xypic.js`, 355,205 B, sha256 `4f43a95cee098687614efe3c6bd8ffaaa10a086ba30dec1049b67e8eab6f8e7b` |
| vendored copies | `src/math/vendor/tex-svg-full.js` + `src/math/vendor/input/tex/extensions/xypic.js` (identical bytes) |
| config | `window.html` @25131..30703 → `src/math/typora-mathjax-config.js` (verbatim, 113 lines) |
| config runtime | `src/math/harness.html` (loads config, then bundle; file:// origin) |

**`tex-svg-full`**, not `tex-svg`: the bundle is a single combined component that already
contains the TeX input jax *and* the SVG output jax (there is no `input/tex.js` /
`output/svg.js` pair next to it). `-full` also means every TeX extension is compiled in;
Typora still lists `xypic` in `loader.load`, so the component file **must** exist next to
the bundle or startup aborts with `Can't load "…/input/tex/extensions/xypic.js"`.
Verified: bundle alone → startup never finishes; bundle + `input/tex/extensions/xypic.js`
→ identical init log to the unpacked `lib.asar` tree.

### Config decisions that matter (all from `window.html` @25131..30703)

```js
loader:  { load: ['input/tex/extensions/xypic'] },           // ONLY component load
startup: { typeset: false,
           ready: () => { RANGES[28][3]=RANGES[30][3]=RANGES[33][3]=RANGES[47][3]='mtext';
                          MathJax.startup.defaultReady();
                          MathJax.startup.document.addStyleSheet(); },
           pageReady: () => {} },                            // startup is deferred
tex:     { packages: {'[+]': ['noundefined','autoload','ams','textmacros','xypic']},
           tags: 'none' /* autoNumberingForMath off */, useLabelIds: true,
           displayMath: [['$$\n','\n$$'],['$$\r\n','\r\n$$']],
           inlineMath: [['$','$'],['$$','$$']], processEscapes: true,
           maxBuffer: 10*1024, formatError: <node factory error>,
           macros: {…TeX/AMS aliases…} },
svg:     { scale: 1, minScale: 80 },
options: { enableMenu: false,
           skipHtmlTags: ['script','noscript','style','textarea','pre','code','span'],
           processHtmlClass: 'md-mathjax-preview|md-inline-math|inline-math-export-jax|math-in-toc',
           sre: {speech:'shallow'}, menuOptions:{settings:{inTabOrder:false}},
           safeOptions: {…} /* unknown to this build: warns once, ignored */ }
```

Observed runtime option values (probed from `MathJax.startup.output.options`):

```
scale 1 · minScale 80 · fontCache "local" · displayAlign "center" · displayIndent "0"
exFactor 0.5 · internalSpeechTitles true · titleID 0 · mtextInheritFont false
menuOptions.enableMenu false · tags.counter starts 0 · allLabels {} (tags 'none')
```

* **`fontCache: 'local'`** — the default; nothing in Typora's config overrides it. Each
  `<mjx-container>` therefore carries its own `<defs>` with `MJX-<localID>-<variant>-<code>`
  path ids and references them with `<use xlink:href="#…">`. *This is the mode to match*;
  `'global'` would hoist a single shared `<defs>` and change every id.
* **`enableAssistiveMml` is left at MathJax's default `true`** — Typora does **not** turn it
  off. Probed pre-export container contains
  `<mjx-assistive-mml unselectable="on" display="block">…</mjx-assistive-mml>`; the print
  export deletes that node (§3). Because `a11y/sre` is never loaded, no `title`/`aria-label`
  attributes are produced (`blockTitles: 0`), so the "alt from aria-label" fix-up is a no-op
  for this build. Faithful implementation = keep a11y on, strip at export.

---

## 2. Typesetting pipeline Typora uses

| step | evidence |
|---|---|
| editor installs `afterRender` action priority 1001: prefix non-`mjx-` ids inside the output `<svg>` with `mjx-`, drop `[class]` tokens not matching `mjx-*`, and copy container `aria-label` → svg `alt` | frame.js **@1172565** |
| removes MathJax's `addMenu` render action | frame.js @1172530 |
| display math metrics: `MathJax.getMetricsFor(document.querySelector('#write>p') || #write, true)` (`true` ⇒ display) | frame.js **@1173100** |
| `displayLines` render action (unless `File.option.noDisplayLinesInMath`, default **false** @569400): multi-line display math not already in an environment is wrapped in `\displaylines{…}` | frame.js **@1173270–1173560** |
| `renderTex(tex, dataset, sync, …)` → `{dom, mathTagBefore, mathTagAfter, mathLabels}`; resets tag counter via `MathJax.texReset(n)` and reconciles `allLabels`; returns `MathJax.tex2svg|tex2svgPromise(tex, options)` post-processed | frame.js **@1174610** |
| tags source: `x() = MathJax.startup.document.inputJax[0].parseOptions.tags` (`.counter`, `.allLabels`) | frame.js @1174580 |
| per-block HTML renderer: cache by tex; first **8** math blocks render eagerly, later ones via `math-jax-postprocess` chunk pass (batches of 60) | frame.js **@40629**, chunk pass @1175114 |
| export: `getSVGForExport(node, inline, forPrint)` clones the element, removes `mjx-assistive-mml` unless `forPrint`, clones the `mjx-container`, wraps block output in `<div class='md-math-container'>`, trims outer/inner whitespace, then `processExportedSVG(html, true)` | frame.js **@708156** |
| `processExportedSVG` injects the print rule `mjx-container[jax="SVG"] path[data-c], mjx-container[jax="SVG"] use[data-c] { stroke-width: 0; }` into the stylesheet | frame.js @708420 / 708698 (module export alias @1249112) |

**Block math options** are therefore `{...getMetricsFor(#write>p, true), display: true}`
which yields `containerWidth 783`, `scale 80`, `em/ex` from the writing area — confirmed by
byte equality of every geometry attribute (`width/height/viewBox/vertical-align`), which are
exactly what those metrics feed. **Inline math** uses `{display: false}` only (no metrics
object); passing display metrics to inline math changes nothing observable in the SVG but is
not what Typora does.

### TeX input given to MathJax (question 4)

`renderTex` passes the block's raw `text` model attribute straight to `tex2svg*`; the only
transformation on the path is `displayLines` (above). No `\label`/`\tag` stripping happens in
the math renderer: `\label` is not removed from the source; instead, with `tags:'none'`,
`useLabelIds:true`, the tag/label bookkeeping (`tags.counter`, `tags.allLabels`) is what
Typora snapshots into the wrapper:

```
data-math-tag-before="<counter before this formula>"
data-math-tag-after="<counter after>"            // both "0" with autoNumberingForMath off
data-math-labels="<JSON of label keys created by this formula>"   // "[]" for the corpus
```

Corpus confirmation: the artifact's block wrapper has `data-math-tag-before="0"
data-math-tag-after="0" data-math-labels="[]"`, and its `<script type="math/tex">E = mc^2</script>`
carries the source verbatim.

---

## 3. Exact markup contracts

**Inline** (sequence inside the paragraph):

```html
<mjx-container class="MathJax" jax="SVG" style="position: relative;">…svg…</mjx-container><script type="math/tex">E = mc^2</script>
```

Attribute order is stable and meaningful: `class`, `jax`, `display` *(block only)*, `style`.
The `style="position: relative;"` is written by MathJax's assistive-MML render action; it
**survives** the print export (only the `mjx-assistive-mml` child is removed), so it must be
present. The trailing `<script type="math/tex">` is Typora's, holding the raw TeX
(HTML-escaped by the serializer).

**Block** (Typora wrapper, attributes verbatim from the artifact):

```html
<div contenteditable="false" spellcheck="false" class="mathjax-block md-end-block md-math-block md-rawblock"
     id="mathjax-n27" cid="n27" mdtype="math_block"
     data-math-tag-before="0" data-math-tag-after="0" data-math-labels="[]">
  <div class="md-math-container">
    <mjx-container class="MathJax" jax="SVG" display="true" style="position: relative;">…svg…</mjx-container>
  </div>
</div>
```

`id`/`cid` come from the Markdown node (`n<NN>`, shared with the rest of the document's
`cid` scheme); the `mathjax-` prefix is Typora's, not MathJax's `mjx-` prefix. Note the
editor-side class is `md-rawblock-container md-math-container math-jax-postprocess`
(frame.js @40629); the **export** keeps only `md-math-container`.

**SVG element** (MathJax 3 SVG output, unchanged by Typora):

```html
<svg xmlns="http://www.w3.org/2000/svg" width="8.699ex" height="2.072ex" role="img"
     focusable="false" viewBox="0 -833.9 3845.1 915.9" xmlns:xlink="http://www.w3.org/1999/xlink"
     aria-hidden="true" style="vertical-align: -0.186ex;">
```

Fraction bars are plain `<rect width="3900.4" height="60" x="120" y="220"></rect>` (serialized
with an explicit close tag), glyphs are `<use data-c="…" xlink:href="#MJX-…">` inside
`<g stroke="currentColor" fill="currentColor" stroke-width="0" transform="scale(1,-1)">`,
nodes are tagged `data-mml-node="…"`. No `<mfenced>`, no `mjx-assistive-mml`, no `title`.

**`<style>` payload** (only when the document has math):

```
'html {overflow-x: initial !important;}' + MathJax.svgStylesheet().innerHTML + TYPO_STROKE_RULE
```

`MathJax.svgStylesheet().innerHTML` is **2,688 characters** with this exact bundle+config;
the full text is **2,835 characters** and appears in the reference export byte-for-byte
(checked with `String.includes`). The appended rule keeps Typora's original indentation:

```
mjx-container[jax="SVG"] path[data-c], mjx-container[jax="SVG"] use[data-c] {
							stroke-width: 0;
						}
```

`MATH_CSS` is generated by `node src/math/build-css.cjs` from the vendored bundle rather than
hand-maintained, and emitted both as ESM (`mjx-svg-css.js`) and CJS (`mjx-svg-css.cjs`).

---

## 4. Ids: `MJX-<n>-…` and determinism

* `MJX-<localID>-<variant>-<code>` with `fontCache:'local'`; the number is MathJax's per-page
  **typeset counter** (`OutputJax.options.localID`, incremented by `FontCache.useLocalID()` on
  each typeset call), *not* anything derived from the formula.
* In the reference export the display formula carries `MJX-1-…` and the inline one `MJX-3-…`:
  the counter reflects the editor's render history (an earlier preview/typeset consumed 2).
* It **is** controllable: assign `MathJax.startup.output.options.localID = n` (or pass
  `localID` in our `convert` options / in the in-page item) before the call. Verified: pinning
  inline→3 and block→1 reproduces the artifact's ids exactly, hence full byte equality.
* Do **not** pass `localID` *inside* the per-call options object parsed by MathJax
  (`tex2svg(tex, {localID})`) — it is not a document option and MathJax warns
  `Invalid option "localID"`. Set it on the output jax (what we do).
* `<use>` targets always resolve inside the same container (`usesResolve: true` for all five
  verdict formulas), so id drift is invisible in rendered output; only HTML-level diffs see it.

---

## 5. Multi-line `\\`, `\tag`, labels

* **Multi-line display math.** Typora registers a `displayLines` render action
  (frame.js @1173270) unless `File.option.noDisplayLinesInMath` (default `false`). A *display*
  formula containing `\\` or `\newline` and whose leading construct is not an
  environment/`\command` from the allow-list gets wrapped:

  ```
  \displaylines{
  a\\b
  }
  ```

  Allow-list: any leading command matching `begin|command|matrix|align|eq` (substring), or one
  of `def let newenvironment array displaylines enclose gather gathered leqalignno multiline
  split`. So `\begin{aligned}a&=b\\c&=d\end{aligned}` is **not** wrapped; `a\\b` is. Inline math
  is never wrapped.
* **Dead branch.** The action's first test compares `math[0]` to the 5-character literal string
  `"\u32E"` (frame.js @1173330) — minification damage; it can never match, so a leading
  ZWSP/sentinel is *not* stripped in 1.9.5. Our port reproduces the observable behaviour
  (nothing stripped) and documents it.
* **`\tag` / numbering.** `tags` = `'none'` unless the user enables auto-numbering
  (`autoNumberingForMath` ⇒ `'all'` / `'ams'`), so the corpus has no tag numbers. With
  numbering on, the counter snapshot lands in `data-math-tag-before/after` and newly created
  labels in `data-math-labels` (frame.js `renderTex` @1174610). `\label{}` inside the source is
  left in the TeX; MathJax's tag engine records it (`useLabelIds: true`) and Typora records the
  new keys. Our module emits the wrapper with `0 / 0 / []` for the untagged case and exposes
  `typoraDisplayLines()` for the wrapping rule.
* Formula source with `$$` delimiters: `tex.displayMath` in the config only affects page
  scanning; Typora hands the *inner* source (delimiters stripped, `\u200B`-free) to MathJax.
  Verified against the artifact: `\sum_{i=1}^{n} i = \frac{n(n+1)}{2}` produces exactly the
  exported SVG.

---

## 6. Byte-diff verdicts

Harness: `node src/math/verify.js` (17 checks). Reference:
`E:\work\reverse\reverse-typora-export\evidence\real-export-html-MATH.html`.

| # | formula | mode | result |
|---|---|---|---|
| 1 | `E = mc^2` (inline, `<script type="math/tex">` included) | inline | **byte-identical** (with `localID=3`) — 3,809 B; `8.699ex × 2.072ex`, `viewBox "0 -833.9 3845.1 915.9"`, `vertical-align: -0.186ex;` |
| 2 | `\sum_{i=1}^{n} i = \frac{n(n+1)}{2}` incl. the whole `mathjax-block` wrapper | display | **byte-identical** (with `localID=1`) — 5,778 B; `16.809ex × 6.354ex`, `viewBox "0 -1562.5 7429.7 2808.5"`, `vertical-align: -2.819ex;` |
| 3 | `\frac{a}{b}` | display | **pipeline-identical, deterministic** (no Typora artifact exists for it) — 1,883 B, `2.192ex × 4.104ex`, `viewBox "0 -1117 969 1814"`, `-1.577ex`; bar `<rect width="729" height="60" x="120" y="220">`; ids `MJX-11-TEX-I-1D44E/1D44F` |
| 4 | `\sqrt{x^2+y^2}` | display | pipeline-identical — 3,795 B, `9.451ex × 2.851ex`, `viewBox "0 -1052.7 4177.6 1260"`, `-0.469ex`; radicand bar `<rect width="3157.6" height="60" x="1020" y="932.7">`; `msqrt`/`msup` |
| 5 | `\begin{aligned}a&=b\\c&=d\end{aligned}` | display | pipeline-identical — 3,865 B, `5.39ex × 5.204ex`, `viewBox "0 -1400 2382.6 2300"`, `-2.036ex`; `mtable/mtr/mtd`; `displayLines` correctly leaves it untouched |

"Pipeline-identical" means: same bundle, same config, same options path
(`{...getMetricsFor(#write>p,true), display:true}`), no `merror` node, ids/`<use>` consistent,
and repeated runs are deterministic. Formulas 1–2 are the only ones for which Typora produced
an oracle, and both are byte-for-byte equal to it — including all `path d=` data, every
attribute and its order, and the `<script type="math/tex">` payload.

Checks also proving: `MATH_CSS === MathJax.svgStylesheet().innerHTML`; the full
`<style>` text (`MATH_PRINT_STYLE`) is present verbatim in the reference; unpinned ids drift
(`MJX-<n>`) while pinned ones match; the Lead's in-page contract reproduces both corpus
formulas byte-identically; `displayLines` behaves per the four cases (wrap / aligned / inline /
single-line).

---

## 7. Nesting (link, heading, TOC)

MathJax's output is a single inline-level `<mjx-container>` element, so it nests like any
inline node: inside `<a>`/`<h1..h6>` Typora emits the same container markup (with the trailing
`<script type="math/tex">` in inline mode) and no extra wrapper; the block wrapper's
`contenteditable="false"`/`md-*` attributes are only ever emitted for display math. The
corpus contains no math inside a heading or link, so this is structural evidence rather than
an artifact byte-diff.

TOC is the one special case: `processHtmlClass` includes `math-in-toc`, and the TOC math
handler (frame.js @911353) also clones the container, removes `mjx-assistive-mml` and calls
`processExportedSVG(...)`; if the TOC entry's math has not been rendered it degrades to
`<span class='math-in-toc'>$…$</span>`. Exporting a document with math in headings therefore
requires the same MATH_ASSETS to be present in the exporting page — which it is.

---

## 8. Module usage

Two entry points (repo is `"type": "module"`, hence `index.cjs` is the CommonJS one the
spec asks for):

```js
// CJS
const math = require('./src/math');          // → src/math/index.cjs
// ESM
import * as math from './src/math/index.js';

await math.renderInline('E = mc^2');         // <mjx-container …></mjx-container><script type="math/tex">E = mc^2</script>
await math.renderBlock('\\sum_{i=1}^{n} i', 'n27');   // full mathjax-block div
await math.typeset('\\frac{a}{b}', { display: true, localID: 11 }); // bare container
const css = math.MATH_CSS;                   // MathJax.svgStylesheet().innerHTML (2,688 chars)
const style = math.MATH_PRINT_STYLE;         // html rule + css + stroke rule (2,835 chars)
await math.close();                          // always close the shared browser
```

Batch: `typesetBatch([{tex, display, localID}, …])` reuses one page (one browser per process,
lazy-opened on first call, `close()` tears it down; `open()` is idempotent).

**Export-pipeline contract** (what `src/build.js` uses; validated end-to-end):

```js
import { MATH_ASSETS, MATH_ASSET_DIR, MATH_CSS, MATH_PRINT_STROKE_RULE, MATH_INPAGE } from './src/math/index.js';
// 1. document <style>: MATH_CSS + MATH_PRINT_STROKE_RULE
// 2. before the render script, in a file:// page:
//    <script src="file:///<MATH_ASSET_DIR>/tex-svg-full.js"></script>   after the config script
// 3. <script>MATH_INPAGE</script>            (source string, not evaluated by Node)
// 4. await window.md2pdfRenderMath(P.math)   // items {index, kind:'inline'|'block', tex, [localID]}
```

Placeholders: inline `<span data-mdpdf-math-inline="i"></span>`, block
`<div … data-mdpdf-math-block="i"><div class="md-math-container"></div></div>`. The renderer
removes the marker attribute, appends `<script type="math/tex">` for inline, and awaits
MathJax startup itself (`md2pdfEnsureMathJax()` → `await MathJax.startup.promise` + poll for
`startup.document && tex2svgPromise`), so one awaited call is always sufficient.

Runtime asset dependencies (all relative to `src/math/`):

```
vendor/tex-svg-full.js                          (MathJax 3.2.2 tex-svg-full)
vendor/input/tex/extensions/xypic.js            (must stay at that relative path)
typora-mathjax-config.js                        (verbatim config from window.html)
harness.html                                    (Node-side singleton page template)
vendored Chromium: <playwright>/chromium-1112/chrome-win/chrome.exe
```

`harness.html` keeps a `file://` origin on purpose: an inlined 2.2 MB bundle has no `src`, so
MathJax resolves relative components against the wrong base and startup hangs. Inject assets
with a URL, on a `file://`/http document.

---

## 9. Residual differences / open items

1. **Id counter drift** — `MJX-<n>` is editor-history dependent in Typora; our default is
   deterministic-per-call-order. Pixel output is unaffected; pass `localID` for HTML-level
   byte equality.
2. **No oracle for formulas 3–5** — Typora produced no export containing them; verdict is
   "same pipeline, geometry self-consistent", not "equals an artifact".
3. **`\tag`/auto-numbering** — `data-math-tag-before/after` and `data-math-labels` are emitted
   with the untagged (`0/0/[]`) values actually observed; auto-numbered documents
   (`autoNumberingForMath`) are untested end-to-end and would also make MathJax emit tag
   numbers and `mjx-` ids that our afterRender prefix fix-up must keep intact.
4. **`displayLines` ZWSP guard** — dead branch in Typora (§5); we match the observable result.
5. **`safeOptions` warning** — config passes `options.safeOptions`, but this build has no safe
   extension (`ui/safe` commented out), so MathJax prints
   `Invalid option "safeOptions" (no default value).` once. Harmless; identical log in Typora.
6. **Nesting in headings/links/TOC** — structural reasoning (§7); no artifact oracle.

## 10. Reproduce

```
node src/math/build-css.cjs   # regenerate MATH_CSS (ESM + CJS twins) from the bundle
node src/math/verify.js       # 17 parity checks vs the real export; exit 0 = green
```

`src/math/scratch/` holds the throwaway probes (`lead-wire.cjs` replays the build.js wiring
end-to-end, `probe-attrs.cjs` dumps pre/post-export containers, `dump-extras.cjs` prints the
per-formula geometry table). `evidence/math-spec.md` is this file.
