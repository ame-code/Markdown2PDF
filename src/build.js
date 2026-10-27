// src/build.js — Markdown file -> Typora-faithful print HTML -> PDF
//
// Flow (mirrors Typora's own two-step export, frame.js 708929 / 726058):
//   1. Markdown -> print body with placeholders for fenced code and math
//   2. stage-1 HTML: shell + payload + renderer scripts
//   3. headless Chromium 124 renders it, in-page CodeMirror/MathJax fill the
//      placeholders (this is what Typora's editor does before serializing)
//   4. the same live page is printed with the recovered printToPDF parameters
//   5. PDF post-processing: header/footer bands, metadata, outline
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { createMarkdown, renderDocument, escDQ } from './md2typora.js';
import { buildDocument, linkTag } from './template.js';
import { PAPER } from './paper.js';
import { openSession } from './session.js';
import { finalizePdf, extractAnchors } from './postprocess.js';
import { renderBand, BAND_PT } from './bands.js';
import { TOC_PLACEHOLDER, TOC_CSS, injectToc } from './toc.js';
import { PDFDocument } from 'pdf-lib';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(HERE, '..');
const VENDOR = path.join(ROOT, 'vendor');

function toPosix(p) { return p.replace(/\\/g, '/'); }
function fileHref(p) { return 'file:///' + toPosix(path.resolve(p)); }

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

/** Load the real renderer modules when teammates have delivered them. */
async function loadRenderers() {
  const fallback = await import('./renderers/fallback.js');
  let fence = fallback; let math = fallback;
  const fencePath = path.join(HERE, 'fence', 'index.js');
  const mathPath = path.join(HERE, 'math', 'index.js');
  if (await exists(fencePath)) {
    try { fence = { ...fallback, ...(await import(new URL('./fence/index.js', import.meta.url).href)) }; } catch (e) {
      console.warn('[build] src/fence/index.js failed to load, using fallback:', e.message);
    }
  }
  if (await exists(mathPath)) {
    try { math = { ...fallback, ...(await import(new URL('./math/index.js', import.meta.url).href)) }; } catch (e) {
      console.warn('[build] src/math/index.js failed to load, using fallback:', e.message);
    }
  }
  return { fence, math };
}

/**
 * Build the print body HTML plus the render payload.
 * @returns {{body:string, payload:{fences:Array,math:Array}, headings:Array, hasMath:boolean}}
 */
