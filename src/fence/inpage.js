/*
 * FENCE_INPAGE -- the browser-side half of the fence renderer, kept as a STRING
 * so a host page can inject it (`<script>` or CDP Runtime.evaluate) without a
 * bundler.  It defines the global `md2pdfRenderFences(items)`.
 *
 * Preconditions in the host page (see index.js FENCE_SCRIPTS / FENCE_ASSETS):
 *   1. Typora's CSS is live: style/base.css + style/codemirror.css
 *      (+ the user theme's html/body rules; see mountFenceAssets()).
 *   2. Scripts loaded in this order: cm/typora-globals.js (File stub),
 *      cm/codemirror5.js (sets window.CodeMirror), cm/mode.min.js (all modes),
 *      cm/active-line.js (styleActiveLine DOM), cm/tw-lang-mode.js
 *      (window.__typoraModeAlias = Typora's language->mode table).
 *   3. Each fence placeholder is already in the document:
 *        <pre class="md-fences md-end-block ty-contain-cm" spellcheck="false"
 *             lang="cpp" data-mdpdf-fence="0"></pre>
 *
 * The algorithm is Typora 1.9.5's own, replayed operation by operation:
 *   frame.js @99356-100140  construct the hidden CodeMirror for the fence
 *   frame.js @107655        the mock <pre> skeleton (renderFences)
 *   frame.js @704163-706700 the export DOM surgery (case A.fences)
 */

