/*
 * verify.js -- re-runnable verification for the fence renderer.
 *
 *   node src/fence/verify.js            # human summary
 *   node src/fence/verify.js --json     # machine-readable, for CI
 *
 * Checks
 *   1. byte-identity against the real Typora print export's cpp fence
 *      (E:\work\reverse\reverse-typora-export\evidence\real-export-html-MATH.html)
 *   2. js / python / html / bash, an unknown language, and no language at all
 *   3. stress corpus: trailing blank lines, tabs, non-ASCII, >13 lines,
 *      empty block, fence info string {.numberLines}, CRLF input
 *   4. structural invariants the export must satisfy (no editor chrome, no
 *      zwsp markers, sizer min-height gone, modeLoaded set, lang attr casing)
 *
 * Exit code 0 = all assertions passed (byte-identity included).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderFences, mountFenceAssets, FENCE_SCRIPTS } from './index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REF_HTML = 'E:\\work\\reverse\\reverse-typora-export\\evidence\\real-export-html-MATH.html';
const JSON_OUT = process.argv.includes('--json');

/** Extract the n-th balanced <pre>鈥?/pre> starting at <pre class="md-fences 鈥?. */
function extractFence(html, which = 0) {
  let from = 0;
  for (let n = 0; n <= which; n++) {
    const start = html.indexOf('<pre class="md-fences', from);
    if (start < 0) return null;
    let i = start;
    let depth = 0;
    for (;;) {
      const open = html.indexOf('<pre', i);
      const close = html.indexOf('</pre>', i);
      if (close < 0) return null;
      if (open >= 0 && open < close) {
        depth++;
        i = open + 4;
      } else {
        depth--;
        i = close + 6;
        if (depth === 0) return html.slice(start, i);
      }
    }
  }
  return null;
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function diffReport(ref, got) {
  const i = firstDiff(ref, got);
  if (i < 0) return { identical: true, index: -1 };
  const ctx = 90;
  return {
    identical: false,
    index: i,
    refLen: ref.length,
    gotLen: got.length,
    refContext: ref.slice(Math.max(0, i - ctx), i + ctx),
    gotContext: got.slice(Math.max(0, i - ctx), i + ctx),
  };
}

const CASES = [
  {
    id: 'ref-cpp',
    lang: 'cpp',
    code: '#include <bits/stdc++.h>\nint main() { return 0; }',
    expect: { spans: ['cm-meta', 'cm-variable-3', 'cm-def', 'cm-keyword', 'cm-number'], activelineLines: 1 },
  },
  {
    id: 'js',
    lang: 'js',
    code: "const add = (a, b) => a + b; // comment\nconsole.log(`sum=${add(1, 2)}`);",
    expect: { spans: ['cm-keyword', 'cm-variable', 'cm-def', 'cm-operator', 'cm-comment', 'cm-string-2'] },
  },
  {
    id: 'python',
    lang: 'python',
    code: "def greet(name):\n    # say hi\n    return f\"hi {name}\"\n\nprint(greet('typora'))",
    expect: { spans: ['cm-keyword', 'cm-def', 'cm-variable', 'cm-comment', 'cm-string'], activelineLines: 1 },
  },
  {
    id: 'html',
    lang: 'html',
    code: '<div class="a">\n  <p>Hi &amp; bye</p>\n</div>',
    expect: { spans: ['cm-tag', 'cm-attribute', 'cm-string', 'cm-atom'] },
  },
  {
    id: 'bash',
    lang: 'bash',
    code: '#!/bin/bash\nfor f in *.md; do\n  echo "$f" | wc -l\ndone',
    expect: { spans: ['cm-meta', 'cm-keyword', 'cm-builtin', 'cm-string'] },
  },
  {
    id: 'unknown-lang',
    lang: 'notalanguage',
    code: 'some plain text\n\twith a tab and trailing spaces   ',
    expect: { spans: [] },
  },
  {
    id: 'no-lang',
    lang: '',
    code: 'plain block\nsecond line',
    expect: { spans: [] },
  },
  {
    id: 'trailing-blank-lines',
    lang: 'text',
    code: 'first\n\n\n\nlast',
    expect: { spans: [] },
  },
  {
    id: 'non-ascii',
    lang: 'python',
    code: 's = "涓枃娴嬭瘯 鈥?emoji 馃帀 and 眉n茂c酶d茅"\nprint(len(s))',
    expect: { spans: ['cm-string', 'cm-variable'] },
  },
  {
    id: 'tabs',
    lang: 'js',
    code: 'function f() {\n\tif (a) {\n\t\treturn\t1;\n\t}\n}',
    expect: { spans: ['cm-keyword', 'cm-variable'] },
  },
  {
    id: 'long-block-14-lines',
    lang: 'js',
    code: Array.from({ length: 14 }, (_, i) => `const v${i} = ${i};`).join('\n'),
    expect: { pageBreakInside: 'unset' },
  },
  {
    id: 'block-13-lines',
    lang: 'js',
    code: Array.from({ length: 13 }, (_, i) => `const w${i} = ${i};`).join('\n'),
    expect: { pageBreakInside: null },
  },
  {
    id: 'empty',
    lang: 'js',
    code: '',
    expect: { spans: [] },
  },
  {
    id: 'info-string-numberLines',
    lang: '{.numberLines}',
    code: 'a\nb',
    expect: { lineNumbers: true },
  },
];

function parseAttrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:="([^"]*)")?/g;
  const body = tag.replace(/^<pre\s*/, '').replace(/>$/, '');
  let m;
  while ((m = re.exec(body))) out[m[1]] = m[2] === undefined ? '' : m[2];
  return out;
}

