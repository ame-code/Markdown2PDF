'use strict';
/**
 * core.cjs — CommonJS engine that reproduces Typora 1.9.5's math rendering.
 *
 * Pipeline (reverse-engineered from Typora 1.9.5):
 *   MathJax 3.2.2 `tex-svg-full` (vendored in lib.asar), config verbatim from
 *   D:\Typora\resources\window.html @25131..30703, then a TeX->SVG conversion
 *   per formula via `MathJax.tex2svgPromise`, then the two export fixups from
 *   D:\Typora\resources\appsrc\window\frame.js:
 *     - getSVGForExport()        @708156 : remove `mjx-assistive-mml` (print), keep container
 *     - processExportedSVG()     @688xxx-equivalent : white-space normalisation
 *
 * Run with Node >= 18 (tested v24). Uses puppeteer-core + any Chromium >= 110.
 *
 * NOTE on `<mjx-container>` ids: MathJax caches glyph paths per conversion when
 * `svg.fontCache === 'local'` (Typora's default) and names them
 * `MJX-<localID>-<variantCacheID>-<code>`, where localID is the per-page
 * typeset counter (`SVG.OPTIONS.localID`, null by default; incremented in
 * FontCache.useLocalID()).  Passing an explicit `localID` makes the ids
 * deterministic; otherwise they drift with render history exactly like in
 * Typora's live editor.
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const HERE = __dirname;

const DEFAULT_CHROME = 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1112\\chrome-win\\chrome.exe';
const VENDOR_BUNDLE = path.join(__dirname, 'vendor', 'tex-svg-full.js');
const UNPACKED_BUNDLE =
  'E:\\work\\reverse\\reverse-typora-export\\unpacked\\lib\\MathJax3\\es5\\tex-svg-full.js';
const DEFAULT_BUNDLE = fs.existsSync(VENDOR_BUNDLE) ? VENDOR_BUNDLE : UNPACKED_BUNDLE;

/** MathJax version shipped with Typora 1.9.5 (verified at runtime from `MathJax.version`). */
const MATHJAX_VERSION = '3.2.2';

/** Typora's print-export extra rule, appended after `MathJax.svgStylesheet().innerHTML`. */
const TYPO_STROKE_RULE_CSS =
  'mjx-container[jax="SVG"] path[data-c], mjx-container[jax="SVG"] use[data-c] {\n' +
  '\t\t\t\t\t\t\tstroke-width: 0;\n' +
  '\t\t\t\t\t\t}';

const TYPO_HTML_OVERFLOW_RULE = 'html {overflow-x: initial !important;}';

function resolveAssets(overrides) {
  const o = overrides || {};
  const chrome =
    o.chrome || process.env.MDPDF_CHROME || process.env.PUPPETEER_EXECUTABLE_PATH || DEFAULT_CHROME;
  const bundle = o.bundle || process.env.MDPDF_MATHJAX_BUNDLE || DEFAULT_BUNDLE;
  const config = o.config || path.join(HERE, 'typora-mathjax-config.js');
  const harness = o.harness || path.join(HERE, 'harness.html');
  for (const p of [chrome, bundle, config, harness]) {
    if (!fs.existsSync(p)) throw new Error('math: missing asset ' + p);
  }
  return { chrome, bundle, config, harness };
}

// ---------------------------------------------------------------- Typora extra
/**
 * Port of Typora's `displayLines` render action (frame.js @1173270-1173560).
 * Registered unless `File.option.noDisplayLinesInMath` (default false, frame.js
 * @569400).  A *display* formula containing a top-level `\\` or `\newline` is
 * not valid TeX, so Typora wraps it in `\displaylines{...}` unless the leading
 * construct already is an environment from its allow-list.
 *
 * NOTE: Typora's first branch compares `math[0]` against the 5-character literal
 * string `"\\u32E"` (frame.js @1173330), which can never match a single
 * character - a dead branch produced by minification.  We therefore do not
 * strip anything, matching observed behaviour.
 */
const DISPLAYLINES_ENVS = [
  'def', 'let', 'newenvironment', 'array', 'displaylines', 'enclose',
  'gather', 'gathered', 'leqalignno', 'multiline', 'split',
];

function typoraDisplayLines(tex, display) {
  if (!display || typeof tex !== 'string' || tex.length === 0) return tex;
  if (!/\\(\\|newline)/.test(tex)) return tex;
  const m = /^(?:\s|(?:\s*%[^\n]*\n))*\\([a-z]+)/i.exec(tex);
  if (m) {
    if (/(begin|command|matrix|align|eq)/.exec(m[1])) return tex;
    if (DISPLAYLINES_ENVS.indexOf(m[1]) !== -1) return tex;
  }
  return '\\displaylines{\n' + tex + '\n}';
}

