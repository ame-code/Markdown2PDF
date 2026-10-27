import crypto from 'node:crypto';
import fs from 'node:fs';
import { renderFence } from '../index.js';
const src = fs.readFileSync('E:\\work\\reverse\\reverse-typora-export\\evidence\\real-export-html-MATH.html','utf8');
const start = src.indexOf('<pre class="md-fences');
let i = start, depth = 0;
for(;;){ const o = src.indexOf('<pre', i), c = src.indexOf('</pre>', i); if(o>=0 && o<c){ depth++; i=o+4; } else { depth--; i=c+6; if(depth===0) break; } }
const ref = src.slice(start, i);
const ours = await renderFence('#include <bits/stdc++.h>\nint main() { return 0; }', 'cpp');
const h = (s)=>crypto.createHash('sha256').update(s,'utf8').digest('hex');
console.log(JSON.stringify({ refBytes: Buffer.byteLength(ref), refSha: h(ref), ourBytes: Buffer.byteLength(ours), ourSha: h(ours), identical: ref===ours }, null, 1));
fs.writeFileSync('src/fence/scratch/ref-fence.txt', ref, 'utf8');
