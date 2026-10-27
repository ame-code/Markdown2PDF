// src/postprocess.js — the PDF finishing stage of Typora's export
//
// Typora prints the content, then rebuilds the file with its own PDF library
// (frame.js 722500-730500): it embeds a per-page header/footer band PDF, sets
// Info metadata, and writes a bookmarks tree built from the heading matrix.
// The heading page/position comes from the `af://<cid>` link annotations that
// Chromium emits for the invisible print anchors — verified on the golden PDF
// (3 /Link annots, URIs af://n0, af://n2, https://example.com/).
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFNumber, PDFNull, PDFRef } from 'pdf-lib';

/** Map cid -> {page, top} from af:// link annotations (page is 0-based). */
export function extractAnchors(doc) {
  const ctx = doc.context;
  const out = new Map();
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const annots = pages[i].node.Annots();
    if (!annots) continue;
    const arr = annots instanceof PDFArray ? annots : ctx.lookup(annots);
    if (!arr) continue;
    for (let k = 0; k < arr.size(); k++) {
      const dict = ctx.lookup(arr.get(k), PDFDict);
      if (!dict) continue;
      const a = dict.get(PDFName.of('A'));
      const ad = a ? ctx.lookup(a, PDFDict) : null;
      if (!ad) continue;
      const u = ad.get(PDFName.of('URI'));
      if (!u) continue;
      const uri = u instanceof PDFString || u instanceof PDFHexString ? u.decodeText() : String(u);
      const m = /^af:\/\/(.+)$/.exec(uri);
      if (!m) continue;
      const rect = ctx.lookup(dict.get(PDFName.of('Rect')), PDFArray);
      let top = 0;
      if (rect) {
        const v = rect.asArray().map((x) => Number(x.toString()));
        top = Math.max(v[1], v[3]);
      }
      out.set(m[1], { page: i, top });
    }
  }
  return out;
}

/**
 * Write the bookmarks tree, exactly like Typora's TPDFOutLineMaker:
 * nested by heading level, destination = [page /XYZ null top null].
 * @param {Array<{level:number,title:string,page:number,top:number}>} entries
 */
