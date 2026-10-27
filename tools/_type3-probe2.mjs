// Narrow down why Chromium 153 emits Type3 for CJK in our document.
// Variants change only the font stack / weight, everything else identical.
import { launchBrowser, printHtmlString } from '../src/print.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const EXE = {
  '124': 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1112\\chrome-win\\chrome.exe',
  '153': 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1243\\chrome-win64\\chrome.exe',
};

const TEXT = '普通段落，包含中文与标点。';

const VARIANTS = {
  'yahei': '<style>body{font-family:"Microsoft YaHei",sans-serif;font-size:14pt}</style>',
  'yahei-bold': '<style>body{font-family:"Microsoft YaHei",sans-serif;font-size:14pt;font-weight:bold}</style>',
  'stack-emoji': '<style>body{font-family:"Segoe UI Emoji","Helvetica Neue",Arial,sans-serif;font-size:14pt}</style>',
  'stack-sans': '<style>body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:14pt}</style>',
  'theme-stack': '<style>body{font-family:"JetBrains Mono","Clear Sans","Helvetica Neue",Helvetica,Arial,\'Segoe UI Emoji\',sans-serif;font-size:14pt}</style>',
};

const outDir = path.resolve('out/chroma/probe2');
await fs.mkdir(outDir, { recursive: true });

for (const [ver, exe] of Object.entries(EXE)) {
  const browser = await launchBrowser({ executablePath: exe });
  for (const [name, style] of Object.entries(VARIANTS)) {
    const html = `<html><head><meta charset="utf-8">${style}</head><body><p>${TEXT}</p></body></html>`;
    const pdf = await printHtmlString(browser, html, outDir, { settleMs: 120, paperWidth: 595.92 / 72, paperHeight: 842.88 / 72 });
    await fs.writeFile(path.join(outDir, `${name}-${ver}.pdf`), pdf);
    console.log('wrote', `${name}-${ver}.pdf`, pdf.length);
  }
  await browser.close();
}
