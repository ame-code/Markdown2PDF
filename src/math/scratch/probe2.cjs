// scratch probe: settle display flag + compare against artifact targets; dump stylesheet
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('../../../node_modules/puppeteer-core');

const CHROME = 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1112\\chrome-win\\chrome.exe';
const BUNDLE = 'E:\\work\\reverse\\reverse-typora-export\\unpacked\\lib\\MathJax3\\es5\\tex-svg-full.js';
const HERE = __dirname;
const SRC = path.join(HERE, '..');

function normalize(s) {
  // per-typeset ids: MJX-<n>-VARIANT-CODE  ->  MJX-<N>-VARIANT-CODE
  return s.replace(/MJX-\d+-/g, 'MJX-N-');
}
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return { i, a: a.slice(Math.max(0, i - 60), i + 60), b: b.slice(Math.max(0, i - 60), i + 60) };
  if (a.length !== b.length) return { i: n, a: '<<EOF>>', b: b.slice(n, n + 120) };
  return null;
}

(async () => {
  const harnessSrc = fs
    .readFileSync(path.join(SRC, 'harness.html'), 'utf8')
    .replaceAll('__MATHJAX_BUNDLE_URL__', pathToFileURL(BUNDLE).href)
    .replaceAll('typora-mathjax-config.js', pathToFileURL(path.join(SRC, 'typora-mathjax-config.js')).href);
  const harness = path.join(HERE, 'harness.runtime.html');
  fs.writeFileSync(harness, harnessSrc);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push('[' + m.type() + '] ' + m.text()));
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto(pathToFileURL(harness).href, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction('window.MathJax && MathJax.startup && MathJax.startup.document && !!MathJax.tex2svgPromise', { timeout: 30000 });

  const info = await page.evaluate(() => ({
    version: window.MathJax.version + '',
    fontCache: MathJax.startup.output.options.fontCache,
    localID: MathJax.startup.output.options.localID,
    assistive: MathJax.startup.document.options.enableAssistiveMml,
    speechTitles: MathJax.startup.output.options.internalSpeechTitles,
    output: MathJax.startup.output.name,
    input: MathJax.startup.document.inputJax[0].name,
    tags: MathJax.startup.document.inputJax[0].parseOptions.tags.config,
    scale: MathJax.startup.output.options.scale,
    mmlOptions: Object.keys(MathJax.startup.document.options || {}),
  }));
  console.log('INFO ' + JSON.stringify(info));

  const css = await page.evaluate(() => MathJax.svgStylesheet().innerHTML);
  fs.writeFileSync(path.join(HERE, 'mjx-svg-stylesheet.css'), css);
  console.log('CSS LEN ' + css.length);

  const texBlock = '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}';
  const texInline = 'E = mc^2';

  const out = await page.evaluate(async (texBlock, texInline) => {
    const metrics = () => MathJax.getMetricsFor(document.querySelector('#write>p') || document.querySelector('#write'), true);
    async function conv(tex, extra) {
      const node = await MathJax.tex2svgPromise(tex, Object.assign({}, metrics(), extra || {}));
      const mm = node.querySelector('mjx-assistive-mml');
      if (mm) mm.remove();
      return node.outerHTML;
    }
    const r = {};
    r.inline = await conv(texInline, {});
    r.blockA = await conv(texBlock, {});
    r.blockB = await conv(texBlock, { display: true });
    r.blockC = await conv(texBlock, { display: true, localID: 1 });
    r.inlineD = await conv(texInline, { localID: 3 });
    r.assistiveProbe = await (async () => {
      const n = await MathJax.tex2svgPromise(texInline, Object.assign({}, metrics(), {}));
      return n.outerHTML.slice(0, 400);
    })();
    return r;
  }, texBlock, texInline);

  const tInline = fs.readFileSync(path.join(HERE, 'inline-target.html'), 'utf8').trim();
  const tBlock = fs.readFileSync(path.join(HERE, 'block-target.html'), 'utf8').trim();
  // block target: extract the mjx-container part
  const mi = tBlock.indexOf('<mjx-container');
  const me = tBlock.indexOf('</mjx-container>') + '</mjx-container>'.length;
  const tBlockContainer = tBlock.slice(mi, me);

  const report = {
    inlineMatch: normalize(out.inline) === normalize(tInline),
    inlineWithID3Match: normalize(out.inlineD) === normalize(tInline),
    blockAMatch: normalize(out.blockA) === normalize(tBlockContainer),
    blockBMatch: normalize(out.blockB) === normalize(tBlockContainer),
    blockBExactIDs: out.blockB === tBlockContainer,
    blockCMatch_IDS1: normalize(out.blockC) === normalize(tBlockContainer),
    inlineDiff: firstDiff(normalize(out.inline), normalize(tInline)),
    blockADiff: firstDiff(normalize(out.blockA), normalize(tBlockContainer)),
    blockBDiff: firstDiff(normalize(out.blockB), normalize(tBlockContainer)),
    blockInArtifactExactID: out.blockC === tBlockContainer,
  };
  console.log('REPORT ' + JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(HERE, 'probe2.out.json'), JSON.stringify({ info, report, out, logs }, null, 2));
  console.log('LOGS ' + JSON.stringify(logs.slice(0, 8)));
  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
