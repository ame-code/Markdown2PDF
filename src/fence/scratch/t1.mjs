import { renderFence } from '../index.js';
const html = await renderFence('#include <bits/stdc++.h>\nint main() { return 0; }', 'cpp');
console.log(html);
