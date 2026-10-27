// Is the 0.25pt origin shift caused by default-margin rounding? Compare the same
// document printed with (a) no margins param, (b) explicit zero margins.
import { launchBrowser, printHtmlString } from '../src/print.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const EXE = {
  '124': 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1112\\chrome-win\\chrome.exe',
  '153': 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
};
const html = `<html><head><meta charset="utf-8"><style>body{margin:0;font-family:Georgia,serif;font-size:14pt}</style></head><body><p>X</p></body></html>`;
const outDir = path.resolve('out/chroma/probe3');
await fs.mkdir(outDir, { recursive: true });

for (const [ver, exe] of Object.entries(EXE)) {
  const browser = await launchBrowser({ executablePath: exe });
  for (const [tag, opts] of [['default', {}], ['zero', { margins: { top: 0, bottom: 0, left: 0, right: 0 } }]]) {
    const pdf = await printHtmlString(browser, html, outDir, {
      settleMs: 80, paperWidth: 595.92 / 72, paperHeight: 842.88 / 72, ...opts,
    });
    await fs.writeFile(path.join(outDir, `m-${tag}-${ver}.pdf`), pdf);
  }
  await browser.close();
}
console.log('done');