export function addOutline(doc, entries) {
  if (!entries.length) return;
  const ctx = doc.context;
  const pages = doc.getPages();
  const pageRefs = pages.map((p) => p.ref);

  // build a tree: each level nests under the closest preceding lower level
  const root = { level: 0, children: [] };
  const stack = [root];
  for (const e of entries) {
    const node = { ...e, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= e.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  const refs = new Map();
  const alloc = (node) => {
    const ref = ctx.nextRef();
    refs.set(node, ref);
    for (const c of node.children) alloc(c);
    return ref;
  };
  const flatten = (node, sink) => { sink.push(node); for (const c of node.children) flatten(c, sink); return sink; };

  const rootRef = ctx.nextRef();
  root.children.forEach(alloc);

  const countAll = (nodes) => nodes.reduce((n, c) => n + 1 + countAll(c.children), 0);

  const write = (node, parentRef, prev, next) => {
    const ref = refs.get(node);
    const dict = ctx.obj({});
    dict.set(PDFName.of('Title'), PDFHexString.fromText(node.title || ''));
    dict.set(PDFName.of('Parent'), parentRef);
    if (prev) dict.set(PDFName.of('Prev'), prev);
    if (next) dict.set(PDFName.of('Next'), next);
    const pageRef = pageRefs[Math.min(node.page, pageRefs.length - 1)] || pageRefs[0];
    dict.set(
      PDFName.of('Dest'),
      ctx.obj([pageRef, PDFName.of('XYZ'), PDFNull, PDFNumber.of(node.top), PDFNull]),
    );
    if (node.children.length) {
      dict.set(PDFName.of('First'), refs.get(node.children[0]));
      dict.set(PDFName.of('Last'), refs.get(node.children[node.children.length - 1]));
      dict.set(PDFName.of('Count'), PDFNumber.of(countAll(node.children)));
    }
    ctx.assign(ref, dict);
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
      write(kids[i], ref, i > 0 ? refs.get(kids[i - 1]) : null, i + 1 < kids.length ? refs.get(kids[i + 1]) : null);
    }
  };
  const kids = root.children;
  for (let i = 0; i < kids.length; i++) {
    write(kids[i], rootRef, i > 0 ? refs.get(kids[i - 1]) : null, i + 1 < kids.length ? refs.get(kids[i + 1]) : null);
  }

  const rootDict = ctx.obj({});
  rootDict.set(PDFName.of('Type'), PDFName.of('Outlines'));
  rootDict.set(PDFName.of('First'), refs.get(kids[0]));
  rootDict.set(PDFName.of('Last'), refs.get(kids[kids.length - 1]));
  rootDict.set(PDFName.of('Count'), PDFNumber.of(countAll(kids)));
  ctx.assign(rootRef, rootDict);

  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

/** Load a band PDF (rendered by Chromium) and return it for embedding. */
export async function loadBandPdf(bytes) {
  return PDFDocument.load(bytes);
}

/**
 * Embed header/footer bands: per page, draw the band's page on top of the
 * content page — header at (0, pageHeight - bandHeight), footer at (0, 0)
 * (frame.js drawPage calls).
 */
export async function drawBands(doc, bands) {
  const { headerDoc, footerDoc } = bands;
  const pages = doc.getPages();
  if (headerDoc) {
    const embedded = await doc.embedPdf(headerDoc, headerDoc.getPageIndices());
    const bandH = headerDoc.getPage(0).getHeight();
    pages.forEach((p, i) => {
      const e = embedded[Math.min(i, embedded.length - 1)];
      p.drawPage(e, { x: 0, y: p.getHeight() - bandH });
    });
  }
  if (footerDoc) {
    const embedded = await doc.embedPdf(footerDoc, footerDoc.getPageIndices());
    pages.forEach((p, i) => {
      const e = embedded[Math.min(i, embedded.length - 1)];
      p.drawPage(e, { x: 0, y: 0 });
    });
  }
}

export const TPDF = {
  /** frame.js constants: pt-per-px and px-per-pt used by the band layout */
  pxPerPt: 1.3281472327365,
  ptPerPx: 1 / 1.3281472327365,
  bandPt: 30,
};

/**
 * Info dictionary, mirroring Typora's C()/m() (frame.js ~729700):
 * Creator defaults to "Typora", Producer is always "Typora, Electron".
 * Typora writes its own date strings, not strict PDF dates
 * (golden: CreationDate "20261006155042", ModDate "D:20261006155042Z"),
 * so `typoraDates: true` reproduces them byte-for-byte.
 */
export function setMetadata(doc, meta = {}, { typoraDates = true } = {}) {
  const ctx = doc.context;
  const info = doc.getInfoDict();
  const put = (key, value) => {
    if (value === undefined || value === null) return;
    info.set(PDFName.of(key), PDFHexString.fromText(String(value)));
  };
  put('Title', meta.title ?? '');
  put('Author', meta.author ?? '');
  put('Subject', meta.subject ?? '');
  put('Keywords', Array.isArray(meta.keywords) ? meta.keywords.join(', ') : meta.keywords);
  // PDFHexString keeps UTF-16 for CJK values, like pdf-lib's own setters.
  if (meta.creator !== null) put('Creator', meta.creator || 'Typora');
  put('Producer', 'Typora, Electron');

  const now = meta.date ? new Date(meta.date) : new Date();
  const stamp =
    now.getUTCFullYear().toString().padStart(4, '0') +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0') +
    String(now.getUTCHours()).padStart(2, '0') +
    String(now.getUTCMinutes()).padStart(2, '0') +
    String(now.getUTCSeconds()).padStart(2, '0');
  if (typoraDates) {
    info.set(PDFName.of('CreationDate'), PDFString.of(stamp));
    info.set(PDFName.of('ModDate'), PDFString.of('D:' + stamp + 'Z'));
  } else {
    doc.setCreationDate(now);
    doc.setModificationDate(now);
  }
  return doc;
}

/**
 * Full finishing stage: bands, outline, metadata, save.
 * @param {Uint8Array|ArrayBuffer} bytes  printed content PDF
 * @param {object} o
 * @param {Array} [o.headings]          [{level, cid, text}]
 * @param {object} [o.meta]             {title, author, subject, keywords}
 * @param {object} [o.bands]            {header: Uint8Array, footer: Uint8Array}
 * @param {boolean} [o.typoraDates=true]
 */
export async function finalizePdf(bytes, o = {}) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const anchorMap = o.headings && o.headings.length ? extractAnchors(doc) : new Map();

  if (o.bands && (o.bands.header || o.bands.footer)) {
    const headerDoc = o.bands.header ? await loadBandPdf(o.bands.header) : null;
    const footerDoc = o.bands.footer ? await loadBandPdf(o.bands.footer) : null;
    await drawBands(doc, { headerDoc, footerDoc });
  }

  if (o.headings && o.headings.length) {
    const entries = [];
    for (const h of o.headings) {
      const a = anchorMap.get('n' + h.cid) || anchorMap.get(String(h.cid));
      if (!a) continue; // heading without a printed anchor (e.g. inside a table cell)
      entries.push({ level: h.level, title: h.text, page: a.page, top: a.top });
    }
    addOutline(doc, entries);
  }

  setMetadata(doc, o.meta || {}, { typoraDates: o.typoraDates !== false });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
