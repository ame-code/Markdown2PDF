// tools/smoke-build.mjs — end-to-end smoke test of the pipeline
// Usage: node tools/smoke-build.mjs [input.md] [out.pdf]
import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from '../src/build.js';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const input = process.argv[2] || path.join(root, 'test', 'simple.md');
const outPdf = process.argv[3] || path.join(root, 'out', 'smoke.pdf');
const outHtml = outPdf.replace(/\.pdf$/i, '.html');

const md = await fs.readFile(input, 'utf8');
const t0 = Date.now();
const res = await build({
  markdown: md,
  baseDir: path.dirname(input),
  themePath: path.join(root, 'vendor', 'themes', 'my.css'),
  title: path.basename(input).replace(/\.md$/i, ''),
  outHtml,
  print: { paper: 'A4' },
});
await fs.mkdir(path.dirname(outPdf), { recursive: true });
await fs.writeFile(outPdf, res.pdfBuffer);
await fs.writeFile(outHtml, res.html, 'utf8');
console.log('built', outPdf, res.pdfBuffer.length, 'bytes in', Date.now() - t0, 'ms; math=', res.hasMath, 'fence=', res.hasFence);
console.log('html', outHtml);