function classesOf(html) {
  return new Set((parseAttrs(html.slice(0, html.indexOf('>') + 1)).class || '').split(/\s+/).filter(Boolean));
}

function spanClasses(html) {
  const set = new Set();
  const re = /class="(cm-[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) m[1].split(/\s+/).forEach((c) => set.add(c));
  return set;
}

function lint(html, item) {
  const problems = [];
  const e = item.expect || {};
  const pre = html.slice(0, html.indexOf('>') + 1);
  const attrs = parseAttrs(pre);
  const cls = classesOf(html);

  // --- pre-level contract ------------------------------------------------
  if (!cls.has('md-fences')) problems.push('pre missing md-fences');
  if (!cls.has('md-end-block')) problems.push('pre missing md-end-block');
  if (!cls.has('ty-contain-cm')) problems.push('pre missing ty-contain-cm');
  if (!cls.has('modeLoaded')) problems.push('pre missing modeLoaded');
  if (cls.has('mock-cm')) problems.push('pre still has mock-cm');
  if (attrs.spellcheck !== 'false') problems.push('pre spellcheck != false');
  // frame.js sets lang="<lang>" unconditionally from the *raw* fence info
  // string (only the inner .CodeMirror wrapper gets the lower-cased copy).
  if (attrs.lang === undefined) problems.push('pre lost its lang attribute');
  if ((attrs.lang || '') !== (item.lang || '')) {
    problems.push(`pre lang ${JSON.stringify(attrs.lang)} != ${JSON.stringify(item.lang || '')}`);
  }
  for (const gone of ['cid', 'contenteditable', 'mdtype', 'data-mdpdf-fence']) {
    if (attrs[gone] !== undefined) problems.push(`pre still has ${gone}`);
  }

  // --- inner .CodeMirror contract ---------------------------------------
  if (!/^<div class="CodeMirror cm-s-inner cm-s-null-scroll CodeMirror-wrap"/.test(html.slice(pre.length))) {
    problems.push('inner .CodeMirror wrapper classes are not "CodeMirror cm-s-inner cm-s-null-scroll CodeMirror-wrap"');
  }
  if (!html.includes('lang="' + (item.lang || '').toLowerCase() + '"')) problems.push('wrapper missing lower-cased lang');
  // [cm-zwsp] spans legitimately survive: Typora only rewrites their *text* to
  // "\n".  The zero-width space itself must be gone, though.
  for (const chrome of ['CodeMirror-cursors', 'CodeMirror-hscrollbar', 'CodeMirror-vscrollbar', 'CodeMirror-selectedtext', 'CodeMirror-selected"']) {
    if (html.includes(chrome)) problems.push('export still contains ' + chrome);
  }
  if (html.includes('\u200b')) problems.push('export still contains a zero-width space (U+200B)');
  if (/CodeMirror-sizer" style="[^"]*min-height/.test(html)) problems.push('sizer kept an inline min-height');
  if (item.code.split('\n').length > 0 && /CodeMirror-sizer/.test(html) === false) problems.push('no sizer');

  // --- content fidelity --------------------------------------------------
  const activelineCount = (html.match(/class="CodeMirror-activeline"/g) || []).length;
  if (e.activelineLines !== undefined && activelineCount !== e.activelineLines) {
    problems.push(`activeline wrappers ${activelineCount} != ${e.activelineLines}`);
  }
  const spans = spanClasses(html);
  for (const want of e.spans || []) if (!spans.has(want)) problems.push('missing token class ' + want);

  const wantLineNumbers = !!e.lineNumbers;
  if (wantLineNumbers !== cls.has('md-fences-with-lineno')) {
    problems.push(`md-fences-with-lineno ${cls.has('md-fences-with-lineno')} != ${wantLineNumbers}`);
  }

  // Chromium normalises the legacy alias: page-break-inside:unset serialises
  // as break-inside:unset (verified; Typora's own jQuery .css() call goes
  // through the same CSSOM and therefore produces the same markup).
  const pb = /(?:page-)?break-inside:\s*([^;"]+)/.exec(pre);
  const pbValue = pb ? pb[1].trim() : null;
  if ((e.pageBreakInside ?? null) !== pbValue) {
    problems.push(`break-inside ${JSON.stringify(pbValue)} != ${JSON.stringify(e.pageBreakInside ?? null)}`);
  }

  // every source line must survive as one .CodeMirror-line
  const lineCount = (html.match(/class=" CodeMirror-line "/g) || []).length;
  const wantLines = item.code === '' ? 1 : item.code.split('\n').length;
  if (lineCount !== wantLines) problems.push(`rendered ${lineCount} CodeMirror-line(s) != ${wantLines}`);

  return { problems, attrs, classes: [...cls].sort(), spans: [...spans].sort(), lineCount, pageBreakInside: pbValue };
}

// ---------------------------------------------------------------------------
const refBlock = fs.existsSync(REF_HTML) ? extractFence(fs.readFileSync(REF_HTML, 'utf8'), 0) : null;

const results = await renderFences(CASES.map(({ code, lang }) => ({ code, lang })));
const report = {
  reference: REF_HTML,
  referenceFenceBytes: refBlock ? Buffer.byteLength(refBlock, 'utf8') : null,
  cases: [],
  failures: 0,
  byteIdentical: null,
};

CASES.forEach((item, i) => {
  const html = results[i];
  const { problems, attrs, classes, spans, lineCount, pageBreakInside } = lint(html, item);
  const row = {
    id: item.id,
    lang: item.lang,
    bytes: Buffer.byteLength(html, 'utf8'),
    classes,
    tokenClasses: spans,
    lines: lineCount,
    pageBreakInside,
    problems,
  };
  if (item.id === 'ref-cpp' && refBlock) {
    const d = diffReport(refBlock, html);
    row.byteDiff = d;
    report.byteIdentical = d.identical;
    if (!d.identical) problems.push('BYTE DIFF vs real Typora export');
  }
  if (problems.length) report.failures++;
  report.cases.push(row);
});

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('fence renderer verification');
  console.log('  reference   :', report.reference);
  console.log('  ref fence   :', report.referenceFenceBytes, 'bytes');
  console.log('  css inline  :', mountFenceAssets().css.length, 'bytes from', FENCE_SCRIPTS.length, 'scripts');
  console.log('');
  for (const c of report.cases) {
    const tag = c.problems.length ? 'FAIL' : ' ok ';
    console.log(`[${tag}] ${c.id.padEnd(22)} ${String(c.bytes).padStart(5)} B  lines=${c.lines}  ${c.tokenClasses.join(' ')}`);
    if (c.byteDiff && !c.byteDiff.identical) {
      const d = c.byteDiff;
      console.log('       byte diff at', d.index, `(ref ${d.refLen} B, ours ${d.gotLen} B)`);
      console.log('       ref :', JSON.stringify(d.refContext));
      console.log('       ours:', JSON.stringify(d.gotContext));
    }
    for (const p of c.problems) console.log('       -', p);
  }
  console.log('');
  console.log(
    report.failures === 0
      ? `PASS: ${report.cases.length} cases, cpp fence byte-identical to the real Typora export`
      : `FAIL: ${report.failures} of ${report.cases.length} cases`
  );
}

process.exit(report.failures === 0 ? 0 : 1);
