// tools/dump-annots.mjs — list link annotations (and their /A /URI) from a PDF
import fs from 'node:fs/promises';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString } from 'pdf-lib';

const file = process.argv[2];
const bytes = await fs.readFile(file);
const doc = await PDFDocument.load(bytes, { updateMetadata: false });
const ctx = doc.context;
const pages = doc.getPages();
console.log(`${file}: ${pages.length} page(s)`);
for (let i = 0; i < pages.length; i++) {
  const page = pages[i];
  const annots = page.node.Annots();
  if (!annots) { console.log(` page ${i + 1}: no annots`); continue; }
  const arr = annots instanceof PDFArray ? annots : ctx.lookup(annots);
  console.log(` page ${i + 1}: ${arr.size()} annot(s)`);
  for (let k = 0; k < arr.size(); k++) {
    const ref = arr.get(k);
    const dict = ctx.lookup(ref, PDFDict);
    if (!dict) continue;
    const sub = dict.get(PDFName.of('Subtype'));
    let uri = null;
    const a = dict.get(PDFName.of('A'));
    const ad = a ? ctx.lookup(a, PDFDict) : null;
    if (ad) {
      const u = ad.get(PDFName.of('URI'));
      if (u) uri = u instanceof PDFString || u instanceof PDFHexString ? u.decodeText() : String(u);
    }
    const rect = dict.get(PDFName.of('Rect'));
    const vals = rect && rect instanceof PDFArray ? rect.asArray().map((x) => Number(x.toString())) : [];
    console.log(`   #${k} Subtype=${sub ? sub.toString() : '?'} URI=${uri} Rect=[${vals.join(', ')}]`);
  }
}
