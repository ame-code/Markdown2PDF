// Scratch: extract Typora 1.9.5 vendored assets into ../assets/ (idempotent).
// Usage: node src/fence/scratch/extract-assets.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FRAME = 'D:\\Typora\\resources\\appsrc\\window\\frame.js';
const STYLE = 'D:\\Typora\\resources\\style';
const LIBASAR = 'D:\\Typora\\resources\\lib.asar';
const ASSETS = path.join(__dirname, '..', 'assets');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const frame = fs.readFileSync(FRAME, 'utf8');
const frameSha = sha(fs.readFileSync(FRAME));

// Pull the SystemJS module body: registerDynamic("<name>", deps, executing, fn)
// body runs between `{...;` and the matching `}),System.registerDynamic("<next>"`.
function extractModule(name, nextName) {
  const start = frame.indexOf(`System.registerDynamic("${name}"`);
  if (start < 0) throw new Error(`module ${name} not found`);
  const open = frame.indexOf('{', frame.indexOf('function(', start));
  const next = frame.indexOf(`System.registerDynamic("${nextName}"`, start);
  if (next < 0) throw new Error(`module ${nextName} not found`);
  const end = frame.lastIndexOf('}),', next);
  const head = frame.slice(start, open + 1);
  const body = frame.slice(open + 1, end);
  return { start, head, body, bodyStart: open + 1, bodyEnd: end };
}

const assets = {};