const MJX_ID = /^mjx-/i;

/**
 * Port of the `afterRender` action Typora installs at priority 1001
 * (frame.js @1172565): every `[id]` inside the output `<svg>` that does not
 * start with `mjx-` is prefixed, `[class]` keeps only `mjx-*` tokens, and the
 * svg gets `alt` from the container's `aria-label` (only when it has one - the
 * print corpus has none).
 */
function typoraAfterRender(node) {
  const svg = node.querySelector ? node.querySelector('svg') : null;
  if (!svg) return node;
  svg.querySelectorAll('[id]').forEach((el) => {
    if (!MJX_ID.test(el.id)) el.id = 'mjx-' + el.id;
  });
  svg.querySelectorAll('[class]').forEach((el) => {
    el.setAttribute(
      'class',
      el.getAttribute('class').split(/\s+/).filter((c) => MJX_ID.test(c)).join(' ')
    );
  });
  if (svg.parentElement === node && node.hasAttribute('aria-label')) {
    svg.setAttribute('alt', node.getAttribute('aria-label'));
  }
  return node;
}

// ---------------------------------------------------------------- singleton
let state = null;

async function open(opts) {
  if (state) return state;
  const assets = resolveAssets(opts);
  const puppeteer = require('puppeteer-core');
  const browser = await puppeteer.launch({
    executablePath: assets.chrome,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--allow-file-access-from-files',
      '--font-render-hinting=none',
    ],
  });
  const page = await browser.newPage();
  const consoleLog = [];
  page.on('console', (m) => consoleLog.push('[' + m.type() + '] ' + m.text()));
  page.on('pageerror', (e) => consoleLog.push('[pageerror] ' + e.message));

  // Instantiate the harness from the static template so the page keeps a
  // file:// origin (needed to load the vendored MathJax bundle by file URL).
  const runtime = path.join(HERE, 'scratch', 'harness.runtime.html');
  fs.mkdirSync(path.dirname(runtime), { recursive: true });
  fs.writeFileSync(
    runtime,
    fs
      .readFileSync(assets.harness, 'utf8')
      .replaceAll('__MATHJAX_BUNDLE_URL__', pathToFileURL(assets.bundle).href)
      .replaceAll('typora-mathjax-config.js', pathToFileURL(assets.config).href)
  );
  await page.goto(pathToFileURL(runtime).href, { waitUntil: 'load', timeout: 45000 });
  await page.waitForFunction(
    'window.MathJax && MathJax.startup && MathJax.startup.document && !!MathJax.tex2svgPromise',
    { timeout: 45000 }
  );

  state = { browser, page, assets, consoleLog, runtimeHarness: runtime, css: null };
  return state;
}

async function close() {
  if (!state) return;
  const s = state;
  state = null;
  await s.browser.close();
  try {
    fs.unlinkSync(s.runtimeHarness);
  } catch (_) {
    /* best effort */
  }
}

// ------------------------------------------------------------------ convert
/**
 * Convert one TeX string to Typora's `<mjx-container>` markup.
 *
 * @param {string} tex            TeX source (already stripped of `$`/`$$` delimiters and \u200B)
 * @param {object} [opts]
 * @param {boolean} [opts.display=true]  block math -> true (container gets display="true")
 * @param {number|null} [opts.localID]   force the MathJax typeset counter used in `MJX-<n>-…` ids
 * @returns {Promise<string>}     `<mjx-container …>…</mjx-container>` (assistive-mml removed, as in print export)
 */
