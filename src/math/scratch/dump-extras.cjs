// scratch/dump-extras.cjs — collect concrete facts for the evidence doc.
const core = require('../core.cjs');

const cases = [
  { name: 'inline-corpus', tex: 'E = mc^2', display: false, localID: 3 },
  { name: 'block-corpus', tex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', display: true, localID: 1 },
  { name: 'frac', tex: '\\frac{a}{b}', display: true, localID: 11 },
  { name: 'sqrt', tex: '\\sqrt{x^2+y^2}', display: true, localID: 12 },
  { name: 'aligned', tex: '\\begin{aligned}a&=b\\\\c&=d\\end{aligned}', display: true, localID: 13 },
];

(async () => {
  const out = [];
  for (const c of cases) {
    const html = await core.typeset(c.tex, { display: c.display, localID: c.localID });
    const attrs = /^<mjx-container([^>]*)>/.exec(html)[1];
    const svgAttrs = /<svg([^>]*)>/.exec(html)[1];
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    const uses = [...html.matchAll(/xlink:href="#([^"]+)"/g)].map((m) => m[1]);
    const nodes = [...html.matchAll(/data-mml-node="([^"]+)"/g)].map((m) => m[1]);
    out.push({
      name: c.name,
      tex: c.tex,
      display: c.display,
      bytes: html.length,
      containerAttrs: attrs,
      svgAttrs,
      firstIds: ids.slice(0, 3),
      idCount: ids.length,
      usesResolve: uses.every((u) => ids.includes(u)),
      mmlNodes: [...new Set(nodes)],
      hasAssistive: html.includes('mjx-assistive-mml'),
      hasAlt: /\salt="/.test(html),
      rect: (html.match(/<rect[^>]*><\/rect>/) || [null])[0],
    });
  }
  console.log(JSON.stringify(out, null, 1));
  await core.close();
})().catch(async (e) => {
  console.error(e);
  try { await core.close(); } catch (_) {}
  process.exit(1);
});
