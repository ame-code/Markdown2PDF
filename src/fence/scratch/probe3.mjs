// Probe 3: (a) does --force-device-scale-factor=1.25 reproduce the reference's
// 23.0375px line box / top:9.51875px ?, (b) Chromium's style-attribute
// serialisation order for a textarea created the way CM creates it.
import fs from 'node:fs';
import { FENCE_SCRIPTS, FENCE_INPAGE, mountFenceAssets, CHROMIUM_CANDIDATES } from '../index.js';

const puppeteer = (await import('puppeteer-core')).default;
const CSS = mountFenceAssets().css;
const EXE = CHROMIUM_CANDIDATES.find((p) => fs.existsSync(p));

async function run(extraArgs, label) {
  const browser = await puppeteer.launch({
    executablePath: EXE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none', ...extraArgs],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 1400, deviceScaleFactor: 1 });
    await page.setContent(
      `<!DOCTYPE html><html><head><style>${CSS}</style></head><body class="typora-export typora-print os-windows">` +
        `<div class="typora-export-content"><div id="write" style="top:auto" class="is-node"></div></div></body></html>`,
      { waitUntil: 'load' }
    );
    for (const f of FENCE_SCRIPTS) await page.addScriptTag({ content: fs.readFileSync(f, 'utf8') });
    await page.addScriptTag({ content: FENCE_INPAGE });
    const r = await page.evaluate(async () => {
      const host = document.getElementById('write');
      const pre = document.createElement('pre');
      pre.className = 'md-fences md-end-block ty-contain-cm';
      pre.setAttribute('spellcheck', 'false');
      pre.setAttribute('lang', 'cpp');
      pre.setAttribute('data-mdpdf-fence', 'x');
      host.appendChild(pre);
      await window.md2pdfRenderFences([
        { index: 'x', code: '#include <bits/stdc++.h>\nint main() { return 0; }', lang: 'cpp' },
      ]);
      const line = pre.querySelector('.CodeMirror-line');
      const ta = pre.querySelector('textarea');
      return {
        dpr: devicePixelRatio,
        lineBox: line.getBoundingClientRect().height,
        wrapperStyle: ta.parentElement.getAttribute('style'),
        forcer: pre.querySelector('.CodeMirror-scroll > div[style*="border-bottom"]')?.getAttribute('style'),
        gutters: pre.querySelector('.CodeMirror-gutters')?.getAttribute('style'),
        outer: pre.outerHTML,
      };
    });
    console.log('===', label, 'dpr=', r.dpr, 'lineBox=', r.lineBox);
    console.log('wrapper:', r.wrapperStyle);
    console.log('forcer :', r.forcer);
    console.log('gutters:', r.gutters);
    return r;
  } finally {
    await browser.close();
  }
}

// reference values for comparison
const REF_TOP = 9.51875;
for (const [args, label] of [
  [[], 'default'],
  [['--force-device-scale-factor=1.25'], 'force-dsf-1.25'],
  [['--force-device-scale-factor=1.5'], 'force-dsf-1.5'],
]) {
  const r = await run(args, label);
  const m = /top: ([\d.]+)px/.exec(r.wrapperStyle || '');
  console.log('  -> top', m && m[1], 'delta vs ref', m ? (parseFloat(m[1]) - REF_TOP).toFixed(6) : 'n/a');
}

// (b) attribute order variants
const browser = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setContent('<!DOCTYPE html><body></body>');
  const out = await page.evaluate(() => {
    const B = document.body;
    const variants = {};
    // v1: style via cssText at creation, then attrs, then tabIndex (CM's order)
    let ta = document.createElement('textarea');
    ta.style.cssText = 'position: absolute; bottom: -1em; padding: 0;';
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('spellcheck', 'false');
    ta.tabIndex = 0;
    variants.v1_detached = ta.outerHTML;
    B.appendChild(ta);
    variants.v1_attached = ta.outerHTML;
    ta.remove();
    // v2: same but style assignment AFTER tabIndex
    ta = document.createElement('textarea');
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('spellcheck', 'false');
    ta.tabIndex = 0;
    ta.style.cssText = 'position: absolute; bottom: -1em; padding: 0;';
    variants.v2_styleLast = ta.outerHTML;
    // v3: setAttribute('style', ...) instead of cssText
    ta = document.createElement('textarea');
    ta.setAttribute('style', 'position: absolute; bottom: -1em; padding: 0;');
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('spellcheck', 'false');
    ta.tabIndex = 0;
    variants.v3_setAttrStyle = ta.outerHTML;
    // v4: setAttribute style first then re-set later (forces style attr to move?)
    ta = document.createElement('textarea');
    ta.style.cssText = 'x:y';
    ta.setAttribute('autocorrect', 'off');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('spellcheck', 'false');
    ta.tabIndex = 0;
    ta.style.cssText = 'position: absolute; bottom: -1em; padding: 0;';
    variants.v4_styleReSet = ta.outerHTML;
    return variants;
  });
  console.log(JSON.stringify(out, null, 1));
} finally {
  await browser.close();
}
