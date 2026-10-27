// tools/probe-margins.js
// Nail down the exact margin inset Electron 30 / Chromium 124 applies for
// Typora's `{printBackground:false, marginsType:0, pageSize:"A4"}` call.
//
// Electron maps marginsType 0 -> printing::mojom::MarginType::DEFAULT, i.e. it
// sends no explicit margins to CDP and Chromium applies its own default. Since
// Puppeteer mangles/drops margins, we talk raw CDP here so what we measure is
// what Typora gets.
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';

const CHROME_124 = 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1112\\chrome-win\\chrome.exe';
const A4_IN = { width: 595.92 / 72, height: 842.88 / 72 }; // Electron "A4" as measured

const HTML = process.argv[2];
const CASES = {
  m0: {},                                                   // no margin params at all (CDP default)
  m_cm: { marginTop: 1 / 2.54, marginBottom: 1 / 2.54, marginLeft: 1 / 2.54, marginRight: 1 / 2.54 },
  m_04: { marginTop: 0.4, marginBottom: 0.4, marginLeft: 0.4, marginRight: 0.4 },
  m28pt: { marginTop: 28 / 72, marginBottom: 28 / 72, marginLeft: 28 / 72, marginRight: 28 / 72 },
};

const browser = await puppeteer.launch({
  executablePath: CHROME_124,
  headless: true,
  args: ['--allow-file-access-from-files', '--font-render-hinting=none'],
});
try {
  const page = await browser.newPage();
  await page.goto('file:///' + HTML.replace(/\\/g, '/'), { waitUntil: 'load' });
  await page.waitForFunction(() => document.fonts.status === 'loaded').catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  const cdp = await page.createCDPSession();
  for (const [tag, extra] of Object.entries(CASES)) {
    const params = {
      printBackground: false,
      preferCSSPageSize: false,
      paperWidth: A4_IN.width,
      paperHeight: A4_IN.height,
      ...extra,
    };
    const { data } = await cdp.send('Page.printToPDF', params);
    await fs.mkdir('out/probe', { recursive: true });
    await fs.writeFile(`out/probe/${tag}.pdf`, Buffer.from(data, 'base64'));
    console.log(tag, JSON.stringify(params));
  }
} finally {
  await browser.close();
}
