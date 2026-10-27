#!/usr/bin/env node
// bin/md2pdf.js —?Markdown -> PDF, Typora 1.9.5 compatible
//
// Reproduces the shipped export pipeline: print DOM (Typora shapes) in
// Chromium 124, printToPDF with the recovered parameters, then the same
// post-processing Typora applies (header/footer bands, Info metadata, bookmarks).
import path from 'node:path';
import fs from 'node:fs/promises';
import process from 'node:process';
import { build, PAPER } from '../src/build.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');

const USAGE = `usage: md2pdf <input.md> [options]

  -o, --out <file>        output PDF (default: <input>.pdf)
      --theme <file|name> theme CSS (default: my) — name resolves to vendor/themes/<name>.css
      --paper <A4|A3|Letter>
      --footer <tpl>      e.g. "No. \${pageNo} / \${totalPages}"
      --header <tpl>
      --title <s>  --author <s>  --subject <s>  --keywords <a,b>
      --html <file>       also write the final print HTML
      --toc-pages         put page numbers in a \`[TOC]\` block (default)
      --no-toc-pages      \`[TOC]\` without page numbers
      --toc-max-level <n> deepest heading level listed in \`[TOC]\` (default 6)
      --no-postprocess    keep Chromium's raw PDF (no bands/metadata/bookmarks)
      --quiet
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '-o': case '--out': out.out = next(); break;
      case '--theme': out.theme = next(); break;
      case '--paper': out.paper = next(); break;
      case '--footer': out.footer = next(); break;
      case '--header': out.header = next(); break;
      case '--title': out.title = next(); break;
      case '--author': out.author = next(); break;
      case '--subject': out.subject = next(); break;
      case '--keywords': out.keywords = next(); break;
      case '--html': out.html = next(); break;
      case '--chrome': out.chrome = next(); break;
      case '--toc-pages': out.tocPages = true; break;
      case '--no-toc-pages': out.tocPages = false; break;
      case '--toc-max-level': out.tocMaxLevel = Number(next()); break;
      case '--no-postprocess': out.postprocess = false; break;
      case '--quiet': out.quiet = true; break;
      case '-h': case '--help': out.help = true; break;
      default:
        if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
        out._.push(a);
    }
  }
  return out;
}

async function resolveTheme(spec) {
  if (!spec) spec = 'my';
  if (/[\\/]/.test(spec) || /\.css$/i.test(spec)) {
    const p = path.resolve(spec);
    await fs.access(p);
    return p;
  }
  const p = path.join(ROOT, 'vendor', 'themes', `${spec}.css`);
  await fs.access(p).catch(() => {
    throw new Error(`theme "${spec}" not found (looked for ${p})`);
  });
  return p;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(e.message + '\n' + USAGE);
    process.exit(2);
  }
  if (args.help || !args._.length) {
    process.stdout.write(USAGE);
    process.exit(args.help ? 0 : 2);
  }

  const input = path.resolve(args._[0]);
  const md = await fs.readFile(input, 'utf8');
  const outPdf = path.resolve(args.out || input.replace(/\.(md|markdown|txt)$/i, '') + '.pdf');
  const themePath = await resolveTheme(args.theme);
  const paper = args.paper || 'A4';
  if (!PAPER[paper]) throw new Error(`unknown paper "${paper}" (A4|A3|Letter)`);

  const t0 = Date.now();
  const res = await build({
    markdown: md,
    baseDir: path.dirname(input),
    themePath,
    title: args.title ?? path.basename(input).replace(/\.[^.]+$/, ''),
    html: args.html,
    outHtml: args.html,
    chromePath: args.chrome,
    filePath: input,
    postprocess: args.postprocess !== false,
    print: { paper },
    footer: args.footer,
    header: args.header,
    tocPageNumbers: args.tocPages !== false,
    tocMaxLevel: args.tocMaxLevel,
    meta: {
      // Typora's export dialog leaves Title empty by default: the PDF Info
      // Title stays "" even though <title> gets the file stem.
      title: args.title ?? '',
      author: args.author,
      subject: args.subject,
      keywords: args.keywords ? args.keywords.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    },
  });

  await fs.mkdir(path.dirname(outPdf), { recursive: true });
  await fs.writeFile(outPdf, res.pdfBuffer);
  if (args.html && res.html) await fs.writeFile(path.resolve(args.html), res.html, 'utf8');

  if (!args.quiet) {
    process.stdout.write(
      `wrote ${outPdf} (${res.pdfBuffer.length} bytes, ${Date.now() - t0} ms)\n` +
        `  theme: ${themePath}\n  paper: ${paper}\n  fence: ${res.hasFence}  math: ${res.hasMath}  toc: ${res.hasToc}  headings: ${res.headings.length}\n`,
    );
  }
}

main().catch((e) => {
  process.stderr.write(`md2pdf: ${e && e.stack ? e.stack : e}\n`);
  process.exit(1);
});
