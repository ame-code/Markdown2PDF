// src/print.js
// The print engine: Chromium 124 + the exact Page.printToPDF parameters that
// Electron 30 (Typora 1.9.5) ends up sending.
//
// VERIFIED (reports/02-engine.md): raw CDP with
//   { printBackground:false, preferCSSPageSize:false,
//     paperWidth: 595.92/72, paperHeight: 842.88/72 }
// reproduces the golden Typora PDF with 0.0000% body pixel difference.
// Puppeteer's high level page.pdf() is NOT used: it mangles paper size/margins
// (a 28pt offset appears) and drops the values we need.
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { PAPER } from './paper.js';

export { PAPER };

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(HERE, '..');

/**
 * Where Chromium 124 lives, in lookup order:
 *   1. MDPDF_CHROME (explicit override, also used by --chrome)
 *   2. runtime/chromium-124/chrome.exe inside this checkout — the trimmed copy
 *      that `npm run bootstrap` downloads, so a fresh clone needs no manual step
 *   3. the author's Playwright cache (kept so the dev machine keeps working)
 *   4. whatever `chrome` resolves to on PATH
 * The engine matters: Chromium 153 changes print-margin rounding *and* emits
 * CJK fallback glyphs as Type3 procedures, so pixels stop matching Typora.
 */
function resolveChrome() {
  if (process.env.MDPDF_CHROME) return process.env.MDPDF_CHROME;
  const local = path.join(PROJECT_ROOT, 'runtime', 'chromium-124', 'chrome.exe');
  if (existsSync(local)) return local;
  const playwright = path.join(
    process.env.LOCALAPPDATA || '',
    'ms-playwright',
    'chromium-1112',
    'chrome-win',
    'chrome.exe',
  );
  if (existsSync(playwright)) return playwright;
  return 'chrome.exe';
}

export const DEFAULT_CHROME = resolveChrome();

export async function launchBrowser({ executablePath = DEFAULT_CHROME, args = [] } = {}) {
  return puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--allow-file-access-from-files', '--font-render-hinting=none', ...args],
  });
}

export function fileUrl(p) {
  return 'file:///' + path.resolve(p).replace(/\\/g, '/');
}

/**
 * Load a local HTML file, wait for fonts/images/layout, run an optional
 * in-page step, and return the live Page (caller must close it).
 */
export async function loadHtmlPage(browser, htmlPath, opts = {}) {
  const { settleMs = 250, blockNetwork = true, beforeSettle } = opts;
  const page = await browser.newPage();
  if (blockNetwork) {
    // Determinism: Typora's export HTML links Google Fonts and asar resources
    // that are irrelevant to layout; never let them stall or change a run.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) return req.continue();
      return req.abort();
    });
  }
  await page.goto(fileUrl(htmlPath), { waitUntil: 'load', timeout: 120000 });
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  });
  if (beforeSettle) await beforeSettle(page);
  await page.evaluate(async () => {
    await Promise.all(
      Array.from(document.images)
        .filter((img) => !img.complete)
        .map((img) => new Promise((res) => { img.onload = img.onerror = res; img.decode?.().catch(() => {}).finally(res); })),
    );
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
  return page;
}

/** Print an already-loaded page through raw CDP with Typora's parameters. */
export async function printPage(page, opts = {}) {
  const { paper = 'custom', paperWidth, paperHeight, printBackground = false, margins } = opts;
  const size = paper === 'custom' ? { width: paperWidth, height: paperHeight } : PAPER[paper];
  if (!size || !size.width || !size.height) throw new Error(`unsupported paper: ${paper}`);
  const params = {
    printBackground,
    preferCSSPageSize: false,
    paperWidth: size.width,
    paperHeight: size.height,
  };
  // Electron marginsType:1 with explicit margins => CDP margin* in inches.
  // Typora's header/footer band pass uses all-zero margins; the content pass
  // passes NO margins at all (Chromium's default 1cm is what the golden shows).
  if (margins) {
    params.marginTop = margins.top ?? 0;
    params.marginBottom = margins.bottom ?? 0;
    params.marginLeft = margins.left ?? 0;
    params.marginRight = margins.right ?? 0;
  }
  const cdp = await page.createCDPSession();
  const { data } = await cdp.send('Page.printToPDF', params);
  await cdp.detach();
  return Buffer.from(data, 'base64');
}

/** Load a local HTML file and print it. */
export async function printHtmlFile(browser, htmlPath, opts = {}) {
  const page = await loadHtmlPage(browser, htmlPath, opts);
  try {
    return await printPage(page, opts);
  } finally {
    await page.close();
  }
}

/** Print a raw HTML string (written to a temp file first, like Typora does). */
export async function printHtmlString(browser, html, tmpDir, opts = {}) {
  await fs.mkdir(tmpDir, { recursive: true });
  const file = path.join(tmpDir, `md2pdf-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  await fs.writeFile(file, html, 'utf8');
  try {
    return await printHtmlFile(browser, file, opts);
  } finally {
    await fs.rm(file, { force: true });
  }
}
