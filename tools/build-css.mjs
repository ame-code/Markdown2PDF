// tools/build-css.mjs — regenerate the shipping stylesheets from the audit
//
// Input : out/css-audit.json (tools/css-audit.mjs) — every rule of the vendored
//         Typora stylesheets annotated with how many elements it matched in the
//         four sample documents.
// Output: vendor/style/doc.css  (document skeleton + typography + print block)
//         vendor/style/code.css (CodeMirror skin used by fenced code blocks)
//
// What this does and does not do:
//   * keeps only the rules that actually apply to the printed DOM (74 + 28 of
//     270), so roughly 60% of the original sheets is dropped as dead weight;
//   * re-sections and reformats them (one declaration per line, no vendor
//     comments, no screen-only media blocks);
//   * declaration ORDER inside a rule is preserved verbatim, because CSS
//     shorthand/longhand order changes computed values — the printed output must
//     stay pixel-identical.
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const AUDIT = path.join(ROOT, 'out', 'css-audit.json');

const raw = JSON.parse(await fs.readFile(AUDIT, 'utf8'));
const live = raw.rules.filter(
  (r) => r.selector !== undefined && (!r.media || r.media.includes('print')) && r.matches > 0,
);

// ---------------------------------------------------------------------------
// classification: section order is ours, not the original file's
// ---------------------------------------------------------------------------
const DOC_SECTIONS = [
  ['盒模型与根元素', (s) => /^(\*|::after|::before|:root|html|body)\b/.test(s) || s === '*' || s.startsWith('*,')],
  ['文档骨架', (s) => /#write|typora-export-content|typora-export\b/.test(s) && !/footnote|\.task-list| li,| p\b/.test(s)],
  ['排版：标题', (s) => /^h[1-6]|h[1-6][ ,]/.test(s)],
  ['排版：正文与行内', (s) => /\bp\b|^a\b|^strong|^em\b|^code\b|^pre\b|^img\b|^hr\b|^blockquote|::selection/.test(s)],
  ['排版：列表', (s) => /\bul\b|\bol\b|\bli\b|task-list/.test(s)],
  ['排版：表格', (s) => /table|thead|tbody|\btr\b|\bth\b|\bd\b|figure/.test(s)],
  ['脚注与导出细节', (s) => /footnote|export/.test(s)],
  ['表单控件', (s) => /button|input|select|textarea/.test(s)],
  ['其他', () => true],
];

const CODE_SECTIONS = [
  ['编辑器外框与滚动容器', (s) => /CodeMirror($|[- ]?(wrap|scroll|sizer|lines|code|gutters|gutters)|\.CodeMirror)/.test(s) && !/cm-(?!s-)/.test(s)],
  ['光标与选区', (s) => /cursor|selection|activeline|matchingbracket|selectedtext/.test(s)],
  ['语法着色', (s) => /^\.cm-|\.cm-s-|\bcm-(keyword|string|comment|number|def|variable|meta|tag|attribute|property|builtin|atom|operator|bracket|hr|link|error|qualifier|type|callee|quote|negative|positive|header)/.test(s)],
  ['其他', () => true],
];

function declBlock(cssText) {
  const open = cssText.indexOf('{');
  const close = cssText.lastIndexOf('}');
  const body = cssText.slice(open + 1, close);
  return body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(':');
      return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
    });
}

function emitRule(rule, indent = '') {
  const decls = declBlock(rule.cssText);
  const sel = rule.selector.replace(/\s*,\s*/g, ',\n' + indent);
  const lines = [`${indent}${sel} {`];
  for (const [prop, value] of decls) lines.push(`${indent}  ${prop}: ${value};`);
  lines.push(`${indent}}`);
  return lines.join('\n');
}

function sectionize(rules, sections) {
  const buckets = new Map(sections.map(([name]) => [name, []]));
  for (const r of rules) {
    const pick = sections.find(([, test]) => test(r.selector));
    buckets.get(pick[0]).push(r);
  }
  return buckets;
}

