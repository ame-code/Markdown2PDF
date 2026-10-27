/*
 * Typora 1.9.5 fenced-code-block renderer (standalone, no Typora process).
 * ==========================================================================
 * Given (code, lang) this module reproduces the exact read-only CodeMirror 5
 * DOM that Typora 1.9.5 emits inside
 *
 *   <pre class="md-fences md-end-block ty-contain-cm modeLoaded"
 *        spellcheck="false" lang="cpp">…</pre>
 *
 * It does so by replaying Typora's own algorithm with Typora's own vendored
 * CodeMirror 5.26.0 core and mode bundle (extracted from the installed app,
 * see assets/manifest.json) inside headless Chromium, then running Typora's
 * export DOM surgery on the result.
 *
 * The module is ESM (the surrounding package is "type":"module").  The
 * browser-side work lives in ./inpage.js as a string so a pipeline can inject
 * it into a page it has already loaded, instead of paying for a second page
 * load per document.
 *
 *   import { FENCE_ASSETS, FENCE_SCRIPTS, FENCE_INPAGE,
 *            mountFenceAssets, renderFence, renderFences } from './fence/index.js';
 *
 *   await renderFence('int main() {}', 'cpp')      // -> '<pre class="md-fences …</pre>'
 *   await renderFences([{code, lang}, …])          // -> ['<pre …>', …]  (one browser)
 *
 * Evidence for every step is in ../../../evidence/fence-spec.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FENCE_INPAGE } from './inpage.js';

export { FENCE_INPAGE };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, 'assets');
const asset = (rel) => path.join(ASSETS, rel);
const STYLE_DIR = path.join(HERE, '..', '..', 'vendor', 'style');
const DOC_CSS = path.join(STYLE_DIR, 'doc.css');
const CODE_CSS = path.join(STYLE_DIR, 'code.css');
const THEME_CSS = path.join(HERE, '..', '..', 'vendor', 'themes', 'my.css');

/** CSS files, in Typora's own cascade order. */
export const FENCE_STYLES = [
  // Both sheets are our own regenerated ones (vendor/style/). The shipped
  // package must not carry Typora's proprietary base.css / codemirror.css /
  // base-control.css, so nothing here points into the Typora install.
  DOC_CSS,   // skeleton + typography + print rules (was Typora's base.css)
  CODE_CSS,  // CodeMirror skin + the "no scrollbar when printing" rule
  THEME_CSS, // the user's own theme (my.css) supplies the metrics
];

/** Scripts that must run before FENCE_INPAGE, in this order. */
export const FENCE_SCRIPTS = [
  asset('cm/typora-globals.js'),  // host globals Typora's patched CM reads
  asset('cm/codemirror5.js'),     // CodeMirror 5.26.0 core  -> window.CodeMirror
  asset('cm/mode.min.js'),        // all language modes (Typora's bundle)
  asset('cm/active-line.js'),     // styleActiveLine -> .CodeMirror-activeline
  asset('cm/tw-lang-mode.js'),    // window.__typoraModeAlias (Typora's lang table)
];

/** Every file a host page needs: styles + scripts. */
export const FENCE_ASSETS = [...FENCE_STYLES, ...FENCE_SCRIPTS];

/**
 * The `<head>` payload, pre-assembled.
 *
 * Returns { styles, css, links, inline }.  `css` is the same text `links`
 * would load and can be dropped into a single <style> block — the four files
 * hold 18 KB of plain CSS with no url()/@import/@font-face, so inlining is
 * safe and saves three requests (verified: rendering uses the inline form).
 *
 * Beyond Typora's own base.css + codemirror.css this adds:
 *   - user-theme-metrics.css : the html{font-size}/body{line-height} of the
 *     theme in use.  Without it the fence geometry differs (line box 23.04 vs
 *     18.0 px) because Typora's default 14px/1.42857 differs from the theme.
 *     A host that already inlines the real theme file can pass
 *     { includeThemeMetrics: false }.
 *   - typora-base-control-subset.css : one rule
 *     (.cm-s-inner .CodeMirror-vscrollbar{display:none!important}) that the
 *     export page loads from base-control.css.  No geometric effect, kept for
 *     completeness.
 */
export function mountFenceAssets(options = {}) {
  const { includeThemeMetrics = false, includeBaseControl = false } = options;
  const styles = FENCE_STYLES.filter((p) => {
    if (!includeThemeMetrics && p.endsWith('user-theme-metrics.css')) return false;
    if (!includeBaseControl && p.endsWith('typora-base-control-subset.css')) return false;
    return true;
  });
  const css = styles
    .map((p) => `/* ${path.basename(p)} */\n` + fs.readFileSync(p, 'utf8'))
    .join('\n');
  return {
    styles,
    css,
    inline: css,
    links: styles.map((p) => `<link rel="stylesheet" href="${p.replace(/\\/g, '/')}">`).join('\n'),
  };
}

