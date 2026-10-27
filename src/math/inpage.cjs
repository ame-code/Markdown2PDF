'use strict';
/**
 * inpage.cjs — the browser-side renderer Typora-parity pipelines inject with
 * `page.evaluate(MATH_INPAGE)`.  Kept as a source STRING so it can be sent to
 * Chromium unchanged; it defines `window.md2pdfRenderMath(items)` and
 * `window.md2pdfTyporaDisplayLines(tex, display)`.
 */
const MATH_INPAGE = String.raw`
function md2pdfTyporaDisplayLines(tex, display) {
  // Port of Typora's "displayLines" render action, frame.js @1173270
  // (registered unless File.option.noDisplayLinesInMath, default false).
  // It wraps a multi-line display formula that is not already inside a
  // \begin{...} environment in \displaylines{...}, because top-level "\\"
  // is not valid TeX.
  if (!display || typeof tex !== 'string' || tex.length === 0) return tex;
  // Typora's own guard compares math[0] against the 5-character literal "\u32E"
  // (frame.js @1173330), so it can never match; nothing is stripped here either.
  if (!/\\(\\|newline)/.test(tex)) return tex;
  var m = /^(?:\s|(?:\s*%[^\n]*\n))*\\([a-z]+)/i.exec(tex);
  if (m) {
    var env = m[1];
    if (/(begin|command|matrix|align|eq)/.exec(env)) return tex;
    if (['def', 'let', 'newenvironment', 'array', 'displaylines', 'enclose',
         'gather', 'gathered', 'leqalignno', 'multiline', 'split'].indexOf(env) !== -1) return tex;
  }
  return '\\displaylines{\n' + tex + '\n}';
}

/**
 * Wait until MathJax 3 has finished its deferred startup.
 *
 * Typora's config sets startup.typeset: false and installs ready/pageReady
 * hooks, so the bundle only becomes usable after pageReady fires.  A renderer
 * script that runs right after the bundle's script tag (before DOMContentLoaded
 * / the deferred startup task) sees MathJax.startup.document === undefined.
 * Calling this first makes a single await md2pdfRenderMath(items) sufficient.
 */
async function md2pdfEnsureMathJax(timeoutMs) {
  var limit = timeoutMs || 30000;
  var t0 = Date.now();
  if (!window.MathJax) {
    throw new Error(
      'md2pdfEnsureMathJax: window.MathJax is missing - load MATH_ASSETS (typora-mathjax-config.js ' +
      'then tex-svg-full.js) before this script. If the page is http(s), file:// scripts are blocked.'
    );
  }
  var MJ = window.MathJax;
  if (MJ.startup && MJ.startup.promise) {
    var timedOut = false;
    try {
      await Promise.race([
        MJ.startup.promise,
        new Promise(function (_, reject) {
          setTimeout(function () { timedOut = true; reject(new Error('startup.promise timed out')); }, limit);
        }),
      ]);
    } catch (e) {
      if (timedOut) throw new Error('md2pdfEnsureMathJax: MathJax startup did not finish within ' + limit + 'ms');
      // startup rejected: fall through so the poll below reports the real state
    }
  }
  while (!(MJ.startup && MJ.startup.document && MJ.tex2svgPromise)) {
    if (Date.now() - t0 > limit) {
      throw new Error(
        'md2pdfEnsureMathJax: MathJax loaded but never initialized (no startup.document/tex2svgPromise). ' +
        'Usual cause: the bundle is not next to input/tex/extensions/xypic.js - Typora config has ' +
        "loader.load:['input/tex/extensions/xypic']; copy src/math/vendor/ as a directory."
      );
    }
    await new Promise(function (r) { setTimeout(r, 50); });
  }
  return MJ;
}

async function md2pdfRenderMath(items) {
  var MJ = await md2pdfEnsureMathJax();
  var anchor = document.querySelector('#write>p') || document.querySelector('#write');
  if (!anchor) throw new Error('md2pdfRenderMath: no #write container in the page');
  var output = MJ.startup.output;
  var results = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var display = item.kind === 'block';
    var tex = md2pdfTyporaDisplayLines(item.tex, display);
    var prevLocalID = output.options.localID;
    if (item.localID !== undefined && item.localID !== null) output.options.localID = item.localID;
    var node;
    try {
      node = display
        ? await MJ.tex2svgPromise(tex, Object.assign({}, MJ.getMetricsFor(anchor, true), { display: true }))
        : await MJ.tex2svgPromise(tex, { display: false });
    } finally {
      output.options.localID = prevLocalID;
    }
    // Print export (frame.js getSVGForExport, forPrint => remove): drop the
    // assistive-MathML shadow tree but keep the container's
    // style="position: relative;" (it is set by the a11y render action).
    var assistive = node.querySelector('mjx-assistive-mml');
    if (assistive) assistive.remove();

    if (display) {
      var block = document.querySelector('[data-mdpdf-math-block="' + item.index + '"]');
      if (!block) throw new Error('md2pdfRenderMath: no block placeholder for index ' + item.index);
      var box = block.querySelector('.md-math-container');
      if (!box) throw new Error('md2pdfRenderMath: block placeholder ' + item.index + ' has no .md-math-container');
      box.innerHTML = '';
      box.appendChild(document.importNode(node, true));
      block.removeAttribute('data-mdpdf-math-block');
    } else {
      var ph = document.querySelector('[data-mdpdf-math-inline="' + item.index + '"]');
      if (!ph) throw new Error('md2pdfRenderMath: no inline placeholder for index ' + item.index);
      var script = document.createElement('script');
      script.setAttribute('type', 'math/tex');
      script.textContent = item.tex;
      ph.replaceWith(document.importNode(node, true), script);
    }
    results.push({ index: item.index, kind: item.kind, ok: true });
  }
  return results;
}
window.md2pdfRenderMath = md2pdfRenderMath;
window.md2pdfEnsureMathJax = md2pdfEnsureMathJax;
window.md2pdfTyporaDisplayLines = md2pdfTyporaDisplayLines;
`;

module.exports = { MATH_INPAGE };
