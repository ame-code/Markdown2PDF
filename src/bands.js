// src/bands.js — Typora's header/footer bands
//
// frame.js (exportPDF, ~726900-728200) renders one <p> per page into a temp
// HTML, prints that with pageSize = {width: pageWidthPt/72, height: 30/72}
// inches (marginsType 1, all margins 0) and then embeds the resulting pages,
// drawing the header at (0, pageHeight-30) and the footer at (0, 0).
//
// Layout constants recovered from the shipped code:
//   y = 1.3281472327365            (px per pt used for the band line box)
//   band height  = min(margin, 30) pt, default margin 30 => 30pt
//   p height/line-height = (30-8)*y px, font-size 12px (= 9pt in print)
import { escapeHtml } from './template.js';

export const BAND_PT = 30;
export const PX_PER_PT = 1.3281472327365;

/** Variables Typora substitutes in footer/header templates. */
export function expandTemplate(tpl, vars) {
  return String(tpl).replace(/\$\{([A-Za-z0-9_]+)\}/g, (all, name) => {
    const v = vars[name];
    return v === undefined || v === null ? all : String(v);
  });
}

/** One <p> per page, byte-shaped like frame.js. */
export function bandParagraphs(texts, { heightPt = BAND_PT, fontFamily = 'inherit', color = 'inherit', padLeft = 0, padRight = 0 } = {}) {
  const box = (heightPt - 8) * PX_PER_PT;
  const style =
    `font-size:12px;text-align:center;margin:0;padding:0 ${padRight}px 0 ${padLeft}px;` +
    `height:${box}px;line-height:${box}px;page-break-before:avoid;page-break-after:always;` +
    `font-family:${fontFamily};color:${color};`;
  return texts
    .map(
      (t) =>
        `<p style="${style}"><span style="display: inline-block;vertical-align: middle;">${escapeHtml(t)}</span></p>`,
    )
    .join('\n');
}

export function bandHtml(texts, opts = {}) {
  return (
    '<!doctype html>\n<html>\n<head><meta charset="UTF-8">' +
    '<style>html,body{margin:0;padding:0;}</style></head>\n<body>\n' +
    bandParagraphs(texts, opts) +
    '\n</body>\n</html>'
  );
}

/**
 * Render a band to a PDFDocument-ready buffer.
 * @param {object} session  a page session from src/session.js (puppeteer or electron)
 * @param {object} o
 * @param {string} o.template   e.g. "No. ${pageNo} / ${totalPages}"
 * @param {number} o.pageCount
 * @param {number} o.pageWidthPt
 * @param {object} [o.vars]     extra template variables (title, author, date…)
 * @param {string} [o.fontFamily] computed font-family of the printed body
 * @param {string} [o.color]    computed colour of the printed body
 */
export async function renderBand(session, o) {
  const {
    template,
    pageCount,
    pageWidthPt,
    vars = {},
    fontFamily = 'inherit',
    color = 'inherit',
    padLeft = 0,
    padRight = 0,
    heightPt = BAND_PT,
    tmpDir,
  } = o;
  const texts = [];
  for (let i = 1; i <= pageCount; i++) {
    texts.push(expandTemplate(template, { ...vars, pageNo: i, totalPages: pageCount, pageCount }));
  }
  const html = bandHtml(texts, { heightPt, fontFamily, color, padLeft, padRight });
  return session.printHtmlString(html, {
    tmpDir,
    paperWidth: pageWidthPt / 72,
    paperHeight: heightPt / 72,
    printBackground: false,
    margins: { top: 0, bottom: 0, left: 0, right: 0 }, // marginsType:1 + zeros
    settleMs: 0,
    blockNetwork: true,
  });
}
