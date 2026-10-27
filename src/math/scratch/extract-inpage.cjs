// scratch/extract-inpage.cjs — move MATH_INPAGE out of index.js into a shared .cjs
const fs = require('fs');
const path = require('path');

const HERE = path.join(__dirname, '..');
const idx = path.join(HERE, 'index.js');
let src = fs.readFileSync(idx, 'utf8');

const START = 'export const MATH_INPAGE = String.raw`';
const END_MARK = 'window.md2pdfTyporaDisplayLines = md2pdfTyporaDisplayLines;\n`;';
const a = src.indexOf(START);
const bMark = src.indexOf(END_MARK);
if (a < 0 || bMark < 0) throw new Error('markers not found');
const end = bMark + END_MARK.length;
const block = src.slice(a, end); // includes "export const MATH_INPAGE = String.raw`...`;"

// body of the template literal, verbatim
const bodyStart = START.length;
const body = block.slice(bodyStart, block.length - 2); // drop trailing "`;"

const cjs =
  "'use strict';\n" +
  '/**\n' +
  ' * inpage.cjs — the browser-side renderer Typora-parity pipelines inject with\n' +
  ' * `page.evaluate(MATH_INPAGE)`.  Kept as a source STRING so it can be sent to\n' +
  ' * Chromium unchanged; it defines `window.md2pdfRenderMath(items)` and\n' +
  ' * `window.md2pdfTyporaDisplayLines(tex, display)`.\n' +
  ' */\n' +
  'const MATH_INPAGE = String.raw`' +
  body +
  '`;\n\nmodule.exports = { MATH_INPAGE };\n';

fs.writeFileSync(path.join(HERE, 'inpage.cjs'), cjs);

const replacement =
  "import inpage from './inpage.cjs';\n" +
  'export const MATH_INPAGE = inpage.MATH_INPAGE;';
src = src.slice(0, a) + replacement + src.slice(end);
fs.writeFileSync(idx, src);
console.log('inpage.cjs bytes=' + cjs.length + '  index.js trimmed to ' + src.length);
