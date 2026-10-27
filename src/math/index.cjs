'use strict';
/**
 * src/math/index.cjs — CommonJS facade (the repo is `"type": "module"`, so the
 * spec-mandated CommonJS entry point is this file; `index.js` is the ESM twin).
 *
 *   const math = require('./src/math');            // -> index.cjs
 *   await math.renderInline('E = mc^2');
 *   await math.renderBlock('\\sum_{i=1}^{n} i', 'n27');
 *   const css = await math.mathjaxSvgStylesheet();  // or math.MATH_CSS (precomputed)
 *   await math.close();
 *
 * The in-page contract for the export pipeline is the same as the ESM entry:
 * `MATH_ASSETS`, `MATH_CSS`, `MATH_INPAGE`, `MATH_PRINT_STYLE`.
 */

const path = require('path');
const core = require('./core.cjs');
const { MATH_CSS } = require('./mjx-svg-css.cjs');
const { MATH_INPAGE } = require('./inpage.cjs');

const MATH_CONFIG_JS = path.join(__dirname, 'typora-mathjax-config.js');
const MATH_BUNDLE = path.join(__dirname, 'vendor', 'tex-svg-full.js');
// MathJax resolves `input/tex/extensions/xypic.js` relative to the bundle URL.
const MATH_ASSET_DIR = path.join(__dirname, 'vendor');
const MATH_BUNDLE_FALLBACK =
  'E:\\work\\reverse\\reverse-typora-export\\unpacked\\lib\\MathJax3\\es5\\tex-svg-full.js';

/** Scripts to inject into the export page, in order: config, then bundle. */
const MATH_ASSETS = [MATH_CONFIG_JS, MATH_BUNDLE];

const MATH_PRINT_STROKE_RULE = core.TYPO_STROKE_RULE_CSS;
const MATH_HTML_RULE = core.TYPO_HTML_OVERFLOW_RULE;
const MATH_PRINT_STYLE = MATH_HTML_RULE + MATH_CSS + MATH_PRINT_STROKE_RULE;

module.exports = {
  MATHJAX_VERSION: core.MATHJAX_VERSION,
  MATH_CONFIG_JS,
  MATH_BUNDLE,
  MATH_ASSET_DIR,
  MATH_BUNDLE_FALLBACK,
  MATH_ASSETS,
  MATH_CSS,
  MATH_INPAGE,
  MATH_HTML_RULE,
  MATH_PRINT_STROKE_RULE,
  MATH_PRINT_STYLE,

  resolveAssets: core.resolveAssets,
  open: core.open,
  close: core.close,
  typeset: core.typeset,
  typesetBatch: core.typesetBatch,
  renderInline: core.renderInline,
  renderBlock: core.renderBlock,
  blockWrapper: core.blockWrapper,
  escapeHtml: core.escapeHtml,
  mathjaxSvgStylesheet: core.mathjaxSvgStylesheet,
  printStyleText: core.printStyleText,
  typoraDisplayLines: core.typoraDisplayLines,
  typoraAfterRender: core.typoraAfterRender,
  DISPLAYLINES_ENVS: core.DISPLAYLINES_ENVS,
};
