// scratch probe3: exact byte equality + deterministic localID control
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('../../../node_modules/puppeteer-core');

const CHROME = 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1112\\chrome-win\\chrome.exe';
const BUNDLE = 'E:\\work\\reverse\\reverse-typora-export\\unpacked\\lib\\MathJax3\\es5\\tex-svg-full.js';
const HERE = __dirname;
const SRC = path.join(HERE, '..');

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return { i, a: a.slice(Math.max(0, i - 80), i + 80), b: b.slice(Math.max(0, i - 80), i + 80) };
  if (a.length !== b.length) return { i: n, a: '<EOF ' + a.length + '>', b: b.slice(n, n + 160) };
  return null;
}

(async () => {
  const harness = path.join(HERE, 'harness.runtime.html');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--font-render-hinting=none'] });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()));
  await page.goto(pathToFileURL(harness).href, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.MathJax && MathJax.startup && MathJax.startup.document && !!MathJax.tex2svgPromise', { timeout: 30000 });

  const res = await page.evaluate(async (texBlock, texInline) => {
    const out = {};
    const p = document.querySelector('#write>p');
    const mDisp = MathJax.getMetricsFor(p, true);
    const mInl = MathJax.getMetricsFor(p, false);
    out.metricsDisplay = JSON.parse(JSON.stringify(mDisp));
    out.metricsInline = JSON.parse(JSON.stringify(mInl));
    out.counterBefore = MathJax.startup.output.fontCache.nextID;
    const strip = (n) => { const mm = n.querySelector('mjx-assistive-mml'); if (mm) mm.remove(); return n.outerHTML; };

    // deterministic localID: output-jax option is read in typesetSVG()
    async function conv(tex, display, localID) {
      const o = MathJax.startup.output;
      const prev = o.options.localID;
      o.options.localID = localID;
      try {
        const node = await MathJax.tex2svgPromise(tex, display ? Object.assign({}, mDisp) : { display: false });
        return strip(node);
      } finally { o.options.localID = prev; }
    }
    out.inline_noMetrics = await conv(texInline, false, null);
    out.inline_metrics_inline = await conv(texInline, false, null);
    out.inline_metrics_displayObj_forcedFalse = await (async () => {
      const o = MathJax.startup.output; const prev = o.options.localID; o.options.localID = null;
      try { const n = await MathJax.tex2svgPromise(texInline, Object.assign({}, mDisp, { display: false })); return strip(n); } finally { o.options.localID = prev; }
    })();
    out.block_metricsDisplay = await conv(texBlock, true, null);
    out.block_localID1 = await conv(texBlock, true, 1);
    out.inline_localID3 = await conv(texInline, false, 3);
    out.counterAfter = MathJax.startup.output.fontCache.nextID;
    out.cssText = MathJax.svgStylesheet().innerHTML;
    return out;
  }, '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', 'E = mc^2');

  const tInline = fs.readFileSync(path.join(HERE, 'inline-target.html'), 'utf8').trim();
  const tBlockFull = fs.readFileSync(path.join(HERE, 'block-target.html'), 'utf8').trim();
  const mi = tBlockFull.indexOf('<mjx-container');
  const me = tBlockFull.indexOf('</mjx-container>') + '</mjx-container>'.length;
  const tBlock = tBlockFull.slice(mi, me);

  const cmp = (name, got, want) => {
    const d = firstDiff(got, want);
    console.log(name + ': ' + (d ? 'DIFF' : 'EXACT') + (d ? ' ' + JSON.stringify(d) : ''));
  };
  cmp('inline_noMetrics_vs_target', res.inline_noMetrics, tInline);
  cmp('inline_forcedFalse_vs_target', res.inline_metrics_displayObj_forcedFalse, tInline);
  cmp('inline_localID3_vs_target', res.inline_localID3, tInline);
  cmp('block_metricsDisplay_vs_target', res.block_metricsDisplay, tBlock);
  cmp('block_localID1_vs_target', res.block_localID1, tBlock);
  console.log('METRICS_DISPLAY ' + JSON.stringify(res.metricsDisplay));
  console.log('METRICS_INLINE ' + JSON.stringify(res.metricsInline));
  console.log('COUNTER ' + res.counterBefore + ' -> ' + res.counterAfter);
  console.log('CSS_EQ ' + (res.cssText.length ? 'len ' + res.cssText.length : 'none'));
  fs.writeFileSync(path.join(HERE, 'probe3.out.json'), JSON.stringify({ res, logs }, null, 2));
  fs.writeFileSync(path.join(HERE, 'my-inline.html'), res.inline_localID3 || res.inline_noMetrics);
  fs.writeFileSync(path.join(HERE, 'my-block.html'), res.block_localID1);
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
