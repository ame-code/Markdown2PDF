#!/usr/bin/env node
// tools/acceptance.mjs — end-to-end acceptance against a real Typora export
//
// Runs the standalone tool on a Markdown file, then compares the result to a
// golden PDF produced by Typora itself, on four independent levels:
//   1. structure   pages, page rect, link annotations (URI + rect)
//   2. bookmarks   outline titles/levels/page numbers
//   3. metadata    Info dictionary against the export options
//   4. pixels      banded raster diff (pdfdiff.py, PyMuPDF)
//
// usage: node tools/acceptance.mjs [--md <file>] [--golden <pdf>] [--out <pdf>]
//        [--footer <tpl>] [--header <tpl>] [--author <s>] [--title <s>]
//        [--dpi 150] [--json <file>]
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString } from 'pdf-lib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BUNDLED_PY = 'E:\\work\\reverse\\reverse-typora-export\\venv124\\Scripts\\python.exe';
// Interpreter with PyMuPDF: explicit override, else the research venv, else whatever `python` is.
const PY = process.env.MDPDF_PYTHON
  || (fsSync.existsSync(BUNDLED_PY) ? BUNDLED_PY : 'python');

const DEFAULTS = {
  md: path.join(ROOT, 'golden', 'typora-export-test.md'),
  golden: path.join(ROOT, 'golden', 'typora-export-test.pdf'),
  out: path.join(ROOT, 'out', 'acceptance.pdf'),
  // The export options recorded in ipc-real-printtopdf-calls.json
  footer: 'No. ${pageNo} / ${totalPages}',
  author: '一苇',
  dpi: '150',
};

