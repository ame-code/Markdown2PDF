/**
 * src/math/index.js — ESM facade for Typora 1.9.5 math parity.
 *
 * Two ways to use it:
 *
 *  A) Pipeline (2-load browser flow) — inject these into the stage-1 page and
 *     call the in-page renderer, exactly like Typora's own editor does:
 *
 *        import { MATH_ASSETS, MATH_CSS, MATH_INPAGE } from './src/math/index.js';
 *        for (const src of MATH_ASSETS) await page.addScriptTag({ path: src });
 *        // <style> gets MATH_CSS (+ Typora's print stroke rule, see MATH_PRINT_STYLE)
 *        const results = await page.evaluate(MATH_INPAGE);
 *        await page.evaluate((items) => window.md2pdfRenderMath(items), items);
 *
 *  B) Node-side (headless Chromium owned by this module):
 *
 *        import { renderInline, renderBlock, typeset, mathjaxSvgStylesheet, close }
 *          from './src/math/index.js';
 *        await renderInline('E = mc^2');     // "<mjx-container …>…</mjx-container><script type="math/tex">…</script>"
 *        await renderBlock('…', 'n27');      // full mathjax-block wrapper
 *        await close();
 *
 * Verified byte-identical to the real Typora print export for
 * `$E = mc^2$` and `$$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$$`
 * (see evidence/math-spec.md and src/math/verify.js).
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import core from './core.cjs';
import { MATH_CSS } from './mjx-svg-css.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** MathJax build Typora 1.9.5 bundles (lib.asar -> lib/MathJax3/es5/tex-svg-full.js). */
export const MATHJAX_VERSION = core.MATHJAX_VERSION;

/** Typora's MathJax config, extracted verbatim from window.html @25131..30703. */
export const MATH_CONFIG_JS = path.join(HERE, 'typora-mathjax-config.js');

/**
 * The vendored `tex-svg-full.js` (MathJax 3.2.2, Apache-2.0). A copy lives in
 * `src/math/vendor/` so the module does not depend on the reverse-engineering
 * worktree; `MATH_BUNDLE_FALLBACK` is the unpacked lib.asar original.
 */
export const MATH_BUNDLE = path.join(HERE, 'vendor', 'tex-svg-full.js');
/**
 * Directory that must be served/copied *as a directory*: MathJax resolves
 * `input/tex/extensions/xypic.js` relative to the bundle's own URL (Typora's
 * config lists it in `loader.load`), so `tex-svg-full.js` alone is not enough.
 */
export const MATH_ASSET_DIR = path.join(HERE, 'vendor');
export const MATH_BUNDLE_FALLBACK =
  'E:\\work\\reverse\\reverse-typora-export\\unpacked\\lib\\MathJax3\\es5\\tex-svg-full.js';

/**
 * Scripts to inject into the export page, in load order (config first, then the
 * bundle — same order as Typora's window.html).
 *
 * IMPORTANT: inject with a URL, on a `file://` (or http) document:
 *   await page.addScriptTag({ url: pathToFileURL(src).href });
 * `{ path: src }` inlines the 2.2 MB script, leaving it without a `src`, so
 * MathJax's loader cannot resolve `input/tex/extensions/xypic.js` and startup
 * never finishes.  The bundle must stay next to `input/tex/extensions/xypic.js`
 * (`src/math/vendor/` already does), because Typora's config lists
 * `loader.load: ['input/tex/extensions/xypic']`.
 */
export const MATH_ASSETS = [MATH_CONFIG_JS, MATH_BUNDLE];

/**
 * `MathJax.svgStylesheet().innerHTML` of MathJax 3.2.2 with Typora's config.
 * This is the `<style>` payload Typora emits for math; it is byte-identical to
 * the stylesheet found in the reference export.
 * Regenerate with `node src/math/build-css.cjs`.
 */
export { MATH_CSS };

/** Rule Typora appends after MATH_CSS for print (frame.js processExportedSVG). */
export const MATH_PRINT_STROKE_RULE =
  'mjx-container[jax="SVG"] path[data-c], mjx-container[jax="SVG"] use[data-c] {\n' +
  '\t\t\t\t\t\t\tstroke-width: 0;\n' +
  '\t\t\t\t\t\t}';

/** `html {overflow-x: initial !important;}` — the rule that precedes MATH_CSS. */
export const MATH_HTML_RULE = 'html {overflow-x: initial !important;}';

/** Everything Typora puts in the math `<style>` element, in order. */
export const MATH_PRINT_STYLE = MATH_HTML_RULE + MATH_CSS + MATH_PRINT_STROKE_RULE;

// ---------------------------------------------------------------------------
// In-page renderer. Kept as a source string so the pipeline can inject it with
// `page.evaluate(MATH_INPAGE)`; it defines `window.md2pdfRenderMath(items)`.
// ---------------------------------------------------------------------------
import inpage from './inpage.cjs';
export const MATH_INPAGE = inpage.MATH_INPAGE;

// --------------------------------------------------------------- Node-side API
export const resolveAssets = core.resolveAssets;
export const open = core.open;
export const close = core.close;
export const typeset = core.typeset;
export const typesetBatch = core.typesetBatch;
export const renderInline = core.renderInline;
export const renderBlock = core.renderBlock;
export const mathjaxSvgStylesheet = core.mathjaxSvgStylesheet;
export const printStyleText = core.printStyleText;
export const MATH_TYPO_STROKE_RULE_CSS = core.TYPO_STROKE_RULE_CSS;
export const blockWrapper = core.blockWrapper;
export const typoraDisplayLines = core.typoraDisplayLines;
export const typoraAfterRender = core.typoraAfterRender;
export const DISPLAYLINES_ENVS = core.DISPLAYLINES_ENVS;

export default {
  MATHJAX_VERSION,
  MATH_ASSETS,
  MATH_CSS,
  MATH_INPAGE,
  MATH_PRINT_STYLE,
  MATH_BUNDLE,
  MATH_CONFIG_JS,
  open,
  close,
  typeset,
  typesetBatch,
  renderInline,
  renderBlock,
  blockWrapper,
  mathjaxSvgStylesheet,
  printStyleText,
  typoraDisplayLines,
  typoraAfterRender,
  DISPLAYLINES_ENVS,
};
