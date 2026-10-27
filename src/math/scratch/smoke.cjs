// scratch smoke test: boot MathJax exactly like Typora's window.html and dump one SVG
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('../../../node_modules/puppeteer-core');

const CHROME = 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1112\\chrome-win\\chrome.exe';
const BUNDLE = 'E:\\work\\reverse\\reverse-typora-export\\unpacked\\lib\\MathJax3\\es5\\tex-svg-full.js';

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'harness.html'), 'utf8')
    .replaceAll('__MATHJAX_BUNDLE_URL__', pathToFileURL(BUNDLE).href).replaceAll("typora-mathjax-config.js", pathToFileURL(path.join(__dirname,'..','typora-mathjax-config.js')).href);
  const harness = path.join(__dirname, 'harness.runtime.html');
  fs.writeFileSync(harness, src);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push('[console.' + m.type() + '] ' + m.text()));
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  page.on('requestfailed', (r) => logs.push('[reqfail] ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));
  await page.goto(pathToFileURL(harness).href, { waitUntil: 'load', timeout: 30000 });
  try {
    await page.waitForFunction('window.MathJax && MathJax.startup && MathJax.startup.document && !!MathJax.tex2svgPromise', { timeout: 30000 });
  } catch (e) {
    console.log('WAIT FAILED', e.message);
    console.log(logs.join('\n'));
    await browser.close();
    return;
  }
  const info = await page.evaluate(() => ({
    version: (window.MathJax.version || (MathJax._ && MathJax._.version) || 'unknown') + '',
    hasStylesheet: !!MathJax.svgStylesheet,
    fontCache: MathJax.startup.output.options.fontCache,
    enableAssistiveMml: MathJax.startup.document.options.enableAssistiveMml,
    outputJaxName: MathJax.startup.output.name,
    inputJaxName: MathJax.startup.document.inputJax[0].name,
  }));
  console.log('INFO', JSON.stringify(info));
  const out = await page.evaluate(async () => {
    const node = await MathJax.tex2svgPromise('E = mc^2', { display: false });
    return node.outerHTML;
  });
  console.log('LEN', out.length);
  console.log(out);
  console.log('LOGS:', logs.slice(0, 10).join('\n'));
  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
