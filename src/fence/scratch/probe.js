// scratch: render the reference cpp fence and diff it against the real export.
// Usage: node src/fence/scratch/probe.js
'use strict';
const fs = require('fs');
const path = require('path');
const { renderFences } = require('..');

const REF = 'E:\\work\\reverse\\reverse-typora-export\\evidence\\real-export-html-MATH.html';
const CODE = '#include <bits/stdc++.h>\nint main() { return 0; }';

function extractFirstFence(html) {
  const start = html.indexOf('<pre class="md-fences');
  const end = html.indexOf('</pre>', start) + '</pre>'.length;
  return html.slice(start, end);
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

(async () => {
  const real = extractFirstFence(fs.readFileSync(REF, 'utf8'));
  const code = process.env.PROBE_CODE || CODE;
  const [mine] = await renderFences([{ code, lang: 'cpp' }]);

  console.log('=== REAL (' + real.length + ' B) ===');
  console.log(real);
  console.log('=== MINE (' + mine.length + ' B) ===');
  console.log(mine);

  const d = firstDiff(real, mine);
  if (d < 0) {
    console.log('\n*** BYTE-IDENTICAL ***');
  } else {
    console.log('\nfirst diff at char ' + d);
    console.log('real: ' + JSON.stringify(real.slice(Math.max(0, d - 90), d + 130)));
    console.log('mine: ' + JSON.stringify(mine.slice(Math.max(0, d - 90), d + 130)));
  }
  fs.writeFileSync(path.join(__dirname, 'probe-real.html'), real + '\n');
  fs.writeFileSync(path.join(__dirname, 'probe-mine.html'), mine + '\n');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