function parseArgs(argv) {
  const o = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--md') { o.md = v; i++; }
    else if (k === '--golden') { o.golden = v; i++; }
    else if (k === '--out') { o.out = v; i++; }
    else if (k === '--footer') { o.footer = v; i++; }
    else if (k === '--header') { o.header = v; i++; }
    else if (k === '--author') { o.author = v; i++; }
    else if (k === '--title') { o.title = v; i++; }
    else if (k === '--dpi') { o.dpi = v; i++; }
    else if (k === '--json') { o.json = v; i++; }
  }
  return o;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { ...opts, windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

function str(v) {
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  return v ? String(v) : null;
}

/** Structure of a PDF, read the same way for both sides of the comparison. */
async function inspect(file) {
  const bytes = await fs.readFile(file);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context;
  const pages = doc.getPages();
  const annots = [];
  pages.forEach((page, i) => {
    const a = page.node.Annots();
    if (!a) return;
    const arr = a instanceof PDFArray ? a : ctx.lookup(a);
    for (let k = 0; k < arr.size(); k++) {
      const d = ctx.lookup(arr.get(k), PDFDict);
      if (!d) continue;
      const ac = d.get(PDFName.of('A'));
      const ad = ac ? ctx.lookup(ac, PDFDict) : null;
      const uri = ad ? str(ad.get(PDFName.of('URI'))) : null;
      const rect = d.get(PDFName.of('Rect'));
      const vals = rect && rect instanceof PDFArray ? rect.asArray().map((x) => Number(x.toString())) : [];
      annots.push({ page: i + 1, uri, rect: vals.map((n) => Math.round(n * 100) / 100) });
    }
  });
  const outline = [];
  const root = doc.catalog.get(PDFName.of('Outlines'));
  const lookupDict = (ref) => {
    if (!ref) return null;
    try { return ctx.lookup(ref, PDFDict); } catch { return null; }
  };
  const walk = (ref, level) => {
    let node = lookupDict(ref);
    const seen = new Set();
    while (node && !seen.has(node)) {
      seen.add(node);
      const title = str(node.get(PDFName.of('Title'))) ?? '';
      const dest = node.get(PDFName.of('Dest'));
      let page = null;
      if (dest) {
        const arr = dest instanceof PDFArray ? dest : ctx.lookup(dest, PDFArray);
        const first = arr && arr.get(0);
        const idx = pages.findIndex((p) => p.ref === first);
        page = idx >= 0 ? idx + 1 : null;
      }
      outline.push({ level, title, page });
      const first = node.get(PDFName.of('First'));
      if (first) walk(first, level + 1);
      node = lookupDict(node.get(PDFName.of('Next')));
    }
  };
  if (root) walk(root, 1);
  const info = {};
  const raw = doc.getInfoDict();
  for (const [k, v] of raw.entries()) info[k.asString().replace(/^\//, '')] = str(v);
  return {
    file,
    pages: pages.length,
    rect: [pages[0].getWidth(), pages[0].getHeight()],
    annots,
    outline,
    info,
  };
}

const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

function compareStructure(ours, golden) {
  const rows = [];
  const push = (name, ok, detail = '') => rows.push({ name, ok, detail });
  push('page count', ours.pages === golden.pages, `${ours.pages} vs ${golden.pages}`);
  push(
    'page rect',
    near(ours.rect[0], golden.rect[0]) && near(ours.rect[1], golden.rect[1]),
    `${ours.rect.map((n) => n.toFixed(2))} vs ${golden.rect.map((n) => n.toFixed(2))}`,
  );
  push('link annot count', ours.annots.length === golden.annots.length, `${ours.annots.length} vs ${golden.annots.length}`);
  const n = Math.min(ours.annots.length, golden.annots.length);
  for (let i = 0; i < n; i++) {
    const a = ours.annots[i];
    const b = golden.annots[i];
    const same = a.page === b.page && a.uri === b.uri && a.rect.every((v, k) => near(v, b.rect[k]));
    push(`annot #${i}`, same, `${a.uri} [${a.rect.join(',')}] vs ${b.uri} [${b.rect.join(',')}]`);
  }
  return rows;
}

function compareBookmarks(ours, golden) {
  const rows = [];
  const same = ours.outline.length === golden.outline.length &&
    ours.outline.every((e, i) => e.level === golden.outline[i].level && e.title === golden.outline[i].title && e.page === golden.outline[i].page);
  rows.push({
    name: 'outline',
    ok: same,
    detail: `${JSON.stringify(ours.outline)} vs ${JSON.stringify(golden.outline)}`,
  });
  return rows;
}

function compareMeta(ours, golden) {
  const rows = [];
  const keys = ['Title', 'Author', 'Creator', 'Producer'];
  for (const k of keys) {
    const a = ours.info[k] ?? '';
    const b = golden.info[k] ?? '';
    rows.push({ name: `info ${k}`, ok: a === b, detail: `${JSON.stringify(a)} vs ${JSON.stringify(b)}` });
  }
  const dateShape = (s) => (s == null ? null : s.replace(/[0-9]/g, '9'));
  for (const k of ['CreationDate', 'ModDate']) {
    const a = dateShape(ours.info[k]);
    const b = dateShape(golden.info[k]);
    rows.push({ name: `info ${k} (shape)`, ok: a === b, detail: `${ours.info[k]} vs ${golden.info[k]}` });
  }
  return rows;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const outPdf = path.resolve(o.out);

  const build = await run(process.execPath, [
    path.join(ROOT, 'bin', 'md2pdf.js'), o.md,
    '-o', outPdf,
    '--footer', o.footer,
    '--author', o.author,
    ...(o.header ? ['--header', o.header] : []),
    ...(o.title ? ['--title', o.title] : []),
    '--quiet',
  ]);
  if (build.code !== 0) {
    console.error('build failed:\n' + build.err);
    process.exit(1);
  }

  const ours = await inspect(outPdf);
  const golden = await inspect(o.golden);
  let rows = [...compareStructure(ours, golden), ...compareBookmarks(ours, golden), ...compareMeta(ours, golden)];

  // pixel diff
  const jsonPath = path.join(ROOT, 'out', 'acceptance-diff.json');
  const diffRun = await run(PY, [path.join(ROOT, 'tools', 'pdfdiff.py'), outPdf, o.golden, '--json', jsonPath, '--dpi', o.dpi]);
  let diff = null;
  try {
    diff = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  } catch {
    rows.push({ name: 'pixel diff', ok: false, detail: 'pdfdiff did not produce JSON: ' + diffRun.err.slice(-400) });
  }
  let worstBody = 0;
  let worstTotal = 0;
  if (diff) {
    for (const p of diff.pages || []) {
      worstBody = Math.max(worstBody, p.diff_body);
      worstTotal = Math.max(worstTotal, p.diff_total);
    }
    rows.push({
      name: 'pixel diff body',
      ok: worstBody <= 0.05,
      detail: `worst page ${worstBody.toFixed(4)}% (threshold 0.05%)`,
    });
    rows.push({
      name: 'pixel diff total',
      ok: worstTotal <= 0.2,
      detail: `worst page ${worstTotal.toFixed(4)}% (threshold 0.2%)`,
    });
  }

  const width = Math.max(...rows.map((r) => r.name.length));
  console.log(`\n${path.basename(o.md)} -> ${path.basename(outPdf)}  vs  ${path.basename(o.golden)}`);
  console.log('-'.repeat(width + 50));
  for (const r of rows) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(width)}  ${r.detail}`);
  }
  const failed = rows.filter((r) => !r.ok);
  console.log('-'.repeat(width + 50));
  console.log(`${rows.length - failed.length}/${rows.length} passed${failed.length ? ', ' + failed.length + ' failed' : ''}`);

  if (o.json) {
    await fs.writeFile(o.json, JSON.stringify({ md: o.md, out: outPdf, golden: o.golden, rows, diff }, null, 2));
  }
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
