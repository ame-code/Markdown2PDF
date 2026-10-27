// scratch/lead-wire.cjs — reproduce the Lead's build.js wiring end-to-end:
// a static HTML page with <script src="file://..."> assets, MATH_INPAGE inlined as
// source, then a runner script that awaits window.md2pdfRenderMath(P.math).
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const puppeteer = require('puppeteer-core');

const HERE = path.join(__dirname, '..');
const CHROME = 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1112\\chrome-win\\chrome.exe';

const { MATH_INPAGE } = require(path.join(HERE, 'inpage.cjs'));

const F = (p) => pathToFileURL(p).href;

(async () => {
  const stage = path.join(__dirname, 'lead-wire.stage1.html');
  const payload = [
    { index: 0, kind: 'inline', tex: 'E = mc^2' },
    { index: 1, kind: 'block', tex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' },
  ];
  const html =
    '<!doctype html><html><head><meta charset="utf-8"></head><body>' +
    '<div id="write">' +
    '<p>inline <span data-mdpdf-math-inline="0"></span> done</p>' +
    '<div contenteditable="false" spellcheck="false" class="mathjax-block md-end-block md-math-block md-rawblock" id="mathjax-n27" cid="n27" mdtype="math_block" data-math-tag-before="0" data-math-tag-after="0" data-math-labels="[]" data-mdpdf-math-block="1"><div class="md-math-container"></div></div>' +
    '</div>' +
    '<script src="' + F(path.join(HERE, 'typora-mathjax-config.js')) + '"></script>' +
    '<script src="' + F(path.join(HERE, 'vendor', 'tex-svg-full.js')) + '"></script>' +
    '<script>' + MATH_INPAGE + '</script>' +
    '<script>' +
    'window.__payload=' + JSON.stringify(payload) + ';' +
    '(async()=>{try{window.__res=await window.md2pdfRenderMath(window.__payload);' +
    'window.__out=document.querySelector("#write").innerHTML;}catch(e){window.__err=String(e&&e.stack||e);}})();' +
    '</script>' +
    '</body></html>';
  fs.writeFileSync(stage, html);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  page.on('requestfailed', (r) => logs.push('reqfail: ' + r.url()));
  await page.goto(F(stage), { waitUntil: 'load' });
  await page.waitForFunction('window.__out||window.__err', { timeout: 60000 });
  const r = await page.evaluate(() => ({ out: window.__out, err: window.__err, res: window.__res }));
  await browser.close();

  if (r.err) {
    console.log('RENDER FAILED\n' + r.err);
    console.log('logs: ' + JSON.stringify(logs.slice(0, 8), null, 1));
    process.exit(1);
  }

  const out = r.out;
  const inline = out.slice(out.indexOf('<mjx-container'), out.indexOf('</script>') + 9);
  const blockStart = out.indexOf('<div contenteditable="false"');
  const block = out.slice(blockStart, out.indexOf('</div></div>', blockStart) + 12);

  const ref = fs.readFileSync(
    'E:\\work\\reverse\\reverse-typora-export\\evidence\\real-export-html-MATH.html',
    'utf8'
  );
  const refInlineStart = ref.indexOf('<mjx-container');
  const refInline = ref.slice(refInlineStart, ref.indexOf('</script>', refInlineStart) + 9);
  const bStart = ref.indexOf('<div contenteditable="false"');
  const refBlock = ref.slice(bStart, ref.indexOf('</div></div>', bStart) + 12);

  const norm = (s) => s.replace(/MJX-\d+-/g, 'MJX-N-');
  const eqInline = norm(inline) === norm(refInline);
  const eqBlock = norm(block) === norm(refBlock);
  const firstDiff = (a, b) => {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i + ': got ' + JSON.stringify(a.slice(i, i + 60)) + ' want ' + JSON.stringify(b.slice(i, i + 60));
    return a.length === b.length ? 'equal' : 'length ' + a.length + ' vs ' + b.length;
  };
  console.log('metrics: inline ' + (inline.match(/width="([^"]+)"/) || [])[1] + ' x ' + (inline.match(/height="([^"]+)"/) || [])[1] + ' viewBox ' + (inline.match(/viewBox="([^"]+)"/) || [])[1]);
  console.log('metrics: block  ' + (block.match(/width="([^"]+)"/) || [])[1] + ' x ' + (block.match(/height="([^"]+)"/) || [])[1] + ' viewBox ' + (block.match(/viewBox="([^"]+)"/) || [])[1]);
  console.log('PASS inline (ids normalised): ' + eqInline);
  console.log('PASS block  (ids normalised): ' + eqBlock);
  console.log('PASS block byte-identical incl. MJX-id counter: ' + (block === refBlock) + '  (got ids ' + [...block.matchAll(/id="MJX-(\d+)-/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).join(',') + ')');
  console.log('PASS inline byte-identical incl. MJX-id counter: ' + (inline === refInline) + '  (got id ' + (inline.match(/MJX-(\d+)-/) || [])[1] + ')');
  if (!eqInline) console.log('inline first diff -> ' + firstDiff(inline, refInline));
  if (!eqBlock) console.log('block first diff -> ' + firstDiff(block, refBlock));
  console.log('logs: ' + JSON.stringify(logs.slice(0, 4)));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
