/**
 * src/math/verify.js — rerunnable byte-parity check for Typora 1.9.5 math export.
 *
 *   node src/math/verify.js            (from the repo root, or anywhere)
 *
 * What it proves:
 *   1. the two corpus formulas from the reference print export are reproduced
 *      BYTE-FOR-BYTE (block wrapper div + mjx-container; inline mjx-container +
 *      <script type="math/tex">), once the per-typeset `MJX-<n>-` prefix is
 *      pinned via the documented `localID` option;
 *   2. MATH_CSS plus Typora's print stroke rule are byte-identical to the
 *      `<style>` payload in that export;
 *   3. the in-page renderer (`MATH_INPAGE` + `MATH_ASSETS`) produces the same
 *      bytes as the Node API — this is the pipeline integration path;
 *   4. three extra formulas typeset without errors, deterministically;
 *   5. Typora's `\displaylines` preprocessing matches frame.js @1173270.
 *
 * Exit code 0 = all checks pass.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import core from './core.cjs';
import {
  MATH_ASSETS,
  MATH_CSS,
  MATH_INPAGE,
  MATH_PRINT_STYLE,
  MATHJAX_VERSION,
  renderBlock,
  renderInline,
  close,
} from './index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE = 'E:\\work\\reverse\\reverse-typora-export\\evidence\\real-export-html-MATH.html';
const INLINE_TEX = 'E = mc^2';
const BLOCK_TEX = '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}';

let failures = 0;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail && !ok ? '\n      ' + detail : ''));
}
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return 'first diff @' + i + ': got ' + JSON.stringify(a.slice(Math.max(0, i - 50), i + 70)) + ' want ' + JSON.stringify(b.slice(Math.max(0, i - 50), i + 70));
  }
  if (a.length !== b.length) return 'length ' + a.length + ' vs ' + b.length + ' (first difference at EOF)';
  return null;
}

// ---------------------------------------------------------------------------
// Extract the two math constructs straight out of the reference export.
// ---------------------------------------------------------------------------
function extractReference(html) {
  // Document order: inline math comes first, the $$…$$ block later.
  const inlineStart = html.indexOf('<mjx-container');
  const inlineEnd = html.indexOf('</mjx-container>', inlineStart) + '</mjx-container>'.length;
  const scriptEnd = html.indexOf('</script>', inlineEnd) + '</script>'.length;
  const inline = html.slice(inlineStart, scriptEnd);

  const blockStart = html.indexOf('<div contenteditable="false" spellcheck="false" class="mathjax-block');
  const blockContainerEnd = html.indexOf('</mjx-container>', blockStart) + '</mjx-container>'.length;
  const blockEnd = html.indexOf('</div></div>', blockContainerEnd) + '</div></div>'.length;
  const block = html.slice(blockStart, blockEnd);
  return { inline, block };
}

(async () => {
  const html = fs.readFileSync(REFERENCE, 'utf8');
  const ref = extractReference(html);
  const refInlineContainer = ref.inline.slice(0, ref.inline.indexOf('</mjx-container>') + '</mjx-container>'.length);
  const refBlockContainer = (() => {
    const s = ref.block.indexOf('<mjx-container');
    return ref.block.slice(s, ref.block.indexOf('</mjx-container>') + '</mjx-container>'.length);
  })();

  console.log('== environment ==');
  const assets = core.resolveAssets({});
  console.log('chrome : ' + assets.chrome);
  console.log('bundle : ' + assets.bundle);
  console.log('config : ' + assets.config);
  console.log('mathjax: ' + MATHJAX_VERSION);
  console.log('');

  // ------------------------------------------------------------- Node API path
  // Reference ids: block math got MJX-1-, inline math MJX-3- (Typora's global
  // per-page typeset counter at the time of the export). Pin them.
  const inline = await renderInline(INLINE_TEX, { localID: 3 });
  const block = await renderBlock(BLOCK_TEX, 'n27', { localID: 1 });

  check('inline math: <mjx-container> byte-identical to reference', inline === ref.inline, firstDiff(inline, ref.inline));
  check('block math: mathjax-block wrapper byte-identical to reference', block === ref.block, firstDiff(block, ref.block));

  // container-only comparisons (independent of the wrappers)
  const myInlineContainer = inline.slice(0, inline.indexOf('</mjx-container>') + '</mjx-container>'.length);
  const myBlockContainer = block.slice(block.indexOf('<mjx-container'), block.indexOf('</mjx-container>') + '</mjx-container>'.length);
  check('inline mjx-container only', myInlineContainer === refInlineContainer, firstDiff(myInlineContainer, refInlineContainer));
  check('block mjx-container only', myBlockContainer === refBlockContainer, firstDiff(myBlockContainer, refBlockContainer));

  // id drift without pinning (documents the counter behaviour)
  const drifted = await renderInline(INLINE_TEX, { localID: null });
  const driftId = /MJX-(\d+)-/.exec(drifted)?.[1];
  check('unpinned ids drift with the typeset counter (expected)', driftId !== '3', 'got MJX-' + driftId + '-');

  // ------------------------------------------------------------------- CSS
  const css = await core.mathjaxSvgStylesheet();
  check('MATH_CSS === MathJax.svgStylesheet().innerHTML', css === MATH_CSS, 'len ' + css.length + ' vs ' + MATH_CSS.length);
  check('html rule + MATH_CSS + stroke rule appear byte-identically in reference', html.includes(MATH_PRINT_STYLE), 'styleLen ' + MATH_PRINT_STYLE.length);

  // --------------------------------------------------- in-page pipeline path
  const s = await core.open();
  const stage1 = [
    '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="write"><p>x</p>',
    '<span data-mdpdf-math-inline="0"></span>',
    '<div contenteditable="false" spellcheck="false" class="mathjax-block md-end-block md-math-block md-rawblock"',
    ' id="mathjax-n27" cid="n27" mdtype="math_block" data-math-tag-before="0" data-math-tag-after="0"',
    ' data-math-labels="[]" data-mdpdf-math-block="1"><div class="md-math-container"></div></div>',
    '</div></body></html>',
  ].join('');
  const harness = path.join(HERE, 'scratch', 'stage1.harness.html');
  fs.writeFileSync(harness, stage1);

  const page2 = await s.browser.newPage();
  const errs = [];
  page2.on('pageerror', (e) => errs.push(String(e.message)));
  await page2.goto('file:///' + harness.replace(/\\/g, '/'), { waitUntil: 'load' });
  const loaded = [];
  for (const asset of MATH_ASSETS) {
    // Inject by URL (not `path:`): an inlined 2.2 MB bundle has no script src, so
    // MathJax's loader cannot resolve `input/tex/extensions/xypic.js` and startup hangs.
    loaded.push(asset);
    await page2.addScriptTag({ url: pathToFileURL(asset).href });
  }
  await page2.waitForFunction('window.MathJax && MathJax.startup && MathJax.startup.document && !!MathJax.tex2svgPromise', { timeout: 45000 });
  await page2.evaluate(MATH_INPAGE);
  const pageOut = await page2.evaluate(
    async (items) => {
      await window.md2pdfRenderMath(items);
      return document.querySelector('#write').innerHTML;
    },
    [
      { index: 0, kind: 'inline', tex: INLINE_TEX, localID: 3 },
      { index: 1, kind: 'block', tex: BLOCK_TEX, localID: 1 },
    ]
  );
  const pageInline = pageOut.slice(pageOut.indexOf('<mjx-container'), pageOut.indexOf('<script type="math/tex"') + '<script type="math/tex">'.length + INLINE_TEX.length + '</script>'.length);
  const pageBlockStart = pageOut.indexOf('<div contenteditable="false"');
  const pageBlock = pageOut.slice(pageBlockStart).trim();
  check('in-page MATH_INPAGE: inline matches reference', pageInline === ref.inline, firstDiff(pageInline, ref.inline));
  check('in-page MATH_INPAGE: block matches reference', pageBlock === ref.block, firstDiff(pageBlock, ref.block));
  check('in-page MATH_INPAGE: no page errors', errs.length === 0, errs.join(' | '));
  await page2.close();

  // ----------------------------------------------------------- extra formulas
  const extras = [
    { name: '\\frac{a}{b}', tex: '\\frac{a}{b}', kind: 'block', marks: ['data-mml-node="mfrac"'] },
    { name: '\\sqrt{x^2+y^2}', tex: '\\sqrt{x^2+y^2}', kind: 'block', marks: ['data-mml-node="msqrt"'] },
    {
      name: '\\begin{aligned}a&=b\\\\c&=d\\end{aligned}',
      tex: '\\begin{aligned}a&=b\\\\c&=d\\end{aligned}',
      kind: 'block',
      marks: ['data-mml-node="mtable"'],
    },
  ];
  let idSeq = 11;
  for (const f of extras) {
    const a = await core.typeset(f.tex, { display: f.kind === 'block', localID: idSeq++ });
    const b = await core.typeset(f.tex, { display: f.kind === 'block', localID: idSeq - 1 });
    const okShape =
      a.startsWith('<mjx-container class="MathJax" jax="SVG"') &&
      (f.kind === 'block' ? a.includes('display="true"') : !a.includes('display="true"')) &&
      !a.includes('mjx-assistive-mml') &&
      !a.includes('data-mml-node="merror"') &&
      a.includes('<svg ') &&
      f.marks.every((m) => a.includes(m));
    check('extra ' + f.name + ': well-formed, no merror, deterministic', okShape && a === b, okShape ? 'non-deterministic output' : 'shape check failed');
  }

  // -------------------------------------------------- \displaylines transform
  const page3 = await s.browser.newPage();
  await page3.goto('file:///' + harness.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page3.evaluate(MATH_INPAGE);
  const dlCases = await page3.evaluate(() => ({
    multiline: window.md2pdfTyporaDisplayLines('a\\\\b', true),
    aligned: window.md2pdfTyporaDisplayLines('\\begin{aligned}a&=b\\\\c&=d\\end{aligned}', true),
    inlineNoop: window.md2pdfTyporaDisplayLines('a\\\\b', false),
    singleLine: window.md2pdfTyporaDisplayLines('a+b', true),
  }));
  check('displayLines: multi-line display math wrapped', dlCases.multiline === '\\displaylines{\na\\\\b\n}', JSON.stringify(dlCases.multiline));
  check('displayLines: \\begin{aligned} untouched', dlCases.aligned === '\\begin{aligned}a&=b\\\\c&=d\\end{aligned}', JSON.stringify(dlCases.aligned));
  check('displayLines: inline math untouched', dlCases.inlineNoop === 'a\\\\b', JSON.stringify(dlCases.inlineNoop));
  check('displayLines: single-line display math untouched', dlCases.singleLine === 'a+b', JSON.stringify(dlCases.singleLine));
  await page3.close();

  await close();

  console.log('');
  const passed = results.filter((r) => r.ok).length;
  console.log('SUMMARY ' + passed + '/' + results.length + ' checks passed');
  process.exit(failures ? 1 : 0);
})().catch(async (e) => {
  console.error('verify: FAILED', e);
  try {
    await close();
  } catch (_) {}
  process.exit(1);
});
