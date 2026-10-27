// src/toc.js — `[TOC]` block with chapter page numbers.
//
// Typora 1.9.5's shipped base.css already defines the TOC typography we should
// inherit (`.md-toc`, `.md-toc-content`, `.md-toc-item`, `.md-toc-h1..h6`,
// `.md-toc-inner`: font-size .9rem, colour #4183c4, 2em indent per level,
// .footnote spacing), so the markup below uses exactly those class names and
// only adds what page numbers need: a flex row, a dotted leader, the number.
//
// The page numbers themselves are an extension: Typora's export TOC has none,
// and its export markup is not attested by any artifact we hold
// (evidence/dom-spec.md UNKNOWN b). Numbers come from the `af://` link
// annotations Chromium emits for the invisible `<a name="header-nC">` anchors —
// the same map Typora's bookmark post-processing reads (frame.js ~722500).

/** Placeholder emitted by md2typora; replaced once the headings are known. */
export const TOC_PLACEHOLDER = '<div class="md-toc" data-mdpdf-toc=""></div>';

/**
 * Only the additions: base.css already styles .md-toc / .md-toc-item /
 * .md-toc-inner / .md-toc-hN, and the user theme may override them.
 */
export const TOC_CSS = `
.md-toc-item > a.md-toc-inner{display:flex;align-items:baseline;}
.md-toc-item{padding-right:0;}
.md-toc-text{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.md-toc-leader{flex:1 1 auto;min-width:1.5em;margin:0 .35em;border-bottom:1px dotted rgba(0,0,0,.30);transform:translateY(-0.30em);}
.md-toc-page{flex:0 0 auto;font-variant-numeric:tabular-nums;padding-left:.2em;}
@media print{.md-toc-item > a.md-toc-inner{color:inherit;}}
`;

/**
 * The headings that go into the TOC.
 * @param {Array<{level:number,cid:number,text:string}>} headings
 * @param {{maxLevel?:number}} [opts]
 */
export function collectTocEntries(headings, opts = {}) {
  const maxLevel = opts.maxLevel || 6;
  return headings
    .map((h) => ({ level: h.level, cid: h.cid, text: String(h.text || '').trim() }))
    .filter((h) => h.level >= 1 && h.level <= maxLevel && h.text);
}

function escText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Render the TOC block.
 * @param {Array<{level:number,cid:number,text:string}>} headings
 * @param {{pages?:Map<number,number>, pageNumbers?:boolean, maxLevel?:number}} [opts]
 *   `pages` maps a heading cid to its 1-based page number.
 */
export function renderToc(headings, opts = {}) {
  const pageNumbers = opts.pageNumbers !== false;
  const entries = collectTocEntries(headings, opts);
  if (!entries.length) return '';
  const items = entries.map((h) => {
    const num = opts.pages ? opts.pages.get(h.cid) : undefined;
    const page = pageNumbers
      ? `<span class="md-toc-page">${num == null ? '' : num}</span>`
      : '';
    return (
      `<div class="md-toc-item md-toc-h${h.level}">` +
      `<a class="md-toc-inner" href="#header-n${h.cid}">` +
      `<span class="md-toc-text">${escText(h.text)}</span>` +
      '<span class="md-toc-leader"></span>' +
      page +
      '</a></div>'
    );
  }).join('');
  return `<div class="md-toc" mdtype="toc" data-mdpdf-toc="1"><div class="md-toc-content">${items}</div></div>`;
}

/**
 * Replace the placeholder in a rendered body.
 * @returns {{body:string, hasToc:boolean}}
 */
export function injectToc(body, headings, opts = {}) {
  if (!body.includes(TOC_PLACEHOLDER)) return { body, hasToc: false };
  const toc = renderToc(headings, opts);
  return { body: body.replace(TOC_PLACEHOLDER, () => toc || ''), hasToc: true };
}
