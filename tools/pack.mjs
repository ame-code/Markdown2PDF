// tools/pack.mjs — build the standalone Electron app
//
// The packaged app contains: electron/main.cjs, src/, vendor/ and the runtime
// dependencies (markdown-it*, pdf-lib). It deliberately excludes everything
// that only exists for the逆向 workflow or the CLI: runtime/ (an external
// Chromium), out/, golden/, evidence/, report/, test/, tools/ and puppeteer-core.
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packagerMod = require('@electron/packager');
const packager = typeof packagerMod === 'function'
  ? packagerMod
  : (packagerMod.packager || packagerMod.default);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const KEEP = ['electron', 'src', 'vendor', 'package.json'];
const DROP_DIRS = ['runtime', 'out', 'golden', 'evidence', 'report', 'test', 'tools', 'notes', 'dist'];

// The exact production closure of the Electron app. Everything else under
// node_modules belongs to the CLI (puppeteer-core and friends) or to build
// tooling and would only bloat app.asar.
const RUNTIME_MODULES = [
  'markdown-it', 'argparse', 'entities', 'linkify-it', 'mdurl', 'punycode.js', 'uc.micro',
  'markdown-it-footnote', 'markdown-it-task-lists', 'markdown-it-mark', 'markdown-it-sub',
  'markdown-it-sup',
  'pdf-lib', '@pdf-lib', 'pako', 'tslib',
];

async function pruneNodeModules(buildPath) {
  const nm = path.join(buildPath, 'node_modules');
  const keep = new Set(RUNTIME_MODULES);
  let removed = 0;
  for (const ent of await fs.readdir(nm, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (keep.has(ent.name)) continue;
    await fs.rm(path.join(nm, ent.name), { recursive: true, force: true });
    removed += 1;
  }
  // Inside the @pdf-lib scope only two packages are used.
  const scope = path.join(nm, '@pdf-lib');
  if (await fs.stat(scope).then(() => true, () => false)) {
    for (const ent of await fs.readdir(scope)) {
      if (ent !== 'standard-fonts' && ent !== 'upng') {
        await fs.rm(path.join(scope, ent), { recursive: true, force: true });
      }
    }
  }
  // pdf-lib ships the same code five times (cjs/es/dist/src/ts3.4). Node loads
  // cjs/index.js (its "main"), so the UMD bundle, the TS sources and the
  // typescript-3.4 build are dead weight: 15 MB of the 18 MB package.
  for (const sub of ['dist', 'src', 'ts3.4', 'es']) {
    await fs.rm(path.join(nm, 'pdf-lib', sub), { recursive: true, force: true });
  }
  process.stdout.write(`pruned ${removed} node_modules directories\n`);
}

// A PATH-friendly launcher. The packaged directory is the Chromium runtime
// (exe + dlls + pak files), so putting it on PATH exposes a dozen unrelated
// files; `bin/` holds exactly one .cmd that forwards to the real exe, so the
// user adds `...\bin` to PATH and nothing else becomes visible.
//
// A symlink (or hardlink) to md2pdf.exe is NOT an option: Electron resolves
// `resources/app.asar`, `locales/`, `icudtl.dat` and the dlls relative to
// process.execPath, which would then be `<app>\bin\md2pdf.exe` and the app
// would fail to start.
const LAUNCHER_FILE = 'md2pdf.cmd';
const LAUNCHER_BODY = [
  '@echo off',
  'rem md2pdf - forwards to the unpacked app one level up (keeps PATH clean)',
  'rem Add this bin directory to PATH; do not move this file out of it.',
  '"%~dp0..\\md2pdf.exe" %*',
  '',
].join('\r\n');

async function writeLauncher(appDir) {
  const bin = path.join(appDir, 'bin');
  await fs.mkdir(bin, { recursive: true });
  await fs.writeFile(path.join(bin, LAUNCHER_FILE), LAUNCHER_BODY, 'utf8');
  return path.join(bin, LAUNCHER_FILE);
}

// A Windows shell shortcut next to the launcher. It is *not* a PATH entry —
// Windows never resolves `md2pdf` to a .lnk — its job is the mouse path: drop a
// .md file onto the icon and the file is converted next to its source. The
// shortcut goes through ShellExecute, so `process.execPath` is still the real
// md2pdf.exe and resources/locales resolve as usual.
function psQuote(p) {
  return "'" + String(p).replace(/'/g, "''") + "'";
}

async function writeShortcut(appDir) {
  const link = path.join(appDir, 'bin', 'md2pdf.lnk');
  const exe = path.join(appDir, 'md2pdf.exe');
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$ws = New-Object -ComObject WScript.Shell',
    `$s = $ws.CreateShortcut(${psQuote(link)})`,
    `$s.TargetPath = ${psQuote(exe)}`,
    `$s.IconLocation = ${psQuote(exe + ',0')}`,
    '$s.Description = "md2pdf - drag a .md file onto this icon to convert it"',
    '$s.Save()',
  ].join('; ');
  const { execFileSync } = await import('node:child_process');
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: 'pipe',
  });
  return link;
}

