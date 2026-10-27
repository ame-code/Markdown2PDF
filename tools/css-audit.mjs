// tools/css-audit.mjs — which rules of the vendored stylesheets actually apply?
//
// Opens a print-ready export (the same DOM the printer sees), emulates the
// `print` media type, walks every CSSStyleRule of the two Typora stylesheets and
// counts how many elements its selector matches. Rules that match nothing are
// candidates for removal; rules inside a non-print @media block never apply to
// the PDF at all.
//
// Usage: node tools/css-audit.mjs <export.html> [--json out.json]
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../src/print.js';

const args = process.argv.slice(2);
const jsonFlag = args.indexOf('--json');
const jsonOut = jsonFlag >= 0 ? args[jsonFlag + 1] : null;
const htmlPaths = args.filter((a, i) => !a.startsWith('--') && i !== jsonFlag + 1);

if (!htmlPaths.length) {
  process.stderr.write('usage: node tools/css-audit.mjs <export.html> [more.html…] [--json out.json]\n');
  process.exit(2);
}

const SHEETS = ['base.css', 'codemirror.css'];

// The sample documents may link either the original Typora sheets or the
// generated replacements; matching only depends on the DOM, so we always parse
// the ORIGINAL sheets and evaluate every selector against the sample. The
// originals live in evidence/css-originals (they are NOT shipped).
const SRC_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'evidence', 'css-originals');
const sheetUrls = SHEETS.map((name) => ({ name, url: pathToFileURL(path.join(SRC_DIR, name)).href }));

const browser = await launchBrowser({});
try {
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  await client.send('Emulation.setEmulatedMedia', { media: 'print' });

  // A rule counts as live if it matches in *any* sample document: each sample
  // covers different constructs (TOC, footnotes, task lists, math, images…).
  const union = new Map();
  let elemCount = 0;
  let lastReport = null;
  for (const htmlPath of htmlPaths) {
    await page.goto(pathToFileURL(path.resolve(htmlPath)).href, { waitUntil: 'load' });
    const report = await page.evaluate(async (sheets) => {
    const rows = [];
    // Rule identity across samples is its ORDINAL inside the sheet, not its
    // selector text: base.css/codemirror.css legitimately declare the same
    // selector several times (e.g. `p { orphans: 4 }` and `p { line-height:
    // inherit }`, or `.CodeMirror { position: relative }` and `.CodeMirror
    // { height: auto }`), and collapsing those would silently drop declarations.
    const counters = new Map();
    const walk = (rules, sheetName, media) => {
      for (const r of rules) {
        if (r.type === CSSRule.MEDIA_RULE) {
          walk(r.cssRules, sheetName, (media ? media + ' and ' : '') + r.conditionText);
          continue;
        }
        if (r.type === CSSRule.IMPORT_RULE) {
          rows.push({ sheet: sheetName, media, at: 'import', text: r.href, matches: null });
          continue;
        }
        if (r.type !== CSSRule.STYLE_RULE) {
          rows.push({ sheet: sheetName, media, at: 'other:' + r.type, text: r.cssText.slice(0, 120), matches: null });
          continue;
        }
        const ordinal = counters.get(sheetName) || 0;
        counters.set(sheetName, ordinal + 1);
        let matches = -1;
        try {
          matches = document.querySelectorAll(r.selectorText).length;
        } catch {
          matches = -2; // selector the engine cannot evaluate (e.g. ::-moz-*)
        }
        rows.push({
          sheet: sheetName,
          media,
          ordinal,
          selector: r.selectorText,
          declarations: r.style.length,
          matches,
          bytes: r.cssText.length,
          cssText: r.cssText,
        });
      }
    };
    for (const sheet of sheets) {
      try {
        const text = await (await fetch(sheet.url)).text();
        const parsed = new CSSStyleSheet();
        parsed.replaceSync(text);
        walk(parsed.cssRules, sheet.name, '');
      } catch (e) {
        rows.push({ sheet: sheet.name, media: '', at: 'unreadable', text: String(e) });
      }
    }
    return {
      sheets: [...document.styleSheets].map((s) => s.href),
      rules: rows,
      elemCount: document.querySelectorAll('*').length,
    };
  }, sheetUrls);

    lastReport = report;
    elemCount += report.elemCount;
    for (const r of report.rules) {
      const key = r.ordinal !== undefined
        ? [r.sheet, r.media, 'rule', r.ordinal].join('\u0000')
        : [r.sheet, r.media, r.at ?? '', r.selector ?? '', r.text ?? ''].join('\u0000');
      const prev = union.get(key);
      const m = r.matches ?? null;
      if (!prev) union.set(key, { ...r, samples: 1 });
      else {
        prev.samples += 1;
        if (m !== null) prev.matches = Math.max(prev.matches ?? 0, m);
      }
    }
  }

  const bySheet = new Map();
  for (const r of union.values()) {
    if (!bySheet.has(r.sheet)) bySheet.set(r.sheet, []);
    bySheet.get(r.sheet).push(r);
  }

  const isPrintActive = (media) => !media || media.includes('print');
  const summary = [];
  for (const [sheet, rows] of bySheet) {
    const styleRows = rows.filter((r) => r.selector !== undefined);
    const inactive = styleRows.filter((r) => !isPrintActive(r.media));
    const dead = styleRows.filter((r) => isPrintActive(r.media) && r.matches === 0);
    const live = styleRows.filter((r) => isPrintActive(r.media) && r.matches > 0);
    summary.push({
      sheet,
      total: styleRows.length,
      live: live.length,
      dead: dead.length,
      inactiveMedia: inactive.length,
      liveBytes: live.reduce((a, r) => a + r.bytes, 0),
      nonStyle: rows.length - styleRows.length,
    });
    process.stdout.write(
      `${sheet}: ${styleRows.length} style rules — live ${live.length}, match-nothing ${dead.length}, `
      + `screen-only ${inactive.length}, ${rows.length - styleRows.length} non-style\n`,
    );
    if (process.env.MDPDF_CSS_AUDIT_VERBOSE) {
      for (const r of inactive) process.stdout.write(`  [screen ] ${r.selector}\n`);
      for (const r of dead) process.stdout.write(`  [dead   ] ${r.selector}\n`);
    }
  }

  if (jsonOut) {
    await fs.mkdir(path.dirname(path.resolve(jsonOut)), { recursive: true });
    await fs.writeFile(
      jsonOut,
      JSON.stringify({ samples: htmlPaths, elemCount, summary, rules: [...union.values()] }, null, 1) + '\n',
      'utf8',
    );
    process.stdout.write(`wrote ${jsonOut}\n`);
  }
} finally {
  await browser.close();
}
