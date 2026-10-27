// scratch/probe-attrs.cjs — what does the *pre-export* container look like (assistive-mml, title)?
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1112\\chrome-win\\chrome.exe';
const HERE = path.join(__dirname, '..');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
  });
  const p = await browser.newPage();
  const cfg = pathToFileURL(path.join(HERE, 'typora-mathjax-config.js')).href;
  const bun = pathToFileURL(path.join(HERE, 'vendor', 'tex-svg-full.js')).href;
  const harness = path.join(__dirname, 'stage1.harness.html');
  await p.goto(pathToFileURL(harness).href, { waitUntil: 'load' });
  await p.addScriptTag({ url: cfg });
  await p.addScriptTag({ url: bun });
  await p.waitForFunction('window.MathJax && MathJax.startup && MathJax.startup.document && !!MathJax.tex2svgPromise', { timeout: 45000 });

  const out = await p.evaluate(async () => {
    const MJ = window.MathJax;
    const anchor = document.querySelector('#write>p') || document.querySelector('#write');
    const metrics = MJ.getMetricsFor(anchor, true);
    const o = MJ.startup.output;
    const info = {
      texSvgOptions: JSON.parse(JSON.stringify(Object.fromEntries(
        Object.entries(o.options || {}).filter(([k, v]) => typeof v !== 'function' && typeof v !== 'object')
      ))),
      svgFontCache: MJ.svg?.options?.fontCache ?? (MJ.startup.output.options.fontCache),
      texDefaults: {
        enableAssistiveMml: MJ.config?.options?.enableAssistiveMml,
        internalSpeechTitles: MJ.config?.options?.internalSpeechTitles,
        menuOptions: MJ.config?.options?.enableMenu,
      },
    };
    o.options.localID = 1;
    const blk = await MJ.tex2svgPromise('\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', Object.assign({}, metrics, { display: true }));
    o.options.localID = 3;
    const inl = await MJ.tex2svgPromise('E = mc^2', { display: false });
    return {
      info,
      blockPre: blk.outerHTML.slice(0, 400),
      blockHasAssistive: !!blk.querySelector('mjx-assistive-mml'),
      blockAssistiveTag: blk.querySelector('mjx-assistive-mml')?.outerHTML.slice(0, 200) || null,
      blockTitles: [...blk.querySelectorAll('[title]')].length,
      inlinePre: inl.outerHTML.slice(0, 300),
      inlineHasAssistive: !!inl.querySelector('mjx-assistive-mml'),
      navTop: document.querySelectorAll('mjx-container').length,
      rectTag: (blk.querySelector('rect') || {}).outerHTML || null,
      mjxAttrs: [...blk.attributes].map((a) => a.name + '=' + JSON.stringify(a.value)),
      svgAttrs: [...blk.querySelector('svg').attributes].map((a) => a.name + '=' + JSON.stringify(a.value)),
    };
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
