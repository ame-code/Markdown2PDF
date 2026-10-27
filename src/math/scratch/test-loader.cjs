// scratch test: does the vendor bundle initialise when injected by URL, with no sibling component dirs?
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer-core');

const CHROME = 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1112\\chrome-win\\chrome.exe';
const HERE = path.join(__dirname, '..');

(async () => {
  const stage1 = path.join(__dirname, 'stage1.harness.html');
  const cases = [
    ['vendor', path.join(HERE, 'vendor')],
    ['unpacked', 'E:\\work\\reverse\\reverse-typora-export\\unpacked\\lib\\MathJax3\\es5'],
  ];
  for (const [label, dir] of cases) {
    const browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
    });
    const p = await browser.newPage();
    const logs = [];
    p.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
    p.on('pageerror', (e) => logs.push('ERR ' + e.message));
    p.on('requestfailed', (r) => logs.push('REQFAIL ' + r.url()));
    await p.goto(pathToFileURL(stage1).href, { waitUntil: 'load' });
    await p.addScriptTag({ url: pathToFileURL(path.join(HERE, 'typora-mathjax-config.js')).href });
    await p.addScriptTag({ url: pathToFileURL(path.join(dir, 'tex-svg-full.js')).href });
    let ok = true;
    try {
      await p.waitForFunction(
        'window.MathJax&&MathJax.startup&&MathJax.startup.document&&!!MathJax.tex2svgPromise',
        { timeout: 20000 }
      );
    } catch (e) {
      ok = false;
    }
    console.log(label, 'ready=' + ok, 'logs=' + JSON.stringify(logs.slice(0, 6)));
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