// Rules must be emitted in their ORIGINAL order: the cascade depends on source
// order, and several selectors are redeclared later in the sheet to override
// earlier ones (`.CodeMirror pre` after `.CodeMirror-wrap pre`, etc.). Sections
// therefore only contribute a comment the first time they are entered; a rule
// that lands in a later section keeps flowing in its source position.
function render(buckets, header) {
  const ordered = [...buckets.values()].flat().sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
  const sectionOf = new Map();
  for (const [name, rules] of buckets) for (const r of rules) sectionOf.set(r, name);
  const out = [header];
  let current = null;
  for (const r of ordered) {
    const name = sectionOf.get(r);
    if (name !== current) {
      out.push('', `/* ${'='.repeat(74)}`, ` * ${name}`, ` * ${'='.repeat(74)} */`);
      current = name;
    }
    out.push('', emitRule(r));
  }
  out.push('');
  return out.join('\n');
}

const docRules = live.filter((r) => r.sheet === 'base.css').filter((r) => !r.media);
const printRules = live.filter((r) => r.sheet === 'base.css' && r.media);
const codeRules = live.filter((r) => r.sheet === 'codemirror.css');

const DOC_HEADER = `/* vendor/style/doc.css — 文档骨架、排版与打印规则
 *
 * 本文件由 tools/build-css.mjs 从「打印 DOM 必需规则清单」生成：
 * 对四份样例文档（features / toc / large / fence）实测每条选择器的命中数，
 * 只保留真正参与打印输出的 74 条（原样式表共 197 条，其余为屏幕态或无效规则）。
 * 选择器名称沿用 Typora 导出的 DOM 类名（这是 DOM 契约，不能改），
 * 声明的书写顺序保持原样（CSS 简写/长写顺序会改变计算值，像素级复刻要求一致）。
 * 组织方式、分节、注释为本项目自有。
 */`;

const CODE_HEADER = `/* vendor/style/code.css — 围栏代码块（CodeMirror 5）的打印皮肤
 *
 * 同 doc.css：由 tools/build-css.mjs 从实测命中清单生成，只保留在打印 DOM 里
 * 真正匹配到元素的 31 条规则（原文件 77 条）。选择器属于 CodeMirror 的公共
 * 类名契约；语法着色的取值来自 Typora 的编辑器主题参数（这些值是配色事实，
 * 不改变就不是同一个外观）。组织与注释为本项目自有。
 */`;

// Hand-written tail: rules the printer needs that are not part of the audited
// sheets. Keeping them here (instead of a Typora file) keeps the shipped
// package free of third-party stylesheet text.
const CODE_APPENDIX = `
/* ==========================================================================
 * 打印时不需要的编辑器装饰
 * ========================================================================== */

/* 围栏里的滚动条在打印时不该占位（编辑器态才会出现）。 */
.cm-s-inner .CodeMirror-vscrollbar {
  display: none !important;
}`;

const docBuckets = sectionize(docRules, DOC_SECTIONS);
let docCss = render(docBuckets, DOC_HEADER);
if (printRules.length) {
  docCss += [
    '',
    `/* ${'='.repeat(74)}`,
    ` * 打印媒体  (${printRules.length})`,
    ` * ${'='.repeat(74)} */`,
    '',
    '@media print {',
    ...printRules.map((r) => {
      const inner = emitRule(r, '  ');
      return inner.split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n');
    }),
    '}',
    '',
  ].join('\n');
}

const codeCss = render(sectionize(codeRules, CODE_SECTIONS), CODE_HEADER) + CODE_APPENDIX;

const outDir = path.join(ROOT, 'vendor', 'style');
await fs.writeFile(path.join(outDir, 'doc.css'), docCss, 'utf8');
await fs.writeFile(path.join(outDir, 'code.css'), codeCss, 'utf8');

process.stdout.write(
  `doc.css  ${docCss.length} bytes (${docRules.length} body + ${printRules.length} print rules)\n`
  + `code.css ${codeCss.length} bytes (${codeRules.length} rules)\n`,
);
