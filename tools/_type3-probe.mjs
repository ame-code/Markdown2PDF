// Controlled probe: does Chromium 153 emit Type3 for CJK regardless of content?
// Renders two tiny documents (CJK-only, Latin-only) with each engine and reports
// the fonts embedded in the resulting PDF.
import { launchBrowser, printHtmlString } from '../src/print.js';
import * as pp from 'puppeteer-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const ENGINES = {
  '124': 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1112\\chrome-win\\chrome.exe',
  '153': 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
};

const DOCS = {
  cjk: `<html><head><meta charset="utf-8"><style>body{font-family:"Microsoft YaHei",sans-serif;font-size:14pt}</style></head><body><p>鏅€氭钀斤紝鍖呭惈涓枃涓庢爣鐐广€傜浜岃涓枃娴嬭瘯銆?/p></body></html>`,
  latin: `<html><head><meta charset="utf-8"><style>body{font-family:Georgia,serif;font-size:14pt}</style></head><body><p>Plain latin paragraph, nothing else.</p></body></html>`,
};

const outDir = path.resolve('out/chroma/probe');
await fs.mkdir(outDir, { recursive: true });

for (const [ver, exe] of Object.entries(ENGINES)) {
  const browser = await launchBrowser({ executablePath: exe });
  for (const [name, html] of Object.entries(DOCS)) {
    const pdf = await printHtmlString(browser, html, outDir, { settleMs: 120, paperWidth: 595.92 / 72, paperHeight: 842.88 / 72 });
    const file = path.join(outDir, `${name}-${ver}.pdf`);
    await fs.writeFile(file, pdf);
    const page = await browser.newPage();
    await page.goto('about:blank');
    const buf = await pdf;
    console.log(ver, name, 'bytes', buf.length, '->', file);
    await page.close();
  }
  await browser.close();
}
