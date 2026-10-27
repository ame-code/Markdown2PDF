// tools/_css-diff.mjs — find declarations lost when swapping stylesheets
//
// Loads two HTML files that differ only in their stylesheet links, emulates the
// print media type, walks #write (and every descendant) and compares the full
// computed style property by property. Prints the first N differences grouped by
// property so a rule that got dropped is easy to spot.
//
// Usage: node tools/_css-diff.mjs old.html new.html [--limit 40]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../src/print.js';

const args = process.argv.slice(2);
const limitFlag = args.indexOf('--limit');
const limit = limitFlag >= 0 ? Number(args[limitFlag + 1]) : 40;
const [oldHtml, newHtml] = args.filter((a, i) => !a.startsWith('--') && i !== limitFlag + 1);

if (!oldHtml || !newHtml) {
  process.stderr.write('usage: node tools/_css-diff.mjs old.html new.html [--limit 40]\n');
  process.exit(2);
}

async function snapshot(browser, htmlPath) {
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  await client.send('Emulation.setEmulatedMedia', { media: 'print' });
  await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: 'load' });
  const data = await page.evaluate(() => {
    const root = document.querySelector('#write');
    if (!root) return [];
    const nodes = [root, ...root.querySelectorAll('*')];
    return nodes.map((el, idx) => {
      const cs = getComputedStyle(el);
      const props = {};
      for (let i = 0; i < cs.length; i += 1) {
        const name = cs[i];
        props[name] = cs.getPropertyValue(name);
      }
      return {
        idx,
        tag: el.tagName.toLowerCase(),
        cls: el.className && String(el.className).slice(0, 60),
        props,
      };
    });
  });
  await page.close();
  return data;
}

const browser = await launchBrowser({});
try {
  const a = await snapshot(browser, oldHtml);
  const b = await snapshot(browser, newHtml);
  if (a.length !== b.length) {
    process.stdout.write(`element count differs: old ${a.length} vs new ${b.length}\n`);
  }
  const n = Math.min(a.length, b.length);
  const diffs = [];
  for (let i = 0; i < n; i += 1) {
    for (const [prop, value] of Object.entries(a[i].props)) {
      const other = b[i].props[prop];
      if (other !== undefined && other !== value) {
        diffs.push({ el: `${a[i].tag}${a[i].cls ? '.' + a[i].cls.trim().replace(/\s+/g, '.') : ''}`, idx: i, prop, old: value, now: other });
      }
    }
  }
  const byProp = new Map();
  for (const d of diffs) {
    if (!byProp.has(d.prop)) byProp.set(d.prop, []);
    byProp.get(d.prop).push(d);
  }
  process.stdout.write(`${diffs.length} differing declarations across ${n} elements\n`);
  for (const [prop, list] of [...byProp].sort((x, y) => y[1].length - x[1].length).slice(0, limit)) {
    const s = list[0];
    process.stdout.write(
      `\n${prop}  (${list.length} elem)\n  old: ${s.old}\n  new: ${s.now}\n  at : #${s.idx} ${s.el}\n`,
    );
  }
} finally {
  await browser.close();
}
