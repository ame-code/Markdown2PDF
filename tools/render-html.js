// tools/render-html.js
// Render an arbitrary HTML file to PDF using the Typora-matched Chromium (124.0.6367.29)
// and the exact printToPDF option set recovered from Typora 1.9.5's frame.js.
//
// Usage:
//   node tools/render-html.js <input.html> <output.pdf> [--opt-set A|B|C|D]
//
// Option sets are probed against the golden PDF (see reports/stage1).
import path from 'node:path';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const CHROME_124 = 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1112\\chrome-win\\chrome.exe';

// Electron 30 (Chromium 124) page size for "A4", as measured in the real
// printToPDF IPC call (evidence/ipc-real-printtopdf-calls.json):
//   width 8.276666388888888 in, height -> 595.92 x 842.88 pt
// header/footer pass confirms: pageSize {width: pageWidthPt / 72, ...}
export const A4_IN = { width: 8.276666666666667, height: 11.706666666666667 };

export const OPTION_SETS = {
  // A: Electron paperSize A4 + marginsType 0 (kDefaultMargins) approximated by 0
  A: { ...A4_IN, margin: { top: 0, bottom: 0, left: 0, right: 0 } },
  // B: Chromium kDefaultMarginInches = 0.4in
  B: { ...A4_IN, margin: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 } },
  // C: 1cm
  C: { ...A4_IN, margin: { top: 0.393701, bottom: 0.393701, left: 0.393701, right: 0.393701 } },
  // D: Chromium built-in A4 preset (8.27 x 11.69) + 1cm
  D: { format: 'A4', margin: { top: 0.393701, bottom: 0.393701, left: 0.393701, right: 0.393701 } },
};

export async function renderHtmlToPdf(htmlPath, pdfPath, opts = {}) {
  const browser = await puppeteer.launch({
    executablePath: CHROME_124,
    headless: true,
    args: ['--allow-file-access-from-files', '--font-render-hinting=none'],
  });
  try {
    const page = await browser.newPage();
    // Typora sets these viewport-ish flags through its own window; for PDF the
    // layout that matters is the print media layout.
    await page.goto('file:///' + htmlPath.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.fonts && document.fonts.status === 'loaded', { timeout: 30000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, opts.settleMs ?? 1500));
    const printOptions = {
      printBackground: false,
      preferCSSPageSize: false,
      ...opts.printOptions,
    };
    await page.pdf({ path: pdfPath, ...printOptions });
    const info = await page.evaluate(() => ({
      htmlFontSize: getComputedStyle(document.documentElement).fontSize,
      bodyClass: document.body.className,
      writeClass: document.getElementById('write')?.className ?? null,
      writeRect: (() => { const r = document.getElementById('write')?.getBoundingClientRect(); return r ? { x: r.x, width: r.width } : null; })(),
      sheets: document.styleSheets.length,
      title: document.title,
    }));
    return { info, printOptions };
  } finally {
    await browser.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const [input, output, optSet = 'A'] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: node tools/render-html.js <input.html> <output.pdf> [A|B|C|D]');
    process.exit(2);
  }
  const printOptions = OPTION_SETS[optSet];
  if (!printOptions) throw new Error('unknown option set ' + optSet);
  const { info } = await renderHtmlToPdf(input, output, { printOptions });
  await fs.mkdir(path.dirname(output), { recursive: true });
  console.log(JSON.stringify({ output, optSet, printOptions, info }, null, 2));
}