/** Chromium candidates, first existing wins; FENCE_CHROMIUM overrides. */
export const CHROMIUM_CANDIDATES = [
  process.env.FENCE_CHROMIUM,
  'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1112\\chrome-win\\chrome.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function resolveChromium(explicit) {
  const list = explicit ? [explicit, ...CHROMIUM_CANDIDATES] : CHROMIUM_CANDIDATES;
  for (const p of list) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error(
    'fence renderer: no Chromium/Chrome executable found. Set FENCE_CHROMIUM to an absolute path. Tried:\n  ' +
      list.join('\n  ')
  );
}

const DEFAULT_OPTIONS = {
  // File.option defaults of a stock Typora 1.9.5 (frame.js @568167).
  codeIndentSize: 4,
  noLineWrapping: false,
  noPairingMatch: false,
  showLineNumbersForFence: false,
  lineWiseCopyCut: false,
  // driver-only knobs
  width: 1000,
  height: 1400,
  deviceScaleFactor: 1,
  // Chromium layout grid in physical 1/64 px.  Typora ran this export on a
  // Windows 125% display, which is what produces the reference's
  // `top: 9.51875px` (line box 23.0375px instead of 23.046875px at 100%).
  // Override with displayScale:1 if the target export used 100% scaling.
  displayScale: 1.25,
  chromium: undefined,
  keepOpen: false,
};

/** The stage-1 shell the pipeline also uses: body/id/class exactly as the export. */
function stageShell(css) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head>` +
    `<body class="typora-export typora-print os-windows">` +
    `<div class="typora-export-content"><div id="write" style="top:auto" class="is-node"></div></div>` +
    `</body></html>`;
}

/**
 * Render many fences with a single browser launch.
 * @param {Array<{code:string,lang?:string,lineNumbers?:boolean,firstLineNumber?:number}>} items
 * @param {object} [options] see DEFAULT_OPTIONS / inpage.js
 * @returns {Promise<string[]>} `<pre>` outerHTML per item, same order
 */
export async function renderFences(items, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  const puppeteer = (await import('puppeteer-core')).default;
  const executablePath = resolveChromium(opts.chromium);
  const args = ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none'];
  if (opts.displayScale && opts.displayScale !== 1) {
    args.push(`--force-device-scale-factor=${opts.displayScale}`);
  }
  const browser = await puppeteer.launch({ executablePath, headless: 'new', args });
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: opts.deviceScaleFactor,
    });
    await page.setContent(stageShell(mountFenceAssets(opts).css), { waitUntil: 'load' });
    await page.evaluate(() => document.fonts && document.fonts.ready);

    for (const file of FENCE_SCRIPTS) {
      await page.addScriptTag({ content: fs.readFileSync(file, 'utf8') });
    }
    await page.addScriptTag({ content: FENCE_INPAGE });

    const hooks = {
      codeIndentSize: opts.codeIndentSize,
      noLineWrapping: opts.noLineWrapping,
      noPairingMatch: opts.noPairingMatch,
      showLineNumbersForFence: opts.showLineNumbersForFence,
      lineWiseCopyCut: opts.lineWiseCopyCut,
    };
    const payload = list.map((it, i) => ({
      index: i,
      code: it.code == null ? '' : String(it.code),
      lang: it.lang == null ? '' : String(it.lang),
      lineNumbers: !!it.lineNumbers,
      firstLineNumber: it.firstLineNumber,
    }));

    // Placeholders are created here exactly as src/template.js emits them.
    await page.evaluate((items) => {
      const host = document.getElementById('write');
      items.forEach((it) => {
        const pre = document.createElement('pre');
        pre.className = 'md-fences md-end-block ty-contain-cm';
        pre.setAttribute('spellcheck', 'false');
        if (it.lang) pre.setAttribute('lang', it.lang);
        pre.setAttribute('data-mdpdf-fence', String(it.index));
        host.appendChild(pre);
      });
    }, payload);

    const results = await page.evaluate(
      (items, o) => window.md2pdfRenderFences(items, o),
      payload,
      hooks
    );

    const bad = results.find((r) => r && r.error);
    if (bad) throw new Error('fence renderer: ' + bad.error);
    return results.map((r) => r.html);
  } finally {
    if (!opts.keepOpen) await browser.close();
  }
}

/** @returns {Promise<string>} `<pre>` outerHTML for one fence. */
export async function renderFence(code, lang, options = {}) {
  const [html] = await renderFences([{ code, lang }], options);
  return html;
}

export default { renderFence, renderFences, mountFenceAssets, FENCE_ASSETS, FENCE_SCRIPTS, FENCE_STYLES, FENCE_INPAGE };