export function buildPrintBody(markdown, opts = {}) {
  const {
    baseDir = process.cwd(),
    enableInlineMath = true,
    markdownOptions = {},
    tocPages = null,
    tocPageNumbers = true,
    tocMaxLevel,
  } = opts;
  const fences = [];
  const math = [];

  const fmtFileUrl = (raw) => {
    let src = String(raw).trim();
    if (!src) return src;
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return src; // absolute URL / data: / file:
    const abs = path.resolve(baseDir, decodeURI(src.replace(/^\.\//, '')));
    return fileHref(abs) + (opts.imageCacheBust === false ? '' : '?lastModify=' + Date.now());
  };

  const hooks = {
    toc: () => TOC_PLACEHOLDER,
    fence(code, info, { cid }) {
      const lang = String(info || '').trim().split(/\s+/)[0] || '';
      const index = fences.length;
      fences.push({ index, code, lang });
      return `<pre class="md-fences md-end-block ty-contain-cm" spellcheck="false"${lang ? ` lang="${escDQ(lang)}"` : ''} data-mdpdf-fence="${index}"></pre>`;
    },
    inlineMath(tex) {
      const index = math.length;
      math.push({ index, kind: 'inline', tex });
      return `<span data-mdpdf-math-inline="${index}"></span>`;
    },
    blockMath(tex, { cid }) {
      const index = math.length;
      math.push({ index, kind: 'block', tex });
      return (
        `<div contenteditable="false" spellcheck="false" class="mathjax-block md-end-block md-math-block md-rawblock" ` +
        `id="mathjax-n${cid}" cid="n${cid}" mdtype="math_block" data-math-tag-before="0" data-math-tag-after="0" ` +
        `data-math-labels="[]" data-mdpdf-math-block="${index}"><div class="md-math-container"></div></div>`
      );
    },
    resolveImage: fmtFileUrl,
  };

  const md = createMarkdown({ enableInlineMath, ...markdownOptions });
  const rendered = renderDocument(md, markdown, hooks);
  const { body, hasToc } = injectToc(rendered.body, rendered.headings, {
    pages: tocPages,
    pageNumbers: tocPageNumbers,
    maxLevel: tocMaxLevel,
  });
  return {
    body,
    payload: { fences, math },
    headings: rendered.headings,
    hasToc,
    hasMath: math.length > 0,
    hasFence: fences.length > 0,
  };
}

/** Compose the stylesheet links Typora emits (built-in CSS, then the theme). */
export function styleLinks(themePath) {
  const links = [];
  // doc.css + code.css are our regenerated equivalents of Typora's base.css and
  // codemirror.css (see tools/build-css.mjs): only the rules that actually apply
  // to the printed DOM survive, re-sectioned and re-commented.
  for (const f of ['doc.css', 'code.css']) links.push(fileHref(path.join(VENDOR, 'style', f)));
  if (themePath) links.push(fileHref(themePath));
  return links;
}

function payloadScript(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<script id="md2pdf-payload" type="application/json">${json}</script>`;
}

function scriptTags(paths) {
  return paths.map((p) => `<script src="${fileHref(p)}"></script>`).join('');
}

/** Inline a renderer's in-page source as a <script> body. */
function inlineScript(src) {
  if (!src) return '';
  return '<script>' + String(src).replace(/<\/script/gi, '<\\/script') + '</script>';
}

/**
 * Extra CSS the fence renderer needs beyond the stylesheets the document
 * already links. The document links vendor/style/doc.css + code.css and the
 * theme file, which is exactly what the fence DOM needs — so nothing is added
 * here any more. The hook stays as a single place to extend if a future fence
 * asset needs a sheet of its own.
 */
function fenceExtraCss(fence) {
  const extra = (fence.FENCE_EXTRA_CSS || []).filter((p) => fsSync.existsSync(p));
  return extra.map((p) => fsSync.readFileSync(p, 'utf8')).join('\n');
}

function renderScript({ fence, math, payload }) {
  const hasFence = payload.fences.length > 0;
  const hasMath = payload.math.length > 0;
  return (
    '<script>(async function(){var P=JSON.parse(document.getElementById("md2pdf-payload").textContent);' +
    'try{' +
    (hasFence && fence.FENCE_INPAGE ? `if(window.md2pdfRenderFences) window.md2pdfRenderFences(P.fences);` : '') +
    (hasMath && math.MATH_INPAGE ? `if(window.md2pdfRenderMath) await window.md2pdfRenderMath(P.math);` : '') +
    '}catch(e){window.__md2pdf_error=String(e&&e.stack||e);}' +
    'window.__md2pdf_done=true;})();</script>'
  );
}

/** Upper bound on TOC pagination passes (each pass costs one render + print). */
const MAX_TOC_PASSES = 4;

/** cid -> 1-based page number, recovered from Chromium's `af://` link annotations. */
async function headingPageMap(pdfBytes, headings) {
  const doc = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  const anchors = extractAnchors(doc);
  const pages = new Map();
  for (const h of headings) {
    const a = anchors.get('n' + h.cid);
    if (a) pages.set(h.cid, a.page + 1);
  }
  return pages;
}

function pageMapsDiffer(a, b, headings) {
  if (!a) return true;
  for (const h of headings) {
    if (a.get(h.cid) !== b.get(h.cid)) return true;
  }
  return false;
}

/**
 * Full build.
 * @param {object} o
 * @param {string} o.markdown          markdown source
 * @param {string} o.baseDir           directory used to resolve relative image paths
 * @param {string} [o.themePath]       theme CSS file
 * @param {string} [o.title]
 * @param {string} [o.outHtml]         write the final HTML here
 * @param {string} [o.chromePath]
 * @param {string} [o.engine]          'puppeteer' (default) or 'electron'
 * @param {object} [o.electron]        Electron module, when running inside Electron
 * @param {object} [o.print]           {paper, printBackground}
 * @param {boolean} [o.tocPageNumbers] put page numbers in a `[TOC]` block (default true)
 * @param {number} [o.tocMaxLevel]     deepest heading level listed in the TOC (default 6)
 */
export async function build(o) {
  const {
    markdown,
    baseDir = process.cwd(),
    themePath,
    title = '',
    outHtml,
    chromePath,
    engine,
    electron,
    print = {},
    markdownOptions = {},
    emitHtml = true,
    postprocess = true,
    header,
    footer,
    meta = {},
    filePath,
    typoraDates = true,
    tocPageNumbers = true,
    tocMaxLevel,
  } = o;

  const { fence, math } = await loadRenderers();
  // Stage files never belong next to the sources: inside a packaged app `ROOT`
  // points into app.asar, which is a file, so writing there fails with ENOTDIR.
  const tmpDir = o.tmpDir || process.env.MDPDF_TMPDIR || path.join(os.tmpdir(), `md2pdf-${process.pid}`);
  await fs.mkdir(tmpDir, { recursive: true });

  /**
   * One render + print pass. `tocPages` is the cid->page map baked into the TOC
   * (null for the first pass, which measures the real pagination).
   */
  const renderPass = async (tocPages, passNo, session) => {
    const built = buildPrintBody(markdown, {
      baseDir, markdownOptions, tocPages, tocPageNumbers, tocMaxLevel,
    });
    const links = styleLinks(themePath);

    // Typora appends MathJax's SVG stylesheet to the doc's own <style> only when
    // the document contains math (frame.js 719000), followed by the print-only
    // stroke rule.
    let printCss = '';
    if (built.hasMath) {
      if (math.MATH_CSS) printCss += math.MATH_CSS;
      const stroke = math.MATH_PRINT_STROKE_RULE || math.MATH_STROKE_CSS;
      if (stroke) printCss += stroke;
    }
    const fenceCss = built.hasFence ? fenceExtraCss(fence) : '';
    if (fenceCss) printCss += '\n' + fenceCss;
    // Our own TOC styles: an extension, not part of Typora's export CSS.
    if (built.hasToc) printCss += '\n' + TOC_CSS;

    const stageScripts = [
      ...(built.hasFence ? fence.FENCE_SCRIPTS || [] : []),
      ...(built.hasMath ? math.MATH_ASSETS || math.MATH_SCRIPTS || [] : []),
    ];
    const inPage = [
      built.hasFence ? inlineScript(fence.FENCE_INPAGE) : '',
      built.hasMath ? inlineScript(math.MATH_INPAGE) : '',
    ].join('');

    const stage1 = buildDocument({
      bodyHtml: built.body,
      links,
      title,
      printCss,
      appendHead: payloadScript(built.payload),
      appendBody: scriptTags(stageScripts) + inPage + renderScript({ fence, math, payload: built.payload }),
      includeTyporaScripts: false,
    });

    const stagePath = path.join(tmpDir, `stage${passNo}-${process.pid}-${Date.now()}.html`);
    await fs.writeFile(stagePath, stage1, 'utf8');
    try {
      await session.load(stagePath, {
        beforeSettle: async (p) => {
          await p.waitForFunction('window.__md2pdf_done === true', { timeout: 120000 });
          const err = await p.evaluate(() => window.__md2pdf_error || null);
          if (err) throw new Error('in-page renderer failed: ' + err);
        },
      });
      try {
        // frame.js 718400: heading placeholder rules are decided at print time by
        // probing the computed style of each level that actually exists. It is a
        // no-op unless the theme gives headings a non-empty ::after content.
        const headingCss = await session.evaluate(() => {
          const rules = [];
          for (let t = 1; t < 7; t += 1) {
            const el = document.querySelector('#write h' + t);
            if (!el) continue;
            const cs = getComputedStyle(el);
            const after = getComputedStyle(el, 'after');
            const qualifies =
              /^0px/.test(cs.border || '') &&
              / 0px$/.test(cs.outline || '') &&
              cs.boxShadow === 'none' &&
              cs.backgroundImage === 'none' &&
              cs.backgroundColor === 'rgba(0, 0, 0, 0)' &&
              after.content !== 'none' &&
              Boolean(after.content);
            if (qualifies) {
              rules.push(
                `.typora-export h${t}::after {content: "";display: block;height: 100px;margin-bottom: -100px;}`,
              );
            }
          }
          return rules.join('\n');
        });
        if (headingCss) await session.addStyle(headingCss);

        const pdf = await session.printToPDF(print);
        const computed = await session.evaluate(() => {
          const w = document.getElementById('write');
          const cs = w ? getComputedStyle(w) : null;
          return {
            fontFamily: cs ? cs.fontFamily.replace(/["']/g, '').split(',')[0].trim() : 'inherit',
            fontFamilyFull: cs ? cs.fontFamily : 'inherit',
            color: cs ? cs.color : 'inherit',
          };
        });
        let html = null;
        if (emitHtml && outHtml) {
          const bodyHtml = await session.evaluate(() => {
            const w = document.getElementById('write');
            return w ? w.innerHTML : '';
          });
          html = buildDocument({
            bodyHtml,
            links,
            title,
            printCss: headingCss ? printCss + '\n' + headingCss : printCss,
          });
        }
        if (process.env.MDPDF_DEBUG_GEOM) {
          process.stderr.write('[geom] ' + JSON.stringify(await session.evaluate(() => {
            const out = { blocks: [], mjx: [] };
            const w = document.getElementById('write');
            [...w.children].forEach((el, i) => {
              const r = el.getBoundingClientRect();
              out.blocks.push({ i, tag: el.tagName, cls: el.className, top: +r.top.toFixed(2), h: +r.height.toFixed(2) });
            });
            document.querySelectorAll('mjx-container').forEach((c) => {
              const r = c.getBoundingClientRect();
              const cs = getComputedStyle(c);
              const svg = c.querySelector('svg');
              const sr = svg && svg.getBoundingClientRect();
              out.mjx.push({
                display: cs.display, va: cs.verticalAlign, fs: cs.fontSize, lh: cs.lineHeight,
                top: +r.top.toFixed(2), h: +r.height.toFixed(2), w: +r.width.toFixed(2),
                svgH: sr ? +sr.height.toFixed(2) : null, svgW: sr ? +sr.width.toFixed(2) : null,
                svgAttrH: svg ? svg.getAttribute('height') : null,
                svgStyle: svg ? svg.getAttribute('style') : null,
              });
            });
            return out;
          }), null, 1) + '\n');
        }
        return { built, pdf, computed, html };
      } finally {
        // the session keeps the page for the next pass
      }
    } finally {
      await fs.rm(stagePath, { force: true });
    }
  };

  const session = await openSession({ engine, electron, chromePath });
  try {
    // TOC page numbers need the real pagination, which only exists after a
    // print. Pass 1 measures it; later passes bake the numbers in and re-measure
    // until the pagination is stable (inserting a number can reflow the TOC).
    let tocPages = null;
    let pass = await renderPass(tocPages, 1, session);
    if (pass.built.hasToc && tocPageNumbers) {
      for (let i = 2; i <= MAX_TOC_PASSES; i += 1) {
        const next = await headingPageMap(pass.pdf, pass.built.headings);
        if (!pageMapsDiffer(tocPages, next, pass.built.headings)) break;
        tocPages = next;
        pass = await renderPass(tocPages, i, session);
      }
      if (process.env.MDPDF_DEBUG_TOC) {
        const final = await headingPageMap(pass.pdf, pass.built.headings);
        process.stderr.write('[toc] pages ' + JSON.stringify([...final]) + '\n');
      }
    }

    const { built, pdf, computed, html } = pass;
    let out = pdf;
    if (postprocess) {
      const contentDoc = await PDFDocument.load(pdf, { updateMetadata: false });
      const pageCount = contentDoc.getPageCount();
      const pageWidthPt = contentDoc.getPage(0).getWidth();
      const bands = {};
      const bandOpts = {
        pageCount,
        pageWidthPt,
        fontFamily: computed.fontFamily,
        color: computed.color,
        tmpDir,
        vars: {
          title: meta.title ?? title ?? '',
          author: meta.author ?? '',
          date: new Date().toISOString().slice(0, 10),
          time: new Date().toISOString().slice(11, 19),
          file: filePath ? path.basename(filePath) : '',
        },
      };
      if (header) bands.header = await renderBand(session, { template: header, ...bandOpts, heightPt: BAND_PT });
      if (footer) bands.footer = await renderBand(session, { template: footer, ...bandOpts, heightPt: BAND_PT });
      out = await finalizePdf(pdf, {
        headings: built.headings,
        meta: { title: meta.title ?? title, ...meta },
        bands,
        typoraDates: typoraDates !== false,
      });
    }
    return {
      pdfBuffer: out,
      html,
      headings: built.headings,
      hasMath: built.hasMath,
      hasFence: built.hasFence,
      hasToc: built.hasToc,
    };
  } finally {
    await session.close();
  }
}

export { PAPER, fileHref, linkTag };
