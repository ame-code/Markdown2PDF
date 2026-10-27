#!/usr/bin/env node
/**
 * Dump `#write` geometry for any Typora-shaped print HTML.
 *
 * Used to compare our generated document against the reference export that
 * reproduces the golden PDF pixel-for-pixel, so layout deltas can be read as
 * numbers instead of eyeballed.
 *
 *   node tools/geom.mjs out/ref/ref-export-local.html
 */
import { launchBrowser, loadHtmlPage, fileUrl } from '../src/print.js';

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error('usage: node tools/geom.mjs <file.html>');
  process.exit(2);
}

const GEOM = () => {
  const out = { blocks: [], mjx: [], write: null, fonts: [] };
  const w = document.getElementById('write');
  if (!w) return out;
  const wr = w.getBoundingClientRect();
  const wcs = getComputedStyle(w);
  out.write = {
    top: +wr.top.toFixed(2),
    left: +wr.left.toFixed(2),
    width: +wr.width.toFixed(2),
    fontSize: wcs.fontSize,
    fontFamily: wcs.fontFamily,
    lineHeight: wcs.lineHeight,
  };
  [...w.children].forEach((el, i) => {
    const r = el.getBoundingClientRect();
    out.blocks.push({
      i,
      tag: el.tagName,
      cls: typeof el.className === 'string' ? el.className : '',
      top: +r.top.toFixed(2),
      h: +r.height.toFixed(2),
    });
  });
  document.querySelectorAll('mjx-container').forEach((c, i) => {
    const r = c.getBoundingClientRect();
    const cs = getComputedStyle(c);
    const svg = c.querySelector('svg');
    const sr = svg && svg.getBoundingClientRect();
    const scs = svg && getComputedStyle(svg);
    out.mjx.push({
      i,
      display: cs.display,
      va: cs.verticalAlign,
      fs: cs.fontSize,
      lh: cs.lineHeight,
      margin: cs.margin,
      top: +r.top.toFixed(2),
      h: +r.height.toFixed(2),
      w: +r.width.toFixed(2),
      svgH: sr ? +sr.height.toFixed(2) : null,
      svgW: sr ? +sr.width.toFixed(2) : null,
      svgAttrH: svg ? svg.getAttribute('height') : null,
      svgStyle: svg ? svg.getAttribute('style') : null,
      svgDisplay: scs ? scs.display : null,
      svgVa: scs ? scs.verticalAlign : null,
    });
  });
  return out;
};

const browser = await launchBrowser();
try {
  const page = await loadHtmlPage(browser, htmlPath, { settleMs: 800 });
  const geom = await page.evaluate(GEOM);
  console.log(JSON.stringify(geom, null, 1));
} finally {
  await browser.close();
}