async function typeset(tex, opts) {
  const o = Object.assign({ display: true, localID: null }, opts || {});
  const s = await open(o);
  return s.page.evaluate(
    async (args) => {
      const MJ = window.MathJax;
      const typeset = MJ.tex2svgPromise.bind(MJ);
      const write = document.querySelector('#write');
      const anchor = document.querySelector('#write>p') || write;
      // typora block-math: metrics of the writing area, and MathJax's
      // `getMetricsFor(node, true)` marks the request as display math.
      const metrics = MJ.getMetricsFor(anchor, true);
      const out = MJ.startup.output;
      const prevLocalID = out.options.localID;
      if (args.localID !== null && args.localID !== undefined) out.options.localID = args.localID;
      try {
        const node = args.display
          ? await typeset(args.tex, Object.assign({}, metrics, { display: true }))
          : await typeset(args.tex, { display: false });
        // getSVGForExport(node, inlineCopy=false, forPrint) removes the a11y
        // shadow tree but keeps the container's style="position: relative;".
        const assistive = node.querySelector('mjx-assistive-mml');
        if (assistive) assistive.remove();
        // Typora's afterRender action (priority 1001, frame.js @1172565).
        const svg = node.querySelector('svg');
        if (svg) {
          svg.querySelectorAll('[id]').forEach((el) => {
            if (!/^mjx-/i.test(el.id)) el.id = 'mjx-' + el.id;
          });
          svg.querySelectorAll('[class]').forEach((el) => {
            el.setAttribute(
              'class',
              el.getAttribute('class').split(/\s+/).filter((c) => /^mjx-/i.test(c)).join(' ')
            );
          });
          if (svg.parentElement === node && node.hasAttribute('aria-label')) {
            svg.setAttribute('alt', node.getAttribute('aria-label'));
          }
        }
        return node.outerHTML;
      } finally {
        out.options.localID = prevLocalID;
      }
    },
    {
      tex: o.display !== false ? typoraDisplayLines(tex, true) : tex,
      display: o.display !== false,
      localID: o.localID === undefined ? null : o.localID,
    }
  );
}
/** Batch form: [{tex, display, localID}] -> [markup] (one page, one browser). */
async function typesetBatch(items, opts) {
  const s = await open(opts);
  const results = [];
  for (const item of items) {
    results.push(await typeset(item.tex, Object.assign({}, opts, item)));
  }
  return results;
}

// --------------------------------------------------------------- Typora DOM
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Inline math wrapper: bare `<mjx-container>` followed by the raw-TeX
 * `<script type="math/tex">` (artifact lines for `$E = mc^2$`).
 */
async function renderInline(tex, opts) {
  const container = await typeset(tex, Object.assign({ display: false }, opts || {}));
  return container + '<script type="math/tex">' + escapeHtml(tex) + '</script>';
}

/**
 * Block math: Typora's `mathjax-block` wrapper around `.md-math-container`
 * (attributes copied verbatim from the real export for `$$…$$`).
 *
 * @param {string} tex
 * @param {string|object} [node]  node id ("n27") or `{id:'n27'}`; default 'n1'
 */
async function renderBlock(tex, node, opts) {
  const container = await typeset(tex, Object.assign({ display: true }, opts || {}));
  return blockWrapper(node) + container + '</div></div>';
}

const BLOCK_ATTRS =
  'contenteditable="false" spellcheck="false" ' +
  'class="mathjax-block md-end-block md-math-block md-rawblock" ';

function blockWrapper(node) {
  const raw = typeof node === 'object' && node ? node.id : node;
  const id = raw == null ? 'n1' : String(raw);
  const cid = id.replace(/^mathjax-/, '');
  return (
    '<div ' +
    BLOCK_ATTRS +
    'id="mathjax-' +
    cid +
    '" cid="' +
    cid +
    '" mdtype="math_block" ' +
    'data-math-tag-before="0" data-math-tag-after="0" data-math-labels="[]">' +
    '<div class="md-math-container">'
  );
}

/** `MathJax.svgStylesheet().innerHTML` — the exact CSS Typora injects. */
async function mathjaxSvgStylesheet(opts) {
  const s = await open(opts);
  if (s.css == null) s.css = await s.page.evaluate(() => MathJax.svgStylesheet().innerHTML);
  return s.css;
}

/** Full `<style>` content Typora writes for print: html rule + MathJax CSS + stroke rule. */
async function printStyleText(opts) {
  return TYPO_HTML_OVERFLOW_RULE + (await mathjaxSvgStylesheet(opts)) + TYPO_STROKE_RULE_CSS;
}

module.exports = {
  MATHJAX_VERSION,
  TYPO_STROKE_RULE_CSS,
  TYPO_HTML_OVERFLOW_RULE,
  DISPLAYLINES_ENVS,
  typoraDisplayLines,
  typoraAfterRender,
  resolveAssets,
  open,
  close,
  typeset,
  typesetBatch,
  renderInline,
  renderBlock,
  blockWrapper,
  escapeHtml,
  mathjaxSvgStylesheet,
  printStyleText,
  /** last page console log (diagnostics) */
  get consoleLog() {
    return state ? state.consoleLog : [];
  },
};
