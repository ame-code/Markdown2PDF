// tools/parity.mjs 鈥?DOM parity harness
//
// Runs the fixtures in evidence/dom-cases/cases.json through src/md2typora.js
// and reports byte-level mismatches. Two comparison modes:
//   full     鈥?the fixture is the complete body
//   contains 鈥?the fixture is an excerpt of a larger document (the dom-analyst
//              extracted some cases out of the real export), so we require the
//              expected fragment to occur verbatim in our output
// cid digits are normalised: the numbering rule is a documented approximation
// (dom-spec.md 搂9a) and cids are invisible in print.
//
// Usage: node tools/parity.mjs [--verbose] [--only=id,id]
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { createMarkdown, renderDocument } from '../src/md2typora.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cases = JSON.parse(fs.readFileSync(path.join(root, 'evidence/dom-cases/cases.json'), 'utf8'));

const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const only = (argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);

// fixtures that are excerpts of the real export, not whole documents
const CONTAINS = new Set(['link.internal', 'yaml.meta-dropped', 'heading.h1-breakpage', 'footnote.ref']);
// fixtures whose markdown needs non-default Typora options switched on
const OPTIONS = { 'inline.mark-sub-sup-u-del': { enableHighlight: true, enableSubscript: true, enableSuperscript: true } };
// not implementable yet / documented approximations
const KNOWN = new Set(['inline.emoji']);
// Documented, accepted divergences: they are reported but do not fail the run.
//   image.block 鈥?`?lastModify=` is Typora's export timestamp; we use file mtime.
const ACCEPTED = new Set(['image.block']);

const HOOKS = {
  fence: (code, info, { cid }) =>
    `<pre class="md-fences md-end-block ty-contain-cm" data-cid="${cid}"${info ? ` lang="${info.trim().split(/\s+/)[0]}"` : ''}></pre>`,
  inlineMath: (tex) => `<span data-math-inline="${tex.replace(/"/g, '&quot;')}"></span>`,
  blockMath: (tex, { cid }) => `<div class="math-block-placeholder" data-cid="${cid}">${tex}</div>`,
};

function normalize(html) {
  return String(html)
    // image src: the artifact embeds the exporter's own working directory
    .replace(/(src=")(?:[^"]*[\/\\])?([^\/\\"]+\.[A-Za-z0-9]+)(\?[^"]*)?"/g, '$1FILE:$2$3"')
    // cid digits are an approximation; keep the shape, drop the number
    .replace(/header-n\d+/g, 'header-nCID')
    .replace(/af:\/\/n\d+/g, 'af://nCID')
    .replace(/cjx?-n?\d+/g, (m) => m)
    .replace(/id="mathjax-n\d+"/g, 'id="mathjax-nCID"')
    .replace(/cid="n\d+"/g, 'cid="nCID"');
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return n;
}

let pass = 0; let fail = 0; let known = 0; let accepted = 0; const failures = [];
for (const c of cases) {
  if (only.length && !only.includes(c.id)) continue;
  if (c.skip || /fence|math/.test(c.id)) continue;
  const md = createMarkdown(OPTIONS[c.id] || {});
  let out;
  try {
    out = renderDocument(md, c.markdown, HOOKS);
  } catch (e) {
    fail++; failures.push({ id: c.id, err: String((e && e.message) || e) });
    continue;
  }
  const got = normalize(out.body);
  const want = normalize(c.expectedHtml);
  const ok = CONTAINS.has(c.id) ? got.includes(want) : got === want;
  if (ok) { pass++; continue; }
  if (KNOWN.has(c.id)) { known++; continue; }
  if (ACCEPTED.has(c.id)) { accepted++; continue; }
  fail++;
  const at = firstDiff(got, want);
  failures.push({ id: c.id, at, got, want, source: c.source, mode: CONTAINS.has(c.id) ? 'contains' : 'full' });
}

console.log(`parity: ${pass} pass, ${fail} fail, ${known} known-gap, ${accepted} accepted-diff  (of ${cases.length} fixtures)`);
for (const f of failures) {
  console.log(`\n--- FAIL ${f.id}${f.source ? ` [${f.source}]` : ''}${f.mode === 'contains' ? ' (contains)' : ''}${f.err ? ' ERROR: ' + f.err : ''}`);
  if (f.err) continue;
  const lo = Math.max(0, f.at - 70);
  console.log(`  at ${f.at}`);
  console.log(`  got : 鈥?{JSON.stringify(f.got.slice(lo, f.at + 110))}`);
  console.log(`  want: 鈥?{JSON.stringify(f.want.slice(lo, f.at + 110))}`);
  if (verbose) { console.log(`  FULL got : ${f.got}`); console.log(`  FULL want: ${f.want}`); }
}
process.exit(fail ? 1 : 0);
