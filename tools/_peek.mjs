import fs from 'node:fs';
const f = process.argv[2] || 'out/smoke.html';
const s = fs.readFileSync(f, 'utf8');
const i = s.indexOf("<div id='write'");
console.log(s.slice(i, i + 900));
