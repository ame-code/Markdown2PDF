// electron/main.cjs — packaged entry point (CommonJS on purpose)
//
// Electron 30's ESM main-process loader does not hand out usable bindings for
// the built-in `electron` module (import { app } fails, default import is
// undefined), so the entry stays CJS and pulls the ESM pipeline in with a
// dynamic import(). Everything below the entry is ordinary ESM.
//
// Engine note: Electron 30.0.9 carries Chromium 124.0.6367.233 — byte-for-byte
// the engine Typora 1.9.5 ships, so the packaged app needs no second runtime
// and no external browser.
// `require('electron')` inside Electron returns the built-in module; outside it
// returns the path to electron.exe. Fail loudly if ELECTRON_RUN_AS_NODE leaked
// into the environment, which turns the runtime into plain Node.
if (process.type !== 'browser') {
  process.stderr.write(
    'md2pdf: this executable must run as Electron, but the process type is '
    + JSON.stringify(process.type) + '.\n'
    + '   Unset ELECTRON_RUN_AS_NODE in your environment and retry.\n',
  );
  process.exit(78);
}

const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

// Printing rasterises on the CPU (Skia), so GPU acceleration buys nothing here
// and forces the bundle to carry libGLESv2/vk_swiftshader/d3dcompiler (~17 MB).
// Turning it off makes that dependency explicit instead of accidental.
app.disableHardwareAcceleration();

const ROOT = path.resolve(__dirname, '..');

const USAGE = [
  'md2pdf <input.md> [-o out.pdf] [options]',
  '',
  '  --theme <file|name>     theme css (default: my)',
  '  --paper A4|A3|Letter    paper size (default A4)',
  '  --header/--footer <tpl> e.g. "No. ${pageNo} / ${totalPages}"',
  '  --title/--author/--subject/--keywords',
  '  --toc-pages | --no-toc-pages   print page numbers in a [TOC] block (default on)',
  '  --toc-max-level <n>     deepest heading level listed in the TOC (default 6)',
  '  --html <file>           also write the intermediate HTML',
  '  --quiet                 only print the output path',
].join('\n');

function parseArgs(argv) {
  const o = {
    input: null, out: null, theme: 'my', paper: 'A4', header: null, footer: null,
    title: null, author: null, subject: null, keywords: null,
    tocPages: true, tocMaxLevel: null, quiet: false, html: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '-o': case '--out': o.out = next(); break;
      case '--theme': o.theme = next(); break;
      case '--paper': o.paper = next(); break;
      case '--header': o.header = next(); break;
      case '--footer': o.footer = next(); break;
      case '--title': o.title = next(); break;
      case '--author': o.author = next(); break;
      case '--subject': o.subject = next(); break;
      case '--keywords': o.keywords = next(); break;
      case '--html': o.html = next(); break;
      case '--toc-pages': o.tocPages = true; break;
      case '--no-toc-pages': o.tocPages = false; break;
      case '--toc-max-level': o.tocMaxLevel = Number(next()); break;
      case '--quiet': o.quiet = true; break;
      case '-h': case '--help': case '/?': o.help = true; break;
      default:
        if (a.startsWith('-')) throw new Error('unknown option: ' + a);
        else if (!o.input) o.input = a;
        else throw new Error('unexpected argument: ' + a);
    }
  }
  return o;
}

async function main() {
  // dev: [electron.exe, <app dir>, ...args]   packaged: [md2pdf.exe, ...args]
  const argv = process.argv.slice(app.isPackaged ? 1 : 2);
  const args = parseArgs(argv);
  if (args.help || !args.input) {
    process.stderr.write(USAGE + '\n');
    app.exit(args.help ? 0 : 2);
    return;
  }

  const inputPath = path.resolve(args.input);
  const markdown = await fs.readFile(inputPath, 'utf8');
  const outPath = args.out
    ? path.resolve(args.out)
    : inputPath.replace(/\.(md|markdown|txt)$/i, '') + '.pdf';

  const { build } = await import(pathToFileURL(path.join(ROOT, 'src', 'build.js')).href);
  const themePath = path.isAbsolute(args.theme) || /[\\/]/.test(args.theme)
    ? path.resolve(args.theme)
    : path.join(ROOT, 'vendor', 'themes', args.theme + '.css');

  const started = Date.now();
  const res = await build({
    markdown,
    baseDir: path.dirname(inputPath),
    themePath,
    title: args.title ?? '',
    outHtml: args.html ? path.resolve(args.html) : undefined,
    engine: 'electron',
    electron: { BrowserWindow },
    print: { paper: args.paper },
    header: args.header,
    footer: args.footer,
    filePath: outPath,
    meta: {
      title: args.title ?? '',
      author: args.author ?? '',
      subject: args.subject ?? '',
      keywords: args.keywords ? args.keywords.split(',').map((s) => s.trim()).filter(Boolean) : [],
    },
    tocPageNumbers: args.tocPages !== false,
    tocMaxLevel: args.tocMaxLevel || undefined,
  });

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, res.pdfBuffer);
  const ms = Date.now() - started;
  if (args.quiet) {
    process.stdout.write(outPath + '\n');
  } else {
    process.stdout.write(
      `${outPath}\n  ${res.pdfBuffer.length} bytes, ${ms} ms, toc=${res.hasToc}, math=${res.hasMath}, fence=${res.hasFence}\n`,
    );
  }
}

app.whenReady().then(async () => {
  try {
    await main();
    app.exit(0);
  } catch (e) {
    process.stderr.write('md2pdf: ' + (e && e.stack ? e.stack : e) + '\n');
    app.exit(1);
  }
});

app.on('window-all-closed', () => { /* the CLI owns the lifecycle */ });