async function main() {
  const out = path.join(ROOT, 'dist');
  await fs.mkdir(out, { recursive: true });

  const ignore = [
    // only the app-relevant directories survive (node_modules is pruned below)
    new RegExp(`^/(?!(${KEEP.map((k) => k.replace('.', '\\.')).join('|')}|node_modules)(/|$))`),
    // puppeteer-core is CLI-only; the app uses Electron's own Chromium
    /^\/node_modules\/puppeteer-core/,
    /^\/node_modules\/@puppeteer/,
    /^\/electron\/main\.js(\.bak)?$/,
    // analysis scratch (probe scripts, captured fixtures) — not runtime code
    /^\/src\/(fence|math)\/scratch(\/|$)/,
  ];

  const packOpts = {
    dir: ROOT,
    name: 'md2pdf',
    appVersion: '1.0.0',
    platform: 'win32',
    arch: 'x64',
    out,
    overwrite: true,
    asar: true,
    prune: true,
    ignore,
    afterPrune: [async (args) => { await pruneNodeModules(args.buildPath); }],
    win32metadata: {
      CompanyName: 'markdown2pdf',
      FileDescription: 'Markdown to PDF (Typora-faithful)',
      OriginalFilename: 'md2pdf.exe',
      ProductName: 'md2pdf',
    },
  };

  // Packaging needs the official Electron zip. When the network is unavailable
  // an offline copy can be supplied: `MDPDF_ELECTRON_ZIP_DIR=<dir with
  // electron-v<version>-win32-x64.zip>` (make one from node_modules/electron/dist).
  if (process.env.MDPDF_ELECTRON_ZIP_DIR) {
    packOpts.electronZipDir = process.env.MDPDF_ELECTRON_ZIP_DIR;
    process.stdout.write(`using offline electron zip from ${packOpts.electronZipDir}\n`);
  }

  const paths = await packager(packOpts);

  for (const p of paths) {
    const st = await fs.stat(p);
    process.stdout.write(`${p}\n  ${st.isDirectory() ? 'directory' : 'file'}\n`);
  }

  // Chromium ships 55 locale packs (40 MB). The app only ever runs in one of
  // the two languages we keep; Chromium falls back to en-US for the rest.
  const KEEP_LOCALES = new Set(['en-US.pak', 'zh-CN.pak']);
  let droppedLocales = 0;
  for (const p of paths) {
    const dir = path.join(p, 'locales');
    if (!(await fs.stat(dir).then(() => true, () => false))) continue;
    for (const f of await fs.readdir(dir)) {
      if (KEEP_LOCALES.has(f)) continue;
      await fs.rm(path.join(dir, f), { force: true });
      droppedLocales += 1;
    }
  }
  process.stdout.write(`kept ${KEEP_LOCALES.size} locale packs (dropped ${droppedLocales})\n`);

  // The app calls app.disableHardwareAcceleration() and only rasterises for
  // printing, so the GPU stack never loads. Dropping it saves ~17 MB.
  const DROP_DLLS = [
    'libGLESv2.dll', 'libEGL.dll', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json',
    'd3dcompiler_47.dll',
  ];
  let droppedDlls = 0;
  for (const p of paths) {
    for (const f of DROP_DLLS) {
      const target = path.join(p, f);
      if (await fs.stat(target).then(() => true, () => false)) {
        await fs.rm(target, { force: true });
        droppedDlls += 1;
      }
    }
  }
  process.stdout.write(`dropped ${droppedDlls} GPU libraries\n`);

  for (const p of paths) {
    const st = await fs.stat(p);
    if (!st.isDirectory()) continue;
    const launcher = await writeLauncher(p);
    const shortcut = await writeShortcut(p);
    // Ship the usage notes next to the exe: the zip contains no source tree, and
    // the person receiving it should not have to look anything up.
    await fs.copyFile(path.join(ROOT, 'README.md'), path.join(p, 'README.md'));
    process.stdout.write(
      `launcher: ${path.relative(ROOT, launcher)} + ${path.basename(shortcut)} (+ README.md)\n`,
    );
  }

  process.stdout.write(`drop dirs (must not be in the bundle): ${DROP_DIRS.join(', ')}\n`);
}

main().catch((e) => {
  process.stderr.write((e && e.stack ? e.stack : String(e)) + '\n');
  process.exit(1);
});