// ---- 1. CodeMirror 5.26.0 core (module "20") ----------------------------
{
  const m = extractModule('20', '1c');
  const body = m.body.replace(/^\s*this\|\|self;/, ''); // "n.exports=function(){…}()"
  if (!/^n\.exports=function\(\)\{/.test(body)) throw new Error('unexpected module 20 shape');
  const js = `/*
 * CodeMirror 5.26.0 core -- body extracted verbatim from SystemJS module "20"
 * of Typora 1.9.5's D:\\Typora\\resources\\appsrc\\window\\frame.js
 * (frame.js sha256 ${frameSha}, module offsets ${m.bodyStart}..${m.bodyEnd}).
 * Only the SystemJS wrapper is replaced by a CommonJS-style shim
 * (function (require, exports, module) { ... })(null, exportsObj, moduleObj),
 * exactly mirroring SystemJS's registerDynamic execution semantics.
 *
 * CodeMirror is (c) Marijn Haverbeke and contributors, MIT licence.
 * https://github.com/codemirror/codemirror5/blob/5.26.0/LICENSE
 */
(function (global) {
  'use strict';
  var moduleObj = { exports: {} };
  var exportsObj = moduleObj.exports;
  (function (e, t, n) {
${body}
  })(null, exportsObj, moduleObj);
  global.CodeMirror = moduleObj.exports;
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
  assets['cm/codemirror5.js'] = js;
}

// ---- 2. CM5 addon: active line (module "38") ----------------------------
{
  const m = extractModule('38', '39');
  const body = m.body.replace(/^\s*this\|\|self;/, '');
  if (!/var i=e\("20"\)/.test(body)) throw new Error('unexpected module 38 shape');
  const js = `/*
 * CodeMirror 5 addon "active-line" -- body extracted verbatim from SystemJS
 * module "38" of Typora 1.9.5's frame.js (offsets ${m.bodyStart}..${m.bodyEnd}).
 * Typora sets styleActiveLine:true for every fence, so this addon is what
 * produces the <div class="CodeMirror-activeline"> wrapper and the
 * CodeMirror-activeline-background / CodeMirror-activeline-gutter children.
 *
 * CodeMirror is (c) Marijn Haverbeke and contributors, MIT licence.
 */
(function (global) {
  'use strict';
  var exportsObj = {};
  (function (require, exports, module) {
    var e = function (id) {
      if (id === '20') return global.CodeMirror;
      throw new Error('active-line: unexpected dependency ' + id);
    };
${body}
  })(null, exportsObj, { exports: exportsObj });
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
  assets['cm/active-line.js'] = js;
}

// ---- 3. Typora's language -> CodeMirror mode alias table -----------------
// frame.js: function u(e,t,n){ if(e) switch(e){ ... } }  (@82873)
{
  const uStart = frame.indexOf('function u(e,t,n){if(e)switch(e){');
  if (uStart < 0) throw new Error('u() not found');
  const uEnd = frame.indexOf('function M(e){var t;', uStart);
  if (uEnd < 0) throw new Error('u() end not found');
  const uBody = frame.slice(uStart, uEnd).replace(/,\s*$/, '');
  const js = `/*
 * Typora 1.9.5 language-alias -> CodeMirror mode lookup, extracted verbatim
 * from D:\\Typora\\resources\\appsrc\\window\\frame.js (offsets ${uStart}..${uEnd},
 * frame.js sha256 ${frameSha}).
 *
 * Original: function u(e, t, n) -- e: language token, t: return the CodeMirror
 * *mode name* string instead of a mode spec, n: same, for derived forms.
 * Typora's getCodeMirrorMode() normalises the fence language and then calls u().
 *
 * Typora source: proprietary (c) typora.io; only this alias table is reproduced
 * because a standalone renderer must pick the exact same CodeMirror mode.
 */
window.__typoraModeAlias = ${uBody};
`;
  assets['cm/tw-lang-mode.js'] = js;
}

// ---- 4. mode.min.js straight out of lib.asar ----------------------------
function readAsar(file) {
  const buf = fs.readFileSync(file);
  const header = JSON.parse(buf.slice(16, 16 + buf.readUInt32LE(12)).toString('utf8'));
  const dataOffset = 8 + buf.readUInt32LE(4);
  const out = {};
  (function walk(node, prefix) {
    for (const k of Object.keys(node.files || {})) {
      const f = node.files[k];
      const name = prefix + '/' + k;
      if (f.files) walk(f, name);
      else if (f.offset !== undefined) {
        out[name] = () => buf.slice(dataOffset + (+f.offset), dataOffset + (+f.offset) + (+f.size));
      }
    }
  })(header, '');
  return out;
}
const modeBytes = readAsar(LIBASAR)['/codemirror/mode.min.js']();
assets['cm/mode.min.js'] = modeBytes;

// ---- 5. Typora style CSS needed for metrics -----------------------------
const baseCss = fs.readFileSync(path.join(STYLE, 'base.css'), 'utf8');
// NOTE: an earlier revision emitted style/typora-metrics.css, a 12-rule subset
// of base.css. It was dropped in favour of the verbatim full base.css, which
// the export page actually loads and which makes cascade order trustworthy.

assets['style/typora-codemirror.css'] =
  "/* verbatim copy of D:\\Typora\\resources\\style\\codemirror.css (Typora 1.9.5).\n" +
  "   Derived from CodeMirror's MIT-licensed default theme + Typora tweaks. */\n" +
  fs.readFileSync(path.join(STYLE, 'codemirror.css'), 'utf8') + '\n';

const bcCss = fs.readFileSync(path.join(STYLE, 'base-control.css'), 'utf8');
const vsb = /\.cm-s-inner \.CodeMirror-vscrollbar\{[^}]*\}/.exec(bcCss);
assets['style/typora-base-control-subset.css'] =
  '/* subset of D:\\Typora\\resources\\style\\base-control.css (Typora 1.9.5) */\n' + (vsb ? vsb[0] : '') + '\n';

// ---- 6. base.css verbatim (typography + geometry the fence inherits) -----
// Shipped whole so that metric-visible rules (html/body font-size & line-height,
// #write padding, .md-fences, .CodeMirror pre/lines/gutters, --monospace) match
// the export DOM exactly. Proprietary (c) typora.io; reproduced for fidelity.
assets['style/typora-base.css'] =
  '/* verbatim copy of D:\\Typora\\resources\\style\\base.css (Typora 1.9.5) */\n' +
  fs.readFileSync(path.join(STYLE, 'base.css'), 'utf8') + '\n';

// ---- 7. metric-relevant subset of the *user* theme -----------------------
// The reference export (real-export-html-MATH.html) loads
// file://C:\Users\14578\AppData\Roaming\Typora\themes\my.css *after* base.css,
// so the html/body/.md-fences rules below are what actually shaped the
// measured geometry (html 16px, body line-height 1.6 -> 23.04px line box,
// .md-fences font-size .9em, .CodeMirror-lines padding-left 4px).
// User file, not Typora-shipped; copied verbatim (rule-by-rule, media blocks kept).
const THEME = 'C:\\Users\\14578\\AppData\\Roaming\\Typora\\themes\\my.css';
let themeCss = '';
try {
  const raw = fs.readFileSync(THEME, 'utf8');
  // Split into top-level rules: strip comments first, then walk braces so that
  // @media {...} blocks stay intact, then keep rules whose selector mentions the
  // elements/properties that affect fence geometry.
  const noComments = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let depth = 0, start = 0;
  for (let i = 0; i < noComments.length; i++) {
    const ch = noComments[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { rules.push(noComments.slice(start, i + 1)); start = i + 1; }
    }
  }
  const keep = /(^|[\s,>+~])(html|body|#write|pre|\.md-fences|code|tt|\.CodeMirror)/;
  themeCss = rules
    .map((r) => r.trim())
    .filter((r) => {
      if (!r) return false;
      const sel = r.slice(0, r.indexOf('{')).trim();
      return keep.test(sel) || /^@media/.test(sel);
    })
    .join('\n');
  assets['style/user-theme-metrics.css'] =
    '/* Metric-relevant rules copied verbatim from the *user* theme\n' +
    '   ' + THEME + '\n' +
    '   (loaded by the reference export after Typora\'s base.css).\n' +
    '   Not Typora-shipped; reproduced only to match this user\'s measured geometry. */\n' +
    themeCss + '\n';
} catch (e) {
  console.warn('user theme not readable, skipping:', e.message);
}

// ---- 8. hand-written shim: the `File` global Typora's patched CM expects ----
// Typora patched its CodeMirror copy to call back into the app through the
// global `File` object.  frame.js never defines it inside the CM core, so a
// standalone host must provide a stand-in or CodeMirror.init() throws
// "Cannot read properties of undefined (reading 'passiveEvents')".
//
// Enumerated from assets/cm/codemirror5.js (all ten references):
//   File.option.passiveEvents                (on(): passive addEventListener)
//   File.editor.sourceView[.inSourceMode]    (source-code-mode branch; undefined
//                                             in the WYSIWYG editor => else path)
//   File.editor.fences.isMousePressed        (value read, not called)
//   File.editor.selection.scrollAdjust(el)   (scroll-into-view sink)
//   File.isNode / File.changeCounter.withdrawAutoSaved()  (undo bookkeeping)
//   File.useCRLF                             (doc.lineSeparator(): "\r\n" : "\n")
//   File.isMac                               (context-menu word selection)
assets['cm/typora-globals.js'] =
  `/*
 * Stand-in for the host globals Typora's patched CodeMirror 5.26.0 reads.
 * Hand-written for the standalone renderer (NOT extracted from Typora).
 * Values chosen to follow the WYSIWYG (non source-mode) paths used during a
 * Typora export with the stock configuration probed for this project:
 *   - passiveEvents false  : plain addEventListener (no DOM effect)
 *   - isNode true, isMac false, useCRLF false : Windows, LF documents
 *   - sourceView left undefined : Typora only sets it in source-code mode
 *
 * NOTE: browsers have a native global File (the File constructor). It has no
 * .option, so presence alone is not a signal -- the stub replaces it (keeping
 * the native one on __mdpdfNativeFile) unless it already looks like ours.
 */
(function (global) {
  'use strict';
  var ours = global.File && global.File.option && typeof global.File.option.passiveEvents === 'boolean';
  if (ours) return;
  if (global.File) global.__mdpdfNativeFile = global.File;
  global.File = {
    option: { passiveEvents: false },
    isNode: true,
    isMac: false,
    isMacLegacy: false,
    isWK: false,
    useCRLF: false,
    changeCounter: { withdrawAutoSaved: function () { return false; } },
    editor: {
      fences: { isMousePressed: false },
      selection: { scrollAdjust: function () {} },
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;

// ---- write ---------------------------------------------------------------
const report = {};
for (const rel of Object.keys(assets)) {
  const p = path.join(ASSETS, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const buf = Buffer.isBuffer(assets[rel]) ? assets[rel] : Buffer.from(assets[rel]);
  fs.writeFileSync(p, buf);
  report[rel] = { bytes: buf.length, sha256: sha(buf) };
}
report._source = { frameJs: { path: FRAME, bytes: frame.length, sha256: frameSha }, libAsar: LIBASAR };
fs.writeFileSync(path.join(ASSETS, 'manifest.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
