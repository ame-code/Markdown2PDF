import { CHROMIUM_CANDIDATES } from '../index.js';
import fs from 'node:fs';
const puppeteer = (await import('puppeteer-core')).default;
const b = await puppeteer.launch({ executablePath: CHROMIUM_CANDIDATES.find(p=>fs.existsSync(p)), headless:'new', args:['--no-sandbox'] });
const p = await b.newPage();
await p.setContent('<!DOCTYPE html><body><pre id="a"></pre><pre id="b"></pre><pre id="c"></pre><pre id="d"></pre></body>');
console.log(JSON.stringify(await p.evaluate(() => {
  const a=document.getElementById('a'), b=document.getElementById('b'), c=document.getElementById('c'), d=document.getElementById('d');
  a.style.setProperty('page-break-inside','unset');
  b.style.setProperty('page-break-inside','avoid');
  c.style.pageBreakInside='unset';
  d.style.setProperty('break-inside','unset');
  return { setPropertyUnset: a.getAttribute('style'), setPropertyAvoid: b.getAttribute('style'), camelUnset: c.getAttribute('style'), breakInside: d.getAttribute('style'),
           aCss: getComputedStyle(a).pageBreakInside, cCss: getComputedStyle(c).pageBreakInside };
}), null, 1));
await b.close();
