#!/usr/bin/env node
// tools/bootstrap.mjs
// Restore everything that is deliberately not in git, on a fresh clone:
//
//   node_modules/            -> npm ci
//   runtime/chromium-124/    -> Playwright build 1112 (Chromium 124.0.6367.29)
//   runtime/**/locales       -> trimmed to en-US + zh-CN (saves ~40 MB)
//
// Usage:
//   npm run bootstrap              # install what is missing
//   npm run bootstrap -- --force   # redo both steps from scratch
//   npm run bootstrap -- --check    # only report what is missing, exit 1 if any
//   npm run bootstrap -- --no-trim  # keep all locale .pak files
//
// Offline: set MDPDF_CHROMIUM_ZIP to a chromium-win64.zip (Playwright build 1112)
// and MDPDF_ELECTRON_ZIP_DIR to a directory holding
// electron-v30.0.9-win32-x64.zip before running; npm ci still needs the registry
// unless node_modules is copied over.
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CHROME_DIR = path.join(ROOT, 'runtime', 'chromium-124');
const CHROME_EXE = path.join(CHROME_DIR, 'chrome.exe');
const CHROME_ZIP_NAME = 'chromium-win64.zip';
const CHROME_URLS = [
  'https://cdn.playwright.dev/builds/chromium/1112/chromium-win64.zip',
];
const KEEP_LOCALES = new Set(['en-US.pak', 'zh-CN.pak']);

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CHECK = argv.includes('--check');
const TRIM = !argv.includes('--no-trim');

const ok = (m) => process.stdout.write(`  ok   ${m}\n`);
const warn = (m) => process.stdout.write(`  warn ${m}\n`);
const step = (m) => process.stdout.write(`\n${m}\n`);
const pad = (m) => `  ..   ${m}`;

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else try { total += statSync(p).size; } catch { /* ignore */ }
    }
  };
  walk(dir);
  return total;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, shell: false, ...opts });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (exit ${res.status})`);
}

// ---------------------------------------------------------------- node / deps
function checkNode() {
  step('[1/3] node');
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) throw new Error(`Node ${process.versions.node} is too old, need >= 20`);
  ok(`node ${process.versions.node} (${process.platform}-${process.arch})`);
}

function checkDeps() {
  step('[2/3] node_modules');
  const marker = path.join(ROOT, 'node_modules', 'puppeteer-core', 'package.json');
  const electronExe = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  const needInstall = FORCE || !existsSync(marker);
  if (CHECK) {
    if (!existsSync(marker)) warn('node_modules missing — run: npm ci');
    else ok('node_modules present');
    if (!existsSync(electronExe)) warn('electron binary missing — check the npm ci output (postinstall downloads it)');
    return;
  }
  if (needInstall) {
    process.stdout.write(pad('running npm ci (installs pdf-lib/markdown-it + electron 30.0.9)\n'));
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci']);
    ok('npm ci finished');
  } else {
    ok('node_modules already present');
  }
  if (existsSync(electronExe)) ok(`electron ${readFileSync(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8').match(/"version":\s*"([^"]+)"/)?.[1] ?? '?'}`);
  else warn('electron binary missing (only needed for `npx electron .` and `npm run pack`)');
}

// ------------------------------------------------------------------- download
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('too many redirects'));
    const req = https.get(url, { headers: { 'user-agent': 'md2pdf-bootstrap' } }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        const next = new URL(headers.location, url).href;
        return resolve(download(next, dest, redirects + 1));
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode} for ${url}`));
      }
      const total = Number(headers['content-length'] || 0);
      let got = 0;
      let lastPrint = 0;
      const out = createWriteStream(dest);
      res.on('data', (chunk) => {
        got += chunk.length;
        if (total && Date.now() - lastPrint > 800) {
          lastPrint = Date.now();
          process.stdout.write(`\r${pad(`downloading ${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB (${Math.round((got / total) * 100)}%)`)}`);
        }
      });
      res.pipe(out);
      out.on('finish', () => {
        if (total) process.stdout.write('\r\x1b[K');
        out.close(() => resolve(dest));
      });
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('download timed out')));
  });
}

function expandArchive(zip, destDir) {
  const ps = [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
  ];
  run('powershell.exe', ps);
}

// -------------------------------------------------------------------- chromium
async function ensureChromium() {
  step('[3/3] Chromium 124 (runtime/chromium-124)');
  if (existsSync(CHROME_EXE) && !FORCE) {
    ok(`${CHROME_EXE} (${mb(dirSize(CHROME_DIR))})`);
    trimLocales();
    return;
  }
  if (CHECK) {
    warn('runtime/chromium-124/chrome.exe missing — run: npm run bootstrap');
    return;
  }

  const tmp = path.join(os.tmpdir(), `md2pdf-bootstrap-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  // Extract on the same volume as the destination: a cross-volume rename fails
  // with EXDEV (zip lands in %TEMP% on C:, the runtime lives wherever the repo is).
  const stage = path.join(ROOT, 'runtime', `.bootstrap-${process.pid}`);
  const localZip = process.env.MDPDF_CHROMIUM_ZIP;
  let zip;
  try {
    if (localZip && existsSync(localZip)) {
      zip = localZip;
      ok(`using local zip ${localZip}`);
    } else {
      zip = path.join(tmp, CHROME_ZIP_NAME);
      let lastErr;
      for (const url of CHROME_URLS) {
        try {
          process.stdout.write(pad(`fetching ${url}\n`));
          await download(url, zip);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          warn(`${url} -> ${err.message}`);
        }
      }
      if (lastErr) {
        throw new Error(
          `could not download Chromium 124 (${lastErr.message}).\n` +
            '  Offline fix: download chromium-win64.zip (Playwright build 1112) yourself,\n' +
            '  then run: MDPDF_CHROMIUM_ZIP=<path to zip> npm run bootstrap',
        );
      }
      ok(`downloaded ${mb(statSync(zip).size)}`);
    }

    const unpack = path.join(stage, 'unpack');
    mkdirSync(unpack, { recursive: true });
    expandArchive(zip, unpack);
    // Playwright zips contain chrome-win/ (or chrome-win64/ on newer builds).
    const inner = ['chrome-win', 'chrome-win64']
      .map((d) => path.join(unpack, d))
      .find((d) => existsSync(path.join(d, 'chrome.exe')));
    if (!inner) throw new Error('zip does not contain chrome-win/chrome.exe');

    if (existsSync(CHROME_DIR)) rmSync(CHROME_DIR, { recursive: true, force: true });
    mkdirSync(CHROME_DIR, { recursive: true });
    for (const e of readdirSync(inner)) {
      renameSync(path.join(inner, e), path.join(CHROME_DIR, e));
    }
    ok(`installed ${mb(dirSize(CHROME_DIR))} -> ${CHROME_DIR}`);
    trimLocales();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(stage, { recursive: true, force: true });
  }
}

