// src/session.js — the "live page" abstraction
//
// Two engines drive it:
//   • puppeteer: an external Chromium (124) launched over CDP — used by the CLI
//   • electron : the Electron main process' own BrowserWindow — used by the
//                packaged app, where Chromium already lives inside the runtime
//
// Both expose the same four operations build.js needs:
//   load(htmlPath)      navigate to a staged file and wait for __md2pdf_done
//   evaluate(fn, ...)   run a function inside the page, return its JSON value
//   addStyle(css)       append a <style> element
//   printToPDF(opts)    print the live page (options normalised below)
// plus printHtmlString() for the header/footer bands and close().
import path from 'node:path';
import fs from 'node:fs/promises';

// print.js pulls in puppeteer-core, so it is loaded lazily: the Electron build
// never touches it (the packaged app must not need an external Chromium).
let printMod = null;
async function printApi() {
  if (!printMod) printMod = await import('./print.js');
  return printMod;
}

const CONTENT_PRINT = { printBackground: false, paper: 'A4' };

/**
 * Translate the neutral print options into Electron's webContents.printToPDF
 * arguments, which is the very API Typora itself calls
 * ({printBackground, marginsType, pageSize} / marginsType 1 + zero margins for
 * the bands). Chromium's CDP spells the same thing as paperWidth/paperHeight in
 * inches, so the puppeteer side keeps using print.js.
 */
export function toElectronPrintOptions(opts = {}) {
  const o = { ...CONTENT_PRINT, ...opts };
  const out = { printBackground: !!o.printBackground };
  if (o.paperWidth && o.paperHeight) {
    out.pageSize = { width: o.paperWidth, height: o.paperHeight };
  } else {
    out.pageSize = o.paper || 'A4';
  }
  if (o.margins) {
    out.marginsType = 1; // none
    out.margins = {
      top: o.margins.top ?? 0,
      bottom: o.margins.bottom ?? 0,
      left: o.margins.left ?? 0,
      right: o.margins.right ?? 0,
    };
  } else {
    out.marginsType = 0; // Chromium's default 1cm — what Typora's content pass gets
  }
  return out;
}

class PuppeteerSession {
  constructor(browser) {
    this.browser = browser;
    this.page = null;
  }

  async load(htmlPath, { beforeSettle } = {}) {
    if (this.page) await this.page.close();
    const { loadHtmlPage } = await printApi();
    this.page = await loadHtmlPage(this.browser, htmlPath, {});
    if (beforeSettle) await beforeSettle(this);
    return this;
  }

  async waitForFunction(expr, { timeout = 30000 } = {}) {
    await this.page.waitForFunction(expr, { timeout });
  }

  async evaluate(fn, ...args) {
    return this.page.evaluate(fn, ...args);
  }

  async addStyle(css) {
    await this.page.addStyleTag({ content: css });
  }

  async printToPDF(opts = {}) {
    const { printPage } = await printApi();
    return printPage(this.page, { ...CONTENT_PRINT, ...opts });
  }

  async printHtmlString(html, opts = {}) {
    const { printHtmlString } = await printApi();
    // printHtmlString opens its own page; keep our current one untouched.
    return printHtmlString(this.browser, html, opts.tmpDir, opts);
  }

  async close() {
    if (this.page) { await this.page.close(); this.page = null; }
    if (this.browser) { await this.browser.close(); this.browser = null; }
  }
}

class ElectronSession {
  constructor(win, electron) {
    this.win = win;
    this.electron = electron;
    this.loaded = Promise.resolve();
  }

  async load(htmlPath, { beforeSettle, timeoutMs = 120000 } = {}) {
    const wc = this.win.webContents;
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('page load timed out')), timeoutMs);
      wc.once('did-fail-load', (_e, code, desc) => { clearTimeout(timer); reject(new Error(`did-fail-load ${code} ${desc}`)); });
      wc.once('did-finish-load', () => { clearTimeout(timer); resolve(); });
    });
    await this.win.loadFile(htmlPath);
    await done;
    // Wait for the in-page CodeMirror/MathJax pass, exactly like the CLI does.
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const state = await this.evaluate(() => ({
        done: window.__md2pdf_done === true,
        error: window.__md2pdf_error || null,
      }));
      if (state.error) throw new Error('in-page renderer failed: ' + state.error);
      if (state.done) break;
      if (Date.now() > deadline) throw new Error('in-page renderer timed out');
      await new Promise((r) => setTimeout(r, 50));
    }
    if (beforeSettle) await beforeSettle(this);
    return this;
  }

  async evaluate(fn, ...args) {
    const code = `(${fn.toString()})(${args.map((a) => JSON.stringify(a)).join(',')})`;
    return this.win.webContents.executeJavaScript(code, true);
  }

  /** Same contract as PuppeteerSession.waitForFunction: a JS expression string. */
  async waitForFunction(expr, { timeout = 30000 } = {}) {
    const deadline = Date.now() + timeout;
    for (;;) {
      const ok = await this.win.webContents.executeJavaScript(`!!(${expr})`, true);
      if (ok) return;
      if (Date.now() > deadline) throw new Error('waitForFunction timed out: ' + expr);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async addStyle(css) {
    await this.evaluate((c) => {
      const el = document.createElement('style');
      el.textContent = c;
      document.head.appendChild(el);
    }, css);
  }

  async printToPDF(opts = {}) {
    return this.win.webContents.printToPDF(toElectronPrintOptions(opts));
  }

  async printHtmlString(html, opts = {}) {
    const dir = opts.tmpDir || path.join(process.cwd(), 'out', 'tmp');
    await fs.mkdir(dir, { recursive: true });
    const p = path.join(dir, `band-${process.pid}-${Date.now()}.html`);
    await fs.writeFile(p, html, 'utf8');
    const win = new this.electron.BrowserWindow({
      show: false,
      width: 800,
      height: 200,
      webPreferences: { sandbox: false, contextIsolation: true },
    });
    try {
      await win.loadURL('file:///' + p.replace(/\\/g, '/'));
      return await win.webContents.printToPDF(toElectronPrintOptions(opts));
    } finally {
      win.destroy();
      await fs.rm(p, { force: true });
    }
  }

  async close() { /* the window is owned by main.js */ }
}

/** Electron-side helper: open a hidden window and wrap it as a session. */
export function createElectronSession(electron) {
  const dir = path.join(process.cwd(), 'out', 'tmp');
  const win = new electron.BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { offscreen: false, sandbox: false, contextIsolation: true },
  });
  return new ElectronSession(win, electron);
}

/**
 * Open the page engine.
 * @param {{engine?:'auto'|'puppeteer'|'electron', chromePath?:string, electron?:object}} o
 */
export async function openSession(o = {}) {
  const engine = o.engine || 'auto';
  if (engine === 'electron' || (engine === 'auto' && o.electron)) {
    return createElectronSession(o.electron);
  }
  const { launchBrowser } = await printApi();
  const browser = await launchBrowser(o.chromePath ? { executablePath: o.chromePath } : {});
  return new PuppeteerSession(browser);
}

/** Band print options: 30pt strip, zero margins on every side (Typora's pass). */
export function bandPrintOptions(pageWidthPt, heightPt) {
  return {
    printBackground: false,
    paperWidth: pageWidthPt / 72,
    paperHeight: heightPt / 72,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}