export const FENCE_INPAGE = String.raw`
/*
 * md2pdfRenderFences -- fill Typora 1.9.5 fence placeholders with the exact
 * read-only CodeMirror 5 DOM Typora exports.
 *
 * items: [{ index: number|string, code: string, lang?: string,
 *           lineNumbers?: boolean, firstLineNumber?: number }]
 * options: {
 *   codeIndentSize: 4, noLineWrapping: false, noPairingMatch: false,
 *   showLineNumbersForFence: false, lineWiseCopyCut: false, print: false
 * }  -- the File.option values stock Typora 1.9.5 uses (frame.js @568167).
 *
 * Resolves to [{ index, html }] (html = the final <pre> outerHTML, trimmed).
 */
async function md2pdfRenderFences(items, options) {
  var DEFAULTS = {
    codeIndentSize: 4,
    noLineWrapping: false,
    noPairingMatch: false,
    showLineNumbersForFence: false,
    lineWiseCopyCut: false
  };
  var opts = {};
  var k;
  for (k in DEFAULTS) opts[k] = DEFAULTS[k];
  if (options) for (k in options) if (options[k] !== undefined) opts[k] = options[k];

  // CodeMirror measures the first line box on init: fonts must be resolved.
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }

  // Typora's getCodeMirrorMode(): lower-case, strip a leading "lang-"/"language-"
  // prefix and braces, then map the first comma/space separated token through
  // its alias table u() (frame.js @89996, table @82873).
  function getCodeMirrorMode(lang) {
    var e = lang ? String(lang).toLowerCase() : '';
    e = e.replace(/^\s*\.*lang(uage)*-/g, '').replace(/[{}]/g, '').trim();
    var r = ((e.split(/[\s,]+/) || [e]))[0];
    var o = window.__typoraModeAlias(e);
    return (o || e === r) ? o : window.__typoraModeAlias(r.replace(/(^[.])|(,$)/g, ''));
  }

  // Collect placeholders once; a stable map keeps the lookup cheap and avoids
  // CSS-escaping questions for arbitrary index values.
  var placeholders = document.querySelectorAll('[data-mdpdf-fence]');
  var byIndex = {};
  for (var p = 0; p < placeholders.length; p++) {
    byIndex[String(placeholders[p].getAttribute('data-mdpdf-fence'))] = placeholders[p];
  }

  var results = [];

  for (var i = 0; i < items.length; i++) {
    var item = items[i] || {};
    var index = String(item.index !== undefined ? item.index : i);
    var code = item.code == null ? '' : String(item.code);
    var lang = item.lang == null ? '' : String(item.lang);

    var pre = byIndex[index];
    if (!pre) { results.push({ index: index, html: null, error: 'no placeholder for index ' + index }); continue; }

    // ---- the mock <pre> Typora's own parser emits (frame.js @107655) -----
    // classes md-fences/mock-cm/md-end-block (+md-fences-with-lineno when the
    // global option is on); the editor then swaps mock-cm for ty-contain-cm.
    if (!pre.classList.contains('md-fences')) pre.classList.add('md-fences');
    pre.classList.remove('mock-cm');
    if (!pre.classList.contains('md-end-block')) pre.classList.add('md-end-block');
    if (!pre.classList.contains('ty-contain-cm')) pre.classList.add('ty-contain-cm');
    if (opts.showLineNumbersForFence && !pre.classList.contains('md-fences-with-lineno')) {
      pre.classList.add('md-fences-with-lineno');
    }
    pre.setAttribute('spellcheck', 'false');
    // frame.js sets lang="" unconditionally, so a language-less fence keeps an
    // *empty* lang attribute through the export.
    pre.setAttribute('lang', lang);
    pre.innerHTML = '';

    // ---- CodeMirror options, verbatim from frame.js @99356 ---------------
    var cmOptions = {
      lineWrapping: !opts.noLineWrapping,
      mode: getCodeMirrorMode(lang),
      styleSelectedText: true,
      maxHighlightLength: Infinity,
      viewportMargin: Infinity,
      styleActiveLine: true,
      autoCloseBrackets: !opts.noPairingMatch,
      autoCloseTags: !opts.noPairingMatch,
      theme: ' inner null-scroll',
      lineNumbers: !!opts.showLineNumbersForFence,
      resetSelectionOnContextMenu: true,
      cursorScrollMargin: 60,
      dragDrop: false,
      indentUnit: opts.codeIndentSize,
      tabSize: opts.codeIndentSize,
      lineWiseCopyCut: !!opts.lineWiseCopyCut,
      scrollbarStyle: 'null',
      value: code
    };
    // Typora's M(lang) -- fence info attributes (frame.js @100327):
    //   var e=t; return e&&"{"==e[0]&&"}"==e[e.length-1] &&
    //     (e=e.replace(/(^{)|(}$)/g,"").split(/\s+/)) && e.length
    //       ? (t={}, e.forEach(function(e){ /^[.]number((-?l)|L)ines/.exec(e)
    //             ? t.lineNumbers=!0
    //             : (e=/^startFrom=['"](\d+)['"]$/.exec(e)) && (t.firstLineNumber=+e[1]) }), t)
    //       : {}
    // Typora merges the result over the CM options with Object.assign.
    if (lang.length > 1 && lang.charAt(0) === '{' && lang.charAt(lang.length - 1) === '}') {
      var toks = lang.replace(/(^{)|(}$)/g, '').split(/\s+/);
      for (var ti = 0; ti < toks.length; ti++) {
        var sf;
        if (/^[.]number((-?l)|L)ines/.exec(toks[ti])) cmOptions.lineNumbers = true;
        else if ((sf = /^startFrom=['"](\d+)['"]$/.exec(toks[ti]))) cmOptions.firstLineNumber = +sf[1];
      }
    }
    if (item.lineNumbers) cmOptions.lineNumbers = true;
    if (item.firstLineNumber != null) cmOptions.firstLineNumber = item.firstLineNumber;

    var cm = CodeMirror(pre, cmOptions);
    var cmEl = cm.getWrapperElement();

    // frame.js @100840: wrapper carries the lower-cased language; the fence is
    // flagged modeLoaded because mode.min.js is part of the page.
    cmEl.setAttribute('lang', lang.toLowerCase());
    pre.classList.add('modeLoaded');
    if (!opts.showLineNumbersForFence && cmOptions.lineNumbers) {
      pre.classList.add('md-fences-with-lineno');
    }

    // ===== export DOM surgery (frame.js @704163-706700) ==================
    // 1. editor-only attributes are dropped; class/spellcheck/lang survive.
    pre.removeAttribute('cid');
    pre.removeAttribute('contenteditable');
    pre.removeAttribute('mdtype');
    pre.removeAttribute('data-mdpdf-fence');

    // 2. the <pre> keeps ONLY the .CodeMirror subtree (the adv panel clone and
    //    any mock content are discarded).
    pre.innerHTML = cmEl.outerHTML;

    // 3. editor chrome that must not reach print/PDF.
    var chrome = pre.querySelectorAll(
      '.CodeMirror-cursors, .CodeMirror-hscrollbar, .CodeMirror-vscrollbar, .CodeMirror-selected'
    );
    for (var c = 0; c < chrome.length; c++) chrome[c].parentNode.removeChild(chrome[c]);

    // 4. inline min-height on the sizer is pure editor bookkeeping.
    var sizers = pre.querySelectorAll('.CodeMirror-sizer');
    for (var s = 0; s < sizers.length; s++) sizers[s].style.minHeight = '';

    // 4b. CodeMirror's hidden metrics probes.  When a fence is serialised in the
    //     same task that created it, a measurement run can still be in flight,
    //     leaving a "<span><span>\u200b</span>x</span>" probe inside
    //     .CodeMirror-measure -- which is where the last zero-width space comes
    //     from.  In Typora the editor has long since finished measuring, so its
    //     export carries two empty probes (confirmed against the reference);
    //     emptying them makes our output independent of measurement timing and
    //     changes nothing visually (.CodeMirror-measure is
    //     position:absolute;height:0;visibility:hidden).
    var measures = pre.querySelectorAll('.CodeMirror-measure');
    for (var mi = 0; mi < measures.length; mi++) {
      while (measures[mi].firstChild) measures[mi].removeChild(measures[mi].firstChild);
    }

    // 5. selection styling class must not leak into the export.
    var sel = pre.querySelectorAll('.CodeMirror-selectedtext');
    for (var q = 0; q < sel.length; q++) sel[q].classList.remove('CodeMirror-selectedtext');

    // 6. CodeMirror's zero-width-space padding spans become literal newlines.
    var zw = pre.querySelectorAll('[cm-zwsp]');
    for (var z = 0; z < zw.length; z++) zw[z].textContent = '\n';

    // 6b. Serialisation-order normalisation for the hidden input field.
    //     Chromium does not expose a stable insertion position for the style
    //     attribute (it lives outside the attribute vector and is emitted at a
    //     position that depends on how it was written), so the same DOM can
    //     serialise as "... style=... tabindex=0" here and as
    //     "... tabindex=0 style=..." in Typora's Electron window.  Re-create
    //     the five attributes in Typora's order; values are untouched and the
    //     markup carries no rendering difference.  (See evidence/fence-spec.md,
    //     "textarea attribute order".)
    var ta = pre.querySelector('textarea');
    if (ta) {
      var taOrder = ['autocorrect', 'autocapitalize', 'spellcheck', 'tabindex', 'style'];
      var taVals = [];
      for (var a = 0; a < taOrder.length; a++) taVals.push(ta.getAttribute(taOrder[a]));
      for (var d = 0; d < taOrder.length; d++) ta.removeAttribute(taOrder[d]);
      for (var w = 0; w < taOrder.length; w++) {
        if (taVals[w] !== null) ta.setAttribute(taOrder[w], taVals[w]);
      }
    }

    // 7. more than 13 source lines -> allow a page break inside the block.
    if (code.split('\n').length > 13) pre.style.setProperty('page-break-inside', 'unset');

    // 8. line-number fences: gutters must span the block.  (Typora additionally
    //    rewrites .CodeMirror-linenumber font-size here, but only when the
    //    export requests an explicit fontSize override.)
    if (cmOptions.lineNumbers) {
      var gut = pre.querySelectorAll('.CodeMirror-gutters');
      for (var g = 0; g < gut.length; g++) gut[g].style.height = '100%';
    }

    // NOT reproduced: frame.js's Windows branch that re-writes ";" and "-" text
    // nodes of ".CodeMirror-line > span" into
    //   <span style='font-family:...'>;</span>
    // It assigns .innerHTML on *Text* nodes, which have no innerHTML: the
    // assignment is an inert expando, so Typora's own output is unchanged
    // (confirmed against the real export, and empirically in Chromium 124).
    // See evidence/fence-spec.md.

    results.push({ index: index, html: pre.outerHTML.trim() });
  }
  return results;
}
window.md2pdfRenderFences = md2pdfRenderFences;
`;
