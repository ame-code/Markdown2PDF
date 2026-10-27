// Compare page-visible locale between the full-locale and the trimmed Chromium.
import { launchBrowser } from '../src/print.js';
import path from 'node:path';

const EXES = {
  full: 'C:\\Users\\14578\\AppData\\Local\\ms-playwright\\chromium-1112\\chrome-win\\chrome.exe',
  trimmed: 'E:\\work\\reverse\\markdown2pdf\\out\\chroma\\trim\\chrome-win\\chrome.exe',
};
const HTML = path.resolve('golden/typora-export-reference.html');

for (const [tag, exe] of Object.entries(EXES)) {
  const browser = await launchBrowser({
    executablePath: exe,
    args: ['--allow-file-access-from-files', '--font-render-hinting=none'],
  });
  const page = await browser.newPage();
  await page.goto('file:///' + HTML.replace(/\\/g, '/'), { waitUntil: 'load' });
  const info = await page.evaluate(() => ({
    navLang: navigator.language,
    langs: navigator.languages.slice(0, 4),
    dateShort: new Date(2026, 0, 2).toLocaleDateString(),
    dateLong: new Date(2026, 0, 2).toLocaleDateString(undefined, { dateStyle: 'full' }),
    number: (1234567.891).toLocaleString(),
    intlNegotiated: Intl.DateTimeFormat().resolvedOptions().locale,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
  // detect CJK font actually used for a Han glyph
  const cjkFont = await page.evaluate(() => {
    const el = document.querySelector('#write p');
    if (!el) return null;
    const r = document.createRange();
    const node = [...el.querySelectorAll('span')].find((s) => /[\u4e00-\u9fff]/.test(s.textContent));
    if (!node) return null;
    r.selectNodeContents(node);
    return { text: node.textContent.slice(0, 12), family: getComputedStyle(node).fontFamily.slice(0, 60) };
  });
  console.log(tag, JSON.stringify(info), JSON.stringify(cjkFont));
  await browser.close();
}
