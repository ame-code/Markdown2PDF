// Probe: (a) where the teTop/line-box numbers come from, (b) why the reference
// textarea serialises with tabindex before style, (c) whether a Text node
// accepts innerHTML (the frame.js ";" wrapper branch).
import fs from 'node:fs';
import path from 'node:path';
import { FENCE_SCRIPTS, FENCE_INPAGE, mountFenceAssets, CHROMIUM_CANDIDATES } from '../index.js';

const puppeteer = (await import('puppeteer-core')).default;
const CSS = mountFenceAssets().css;

async function withPage(dpr, fn) {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_CANDIDATES.find((p) => fs.existsSync(p)),
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-lcd-text', '--font-render-hinting=none'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1400, deviceScaleFactor: dpr });
    await page.setContent(
      `<!DOCTYPE html><html><head><style>${CSS}</style></head>` +
        `<body class="typora-export typora-print os-windows"><div class="typora-export-content">` +
        `<div id="write" style="top:auto" class="is-node"></div></div></body></html>`,
      { waitUntil: 'load' }
    );
    for (const f of FENCE_SCRIPTS) await page.addScriptTag({ content: fs.readFileSync(f, 'utf8') });
    await page.addScriptTag({ content: FENCE_INPAGE });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

const metrics = async (page) =>
  page.evaluate(() => {
    const host = document.getElementById('write');
    const pre = document.createElement('pre');
    pre.className = 'md-fences md-end-block ty-contain-cm';
    pre.setAttribute('spellcheck', 'false');
    pre.setAttribute('lang', 'cpp');
    pre.setAttribute('data-mdpdf-fence', 'x');
    host.appendChild(pre);
    return window
      .md2pdfRenderFences([{ index: 'x', code: '#include <bits/stdc++.h>\nint main() { return 0; }', lang: 'cpp' }])
      .then(() => {
        const line = pre.querySelector('.CodeMirror-line');
        const span = line.querySelector('span');
        const ta = pre.querySelector('textarea');
        const wrap = ta.parentElement;
        const cm = pre.querySelector('.CodeMirror').CodeMirror;
        const cs = getComputedStyle(span);
        const lr = line.getBoundingClientRect();
        const sr = span.getBoundingClientRect();
        return {
          dpr: devicePixelRatio,
          textareaOuter: ta.outerHTML,
          wrapperStyle: wrap.getAttribute('style'),
          lineRect: { top: lr.top, height: lr.height },
          spanRect: { top: sr.top, height: sr.height },
          cssFontSize: cs.fontSize,
          cssLineHeight: cs.lineHeight,
          cssFontFamily: cs.fontFamily,
          cmLineHeights: cm && cm.display && cm.display.measure && cm.display.measure.heights,
          cmHeightsMap: cm && Object.values ? null : null,
          heightForcer: pre.querySelector('.CodeMirror-sizer')?.parentElement
            ? pre.querySelector('.CodeMirror-scroll div[style*="border-bottom"]')?.getAttribute('style')
            : null,
        };
      });
  });

for (const dpr of [1, 1.25]) {
  const r = await withPage(dpr, metrics);
  console.log('--- dpr', dpr);
  console.log(JSON.stringify(r, null, 1));
}

// (b) attribute-order mechanism + (c) Text-node innerHTML
const mech = await withPage(1, async (page) => {
  return page.evaluate(() => {
    const mk = (order) => {
      const ta = document.createElement('textarea');
      const setStyle = () => (ta.style.cssText = 'position: absolute; bottom: -1em; padding: 0;');
      const setAttrs = () => {
        ta.setAttribute('autocorrect', 'off');
        ta.setAttribute('autocapitalize', 'off');
        ta.setAttribute('spellcheck', 'false');
      };
      const setTab = () => (ta.tabIndex = 0);
      if (order === 'style-first') {
        setStyle(); setAttrs(); setTab();
      } else if (order === 'tab-first') {
        setAttrs(); setTab(); setStyle();
      }
      return ta.outerHTML;
    };
    const t = document.createTextNode('a; b');
    let threw = null;
    let set = false;
    try {
      t.innerHTML = "<span style='font-family:x'>;</span>";
      set = true;
    } catch (e) {
      threw = String(e);
    }
    return {
      styleFirst: mk('style-first'),
      tabFirst: mk('tab-first'),
      textNodeHTML: {
        setWithoutThrow: set,
        threw,
        ownProp: Object.prototype.hasOwnProperty.call(t, 'innerHTML'),
        value: String(t.innerHTML),
        textContentAfter: t.textContent,
      },
    };
  });
});
console.log('--- mechanism');
console.log(JSON.stringify(mech, null, 1));
void path;
