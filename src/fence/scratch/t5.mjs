import { renderFence, renderFences } from '../index.js';
import fs from 'node:fs';
const REF = 'E:\\work\\reverse\\reverse-typora-export\\evidence\\real-export-html-MATH.html';
const html = fs.readFileSync(REF,'utf8');
const start = html.indexOf('<pre class="md-fences');
let i = start, depth = 0;
for(;;){ const o = html.indexOf('<pre', i), c = html.indexOf('</pre>', i); if(c<0) break;
  if(o>=0 && o<c){ depth++; i=o+4; } else { depth--; i=c+6; if(depth===0) break; } }
const ref = html.slice(start, i);
const code = '#include <bits/stdc++.h>\nint main() { return 0; }';

const alone = await renderFence(code, 'cpp');
const batch = (await renderFences([{code, lang:'cpp'}, {code:'x=1', lang:'python'}, {code:'a', lang:''}]))[0];
const again = await renderFence(code, 'cpp');
console.log('alone==ref  ', alone === ref, alone.length, ref.length);
console.log('batch==ref  ', batch === ref);
console.log('repeatable  ', again === alone);
// no-lang shape
const noLang = await renderFence('plain text', '');
console.log('no-lang pre :', noLang.slice(0, noLang.indexOf('><div class="CodeMirror')));
console.log('no-lang wrap:', noLang.slice(noLang.indexOf('><div class="CodeMirror')+1, noLang.indexOf('"><div style=')+3));
// unknown lang shape
const unk = await renderFence('some plain\ntext', 'notalanguage');
console.log('unknown pre :', unk.slice(0, unk.indexOf('><div class="CodeMirror')));