function trimLocales() {
  const loc = path.join(CHROME_DIR, 'locales');
  if (!existsSync(loc)) return;
  const all = readdirSync(loc);
  if (all.length <= KEEP_LOCALES.size + 1) return;
  if (!TRIM) {
    ok(`kept all ${all.length} locale packs (--no-trim)`);
    return;
  }
  let dropped = 0;
  for (const f of all) {
    if (KEEP_LOCALES.has(f)) continue;
    rmSync(path.join(loc, f), { force: true });
    dropped += 1;
  }
  ok(`locales trimmed: kept en-US + zh-CN, dropped ${dropped} packs`);
}

// ----------------------------------------------------------------------- main
async function main() {
  process.stdout.write('md2pdf bootstrap — restoring files that git does not carry\n');
  checkNode();
  checkDeps();
  await ensureChromium();

  step('next');
  const chromeOk = existsSync(CHROME_EXE);
  if (checkSummary({ chromeOk })) return;
}

function checkSummary({ chromeOk }) {
  if (CHECK) {
    const missing = [];
    if (!existsSync(path.join(ROOT, 'node_modules', 'puppeteer-core', 'package.json'))) missing.push('node_modules');
    if (!chromeOk) missing.push('runtime/chromium-124');
    if (missing.length) {
      process.stdout.write(`\nmissing: ${missing.join(', ')}\n`);
      process.exitCode = 1;
      return true;
    }
    process.stdout.write('\nall set\n');
    return true;
  }
  process.stdout.write(
    [
      '  try it:      npm test',
      '  CLI:         node bin/md2pdf.js golden/typora-export-test.md -o out/first.pdf',
      '  Electron:    npx electron . golden/typora-export-test.md -o out/first-electron.pdf',
      '  package:     npm run pack        (needs network, or MDPDF_ELECTRON_ZIP_DIR)',
      '  portable exe: download md2pdf-win32-x64.zip from GitHub Releases instead',
      '',
    ].join('\n'),
  );
  return true;
}

main().catch((err) => {
  process.stderr.write(`\nmd2pdf bootstrap: ${err.message}\n`);
  process.exitCode = 1;
});
