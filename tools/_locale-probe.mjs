// Does the browser locale change CJK shaping/fallback (and thus pixels)?
// Renders the reference export HTML with several --lang values and saves each PDF.
import { launchBrowser } from '../src/print.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const EXE = 'E:\\work\\reverse\\markdown2pdf\\out\\chroma\\trim\\chrome-win\\chrome.exe';
const HTML = path.resolve('golden/typora-export-reference.html');
const outDir = path.resolve('out/chroma/locale');
await fs.mkdir(outDir, { recursive: true });

for (const lang of ['default', 'en-US', 'zh-CN', 'zh-TW', 'ja-JP']) {
  const args = ['--allow-file-access-from-files', '--font-render-hinting=none'];
  if (lang !== 'default') args.push(`--lang=${lang}`);
  const browser = await launchBrowser({ executablePath: EXE, args });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto('file:///' + HTML.replace(/\\/g, '/'), { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 400));
  const nav = await page.evaluate(() => ({
    navLang: navigator.language,
    langs: navigator.languages.slice(0, 3),
    date: new Date(2026, 0, 2).toLocaleDateString(),
    num: (1234567.891).toLocaleString(),
  }));
  const cdp = await page.createCDPSession();
  const { data } = await cdp.send('Page.printToPDF', {
    printBackground: false, preferCSSPageSize: false,
    paperWidth: 595.92 / 72, paperHeight: 842.88 / 72,
  });
  await fs.writeFile(path.join(outDir, `ref-${lang}.pdf`), Buffer.from(data, 'base64'));
  console.log(lang, JSON.stringify(nav));
  await browser.close();
}
