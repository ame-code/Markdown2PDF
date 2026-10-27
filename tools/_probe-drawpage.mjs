import { PDFDocument, StandardFonts } from 'pdf-lib';
import fs from 'node:fs';

const content = await PDFDocument.create();
const cp = content.addPage([200, 300]);
cp.drawText('CONTENT', { x: 10, y: 150, size: 10 });

const band = await PDFDocument.create();
const font = await band.embedFont(StandardFonts.Helvetica);
const bp = band.addPage([200, 30]);
bp.drawText('BAND25', { x: 10, y: 25, size: 8, font }); // near top of band (if y is up)
bp.drawText('BAND02', { x: 10, y: 2, size: 8, font });  // near bottom of band
const bandBytes = await band.save();

const doc = await PDFDocument.load(await content.save());
const src = await PDFDocument.load(bandBytes);
const [emb] = await doc.embedPdf(src, [0]);
doc.getPage(0).drawPage(emb, { x: 0, y: 0 });
await fs.promises.writeFile('out/probe-drawpage.pdf', await doc.save());
console.log('wrote out/probe-drawpage.pdf');
