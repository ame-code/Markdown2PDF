import { renderFence } from '../index.js';
import fs from 'node:fs';
const h = await renderFence('def greet(name):\n    # say hi\n    return f"hi {name}"\n\nprint(greet(\'typora\'))', 'python');
fs.writeFileSync('src/fence/scratch/py.html', h, 'utf8');
const i = h.indexOf('\u200b');
console.log('zwsp at', i);
console.log(JSON.stringify(h.slice(Math.max(0,i-320), i+120)));
console.log('--- all zwsp attrs:');
for (const m of h.matchAll(/<span[^>]*cm-[a-z]*zwsp[^>]*>[^<]*<\/span>/g)) console.log(JSON.stringify(m[0]));
