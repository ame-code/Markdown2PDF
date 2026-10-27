// src/md2typora.js — Markdown -> Typora 1.9.5 print-export DOM
//
// The target is not "some HTML" but the exact serialization Typora's
// Node.prototype.toHTML produces in print mode, captured from a real
// File > Export > HTML run with theme "my"
// (E:\work\reverse\reverse-typora-export\evidence\real-export-html-MATH.html)
// cross-read against frame.js's exportCollection switch (offsets 701800-713000).
//
// Evidence: evidence/dom-spec.md (dom-analyst), reports/03-dom-spec.md.
import MarkdownIt from 'markdown-it';
import footnotePlugin from 'markdown-it-footnote';
import { typoraExtraInlinePlugin } from './inline-extra.js';

/** Typora's escape(): & < > " ' */
export function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
export const escQ = esc;
/** Attribute values written with double quotes (image src/alt/title). */
export function escDQ(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Node-id allocator. A cid ("n0", "n1", ...) is assigned by Typora's parser to
 * every node object it creates; the exact rule is not derivable from Markdown
 * (dom-spec.md §9a). The anchors we can observe imply two ids per block
 * (corpus: h1->n0, h2->n2; "# One/para/# Two": second h1->n4). We allocate two
 * per block and keep the sequence monotonic. cids are invisible in print:
 * heading anchors are 1px absolutely-positioned links and nothing links to
 * math ids.
 */
export class CidGen {
  constructor() { this.n = 0; }
  next() { return this.n++; }
  alloc() { const c = this.n; this.n += 2; return c; }
}

/** Drop a UTF-8 BOM: editors on Windows write it, Typora never sees it. */
export function stripBom(src) {
  return src.charCodeAt(0) === 0xfeff ? src.slice(1) : src;
}

/** Typora's YAML front matter is a meta block, which exports as "". */
export function stripFrontMatter(src) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return src;
  return src.slice(m[0].length);
}

export function createMarkdown(opts = {}) {
  const {
    enableInlineMath = true,
    enableHighlight = false,
    enableSubscript = false,
    enableSuperscript = false,
    enableFootnote = true,
    breaks = false,
  } = opts;
  const md = new MarkdownIt({
    html: true,
    xhtmlOut: false,
    breaks,
    langPrefix: '',
    linkify: false,
    typographer: false,
    highlight: null,
  });
  if (enableInlineMath) md.use(inlineMathPlugin);
  if (enableInlineMath) md.use(blockMathPlugin);
  md.use(typoraExtraInlinePlugin, { highlight: enableHighlight, subscript: enableSubscript, superscript: enableSuperscript });
  if (enableFootnote) md.use(footnotePlugin);
  return md;
}

const INLINE_MATH_RE = /^\$(?!\$)([\s\S]+?)\$(?!\$)/;

/** Typora's inline math: `$...$`, no inner edge spaces, not followed by a digit. */
export function inlineMathPlugin(md) {
  function rule(state, silent) {
    const start = state.pos;
    if (state.src.charAt(start) !== '$') return false;
    if (state.src.startsWith('$$', start)) return false;
    const m = INLINE_MATH_RE.exec(state.src.slice(start));
    if (!m) return false;
    const tex = m[1];
    if (!tex.trim()) return false;
    if (/\s/.test(tex.charAt(0)) || /\s/.test(tex.charAt(tex.length - 1))) return false;
    const after = state.src.charAt(start + m[0].length);
    if (/[0-9]/.test(after)) return false;
    if (!silent) {
      const token = state.push('math_inline', 'math', 0);
      token.content = tex;
      token.markup = '$';
    }
    state.pos = start + m[0].length;
    return true;
  }
  md.inline.ruler.before('escape', 'math_inline', rule);
  return md;
}

/**
 * Typora's display math: a paragraph that starts with `$$`. Either closes on
 * the same line (`$$tex$$`) or on a later line ending with `$$`. The TeX body
 * is what the editor stores in the block's `md-math-container`.
 */
export function blockMathPlugin(md) {
  function rule(state, startLine, endLine, silent) {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const first = state.src.slice(start, max);
    if (!first.startsWith('$$')) return false;
    if (silent) return true;

    let tex = null;
    let lastLine = startLine;
    const rest = first.slice(2);
    const restTrim = rest.trimEnd();
    if (restTrim.length >= 2 && restTrim.endsWith('$$')) {
      tex = restTrim.slice(0, -2);
    } else {
      const buf = [rest];
      for (let l = startLine + 1; l < endLine; l++) {
        const s = state.bMarks[l] + state.tShift[l];
        const e = state.eMarks[l];
        const text = state.src.slice(s, e);
        const t = text.trimEnd();
        lastLine = l;
        if (t.endsWith('$$')) {
          buf.push(t.slice(0, -2));
          tex = buf.join('\n');
          break;
        }
        buf.push(text);
      }
      if (tex === null) return false;
    }

    state.line = lastLine + 1;
    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = tex.trim();
    token.markup = '$$';
    token.map = [startLine, state.line];
    return true;
  }
  md.block.ruler.before('fence', 'math_block', rule, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });
  return md;
}

/**
 * Fence content as Typora stores it: the editor node holds the lines without a
 * trailing newline, so CodeMirror renders exactly `lineCount` line boxes. A
 * leftover "\n" from markdown-it adds one extra empty line (23.04px at the
 * print font size) and pushes everything below it down.
 */
export function stripFenceTail(code) {
  return String(code).replace(/\r?\n$/, '');
}

/** GFM/Typora-ish anchor slug for resolving `[x](#Target)`. */
export function slugify(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, '-')
    .replace(/[^\p{L}\p{N}\-_]/gu, '');
}

/**
 * Render a markdown document to Typora's print body, two passes so that
 * same-document links can be resolved to heading anchor ids
 * (the artifact shows `[jump](#target)` -> `href='#header-n0'`).
 */
export function renderDocument(md, src, hooks = {}) {
  const clean = stripFrontMatter(stripBom(src));
  const tokens = md.parse(clean, {});

  // pass 1 exists only to know the heading cids before inline links are
  // resolved; its HTML is discarded. Hooks must not run here, or every fence /
  // math block would be registered twice and the payload indices would not
  // match the emitted placeholders.
  const inertHooks = {
    ...hooks,
    fence: () => '',
    inlineMath: () => '',
    blockMath: () => '',
    resolveImage: (src) => src,
    resolveLink: (href) => href,
    emoji: () => '',
  };
  const p1 = { cids: new CidGen(), hooks: inertHooks, headingList: [], footnotes: [] };
  renderTokens(tokens, p1);
  const anchors = new Map();
  for (const h of p1.headingList) {
    anchors.set(h.text.trim(), 'header-n' + h.cid);
    anchors.set(slugify(h.text), 'header-n' + h.cid);
  }

  // pass 2: render with link resolution
  const hooks2 = {
    ...hooks,
    resolveLink(href) {
      if (!href) return href;
      if (hooks.resolveLink) {
        const r = hooks.resolveLink(href);
        if (r != null) return r;
      }
      if (href.startsWith('#')) {
        const want = href.slice(1);
        const hit = anchors.get(want) || anchors.get(slugify(want));
        if (hit) return '#' + hit;
      }
      return href;
    },
  };
  const p2 = { cids: new CidGen(), hooks: hooks2, headingList: [], footnotes: [] };
  let body = renderTokens(tokens, p2);
  if (!body) body = '<p>&nbsp;</p>';
  if (p2.footnotes.length) body += renderFootnotesArea(p2.footnotes);
  return { body, headings: p2.headingList, footnotes: p2.footnotes };
}

/**
 * Typora's footnotes area. Shape verified only for the trailing container
 * (frame.js:716600: `<div class='footnotes-area' data-breakpage ><hr/>` + one
 * `<div class='footnote-line'>` per note). The inner line markup is NOT
 * attested by any artifact in scope, so it is a documented approximation
 * (reports/03-dom-spec.md §Footnotes); the sample corpus has no footnotes.
 */
export function renderFootnotesArea(lines) {
  return "<div class='footnotes-area' data-breakpage ><hr/>" +
    lines.map((x) => `<div class='footnote-line'>${x}</div>`).join('\n') +
    '</div>';
}

/**
 * Render tokens to Typora's print HTML.
 * ctx.hooks: { fence(code, info, {cid}), inlineMath(tex), blockMath(tex,{cid}),
 *              resolveImage(src), resolveLink(href), emoji(name) }
 */
export function renderTokens(tokens, ctx) {
  const html = [];
  let blockIndex = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.type) {
      case 'heading_open': {
        const level = Number(t.tag.slice(1));
        const cid = ctx.cids.alloc();
        const close = findClose(tokens, i);
        const innerTokens = tokens.slice(i + 1, close);
        (ctx.headingList || (ctx.headingList = [])).push({
          level, cid, text: plainText(innerTokens),
        });
        // Print mode adds data-breakpage for a top-level H1 that is not the
        // document's first block (frame.js:702759). The rule that consumes
        // [data-breakpage] is only emitted when `splitPages` is passed, which
        // the PDF path never does — so it stays inert, exactly as in Typora.
        const bp = level === 1 && blockIndex > 0 ? ' data-breakpage' : '';
        const inner = renderInline(innerTokens, ctx);
        html.push(
          `<h${level}${bp}><a name="header-n${cid}" class="md-header-anchor md-print-anchor" href="af://n${cid}"> </a>${inner}</h${level}>`,
        );
        i = close; blockIndex++;
        break;
      }
      case 'paragraph_open': {
        const close = findClose(tokens, i);
        const innerTokens = tokens.slice(i + 1, close);
        if (isTocMarker(innerTokens) && ctx.hooks.toc) {
          // Typora supports a `[TOC]` paragraph; the export markup is our own
          // extension (src/toc.js). Without a hook it degrades to plain text.
          html.push(ctx.hooks.toc());
          i = close; blockIndex++;
          break;
        }
        const inner = renderInline(innerTokens, ctx).replace(EMPTY_SPAN, '');
        html.push(`<p>${inner || '&nbsp;'}</p>`);
        i = close; blockIndex++;
        break;
      }
      case 'blockquote_open': {
        const close = findClose(tokens, i);
        html.push('<blockquote>' + renderTokens(tokens.slice(i + 1, close), ctx) + '</blockquote>');
        i = close; blockIndex++;
        break;
      }
      case 'bullet_list_open': {
        const close = findClose(tokens, i);
        html.push('<ul>' + renderTokens(tokens.slice(i + 1, close), ctx) + '</ul>');
        i = close; blockIndex++;
        break;
      }
      case 'ordered_list_open': {
        const close = findClose(tokens, i);
        const start = t.attrGet('start') || ''; // artifact prints start='' for 1
        html.push(`<ol start='${escQ(start)}' >` + renderTokens(tokens.slice(i + 1, close), ctx) + '</ol>');
        i = close; blockIndex++;
        break;
      }
      case 'list_item_open': {
        const close = findClose(tokens, i);
        const item = renderListItem(tokens, i, close, ctx);
        html.push(item);
        i = close;
        break;
      }
      case 'table_open': {
        const close = findClose(tokens, i);
        html.push("<figure class='table-figure'><table>" + renderTokens(tokens.slice(i + 1, close), ctx) + '</table></figure>');
        i = close; blockIndex++;
        break;
      }
      case 'thead_open': {
        const close = findClose(tokens, i);
        html.push('<thead>' + renderTokens(tokens.slice(i + 1, close), ctx) + '</thead>');
        i = close;
        break;
      }
      case 'tbody_open': {
        const close = findClose(tokens, i);
        html.push('<tbody>' + renderTokens(tokens.slice(i + 1, close), ctx) + '</tbody>');
        i = close;
        break;
      }
      case 'tr_open': {
        const close = findClose(tokens, i);
        html.push('<tr>' + renderTokens(tokens.slice(i + 1, close), ctx) + '</tr>');
        i = close;
        break;
      }
      case 'th_open':
      case 'td_open': {
        const tag = t.tag;
        const close = findClose(tokens, i);
        // Artifact: <th style='text-align:left;' > (semicolon inside the value)
        const align = t.attrGet('style');
        const style = align ? ` style='${escQ(/;\s*$/.test(align) ? align : align + ';')}' ` : '';
        const inner = renderInline(tokens.slice(i + 1, close), ctx).replace(EMPTY_SPAN, '');
        html.push(`<${tag}${style}>${inner || '&nbsp;'}</${tag}>`);
        i = close;
        break;
      }
      case 'fence': {
        const cid = ctx.cids.alloc();
        html.push(ctx.hooks.fence(stripFenceTail(t.content), t.info || '', { cid }));
        blockIndex++;
        break;
      }
      case 'code_block': {
        const cid = ctx.cids.alloc();
        html.push(ctx.hooks.fence(stripFenceTail(t.content), '', { cid }));
        blockIndex++;
        break;
      }
      case 'hr':
        ctx.cids.alloc();
        html.push('<hr />');
        blockIndex++;
        break;
      case 'math_block': {
        const cid = ctx.cids.alloc();
        html.push(ctx.hooks.blockMath(t.content, { cid }));
        blockIndex++;
        break;
      }
      case 'html_block':
        html.push(t.content);
        blockIndex++;
        break;
      case 'inline':
        html.push(renderInline(t.children || [], ctx));
        break;
      case 'footnote_block_open':
      case 'footnote_block_close':
        break;
      case 'footnote_open': {
        // Footnote definitions are hoisted into the trailing footnotes area;
        // their inline HTML is collected here (see renderFootnotesArea).
        const fclose = findFootnoteClose(tokens, i);
        const inner = tokens.slice(i + 1, fclose);
        const parts = [];
        for (const x of inner) {
          if (x.type === 'inline') parts.push(renderInline(x.children || [], ctx));
        }
        (ctx.footnotes || (ctx.footnotes = [])).push(parts.join(''));
        i = fclose;
        break;
      }
      case 'footnote_close':
      case 'footnote_anchor':
        break;
      case 'def_link':
      case 'def_footnote':
        break;
      default:
        throw new Error(`md2typora: unhandled block token ${t.type}`);
    }
  }
  return html.join('');
}

const EMPTY_SPAN = '<span></span>';

/**
 * True when a paragraph's content is exactly `[TOC]` (Typora's TOC shorthand),
 * with no other inline markup.
 */
function isTocMarker(innerTokens) {
  const parts = [];
  for (const t of innerTokens) {
    if (t.type !== 'inline' || !t.children) return false;
    for (const c of t.children) {
      if (c.type === 'text') parts.push(c.content);
      else if (c.type === 'softbreak' || c.type === 'hardbreak') parts.push('\n');
      else return false;
    }
  }
  return parts.length > 0 && /^\[toc\]$/i.test(parts.join('').trim());
}

/** Task-list items get a class + checkbox before their paragraph. */
function renderListItem(tokens, i, close, ctx) {
  const inner = tokens.slice(i + 1, close);
  // detect `[ ] `/`[x] ` at the start of the item's first paragraph text
  let done = null;
  const firstP = inner.findIndex((x) => x.type === 'paragraph_open');
  if (firstP >= 0) {
    const inlineIdx = firstP + 1;
    const inline = inner[inlineIdx];
    if (inline && inline.type === 'inline' && inline.children && inline.children.length) {
      const first = inline.children[0];
      if (first.type === 'text') {
        const m = /^\[([ xX])\]\s+/.exec(first.content);
        if (m) {
          done = m[1].toLowerCase() === 'x';
          const stripped = { ...first, content: first.content.slice(m[0].length) };
          const children = inline.children.slice();
          children[0] = stripped;
          inner[inlineIdx] = { ...inline, children };
        }
      }
    }
  }
  const body = renderTokens(inner, ctx);
  if (done === null) return '<li>' + body + '</li>';
  const cls = done
    ? "md-task-list-item task-list-item task-list-done"
    : "md-task-list-item task-list-item task-list-not-done";
  const box = done ? "<input type='checkbox' checked/>" : "<input type='checkbox' />";
  return `<li class='${cls}' >${box}${body}</li>`;
}

function findClose(tokens, openIndex) {
  const open = tokens[openIndex];
  const closeType = open.type.replace(/_open$/, '_close');
  let depth = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    if (tokens[i].type === open.type) depth++;
    else if (tokens[i].type === closeType) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
}

/** Plain text of a heading (used for anchors and the PDF outline). */
function plainText(tokens) {
  const out = [];
  for (const t of tokens) {
    if (t.type === 'inline') out.push(...t.children.map((c) => (c.type === 'text' || c.type === 'code_inline' ? c.content : '')));
    else if (t.type === 'text' || t.type === 'code_inline') out.push(t.content);
  }
  return out.join('');
}

/** Inline serialization: Typora wraps every text run in a <span>. */
export function renderInline(tokens, ctx) {
  const out = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'inline':
        out.push(renderInline(t.children || [], ctx));
        break;
      case 'text':
        // Typora drops empty text runs (its parser produces none)
        if (t.content === '') break;
        out.push(ctx.hooks.text ? ctx.hooks.text(t.content) : `<span>${esc(t.content)}</span>`);
        break;
      case 'strong_open': out.push('<strong>'); break;
      case 'strong_close': out.push('</strong>'); break;
      case 'em_open': out.push('<em>'); break;
      case 'em_close': out.push('</em>'); break;
      case 's_open': out.push('<del>'); break;
      case 's_close': out.push('</del>'); break;
      case 'mark_open': out.push('<mark>'); break;
      case 'mark_close': out.push('</mark>'); break;
      case 'sub_open': out.push('<sub>'); break;
      case 'sub_close': out.push('</sub>'); break;
      case 'sup_open': out.push('<sup>'); break;
      case 'sup_close': out.push('</sup>'); break;
      case 'u_open': out.push('<u>'); break;
      case 'u_close': out.push('</u>'); break;
      case 'code_inline':
        out.push(`<code>${esc(t.content)}</code>`);
        break;
      case 'link_open': {
        const href = (ctx.hooks.resolveLink ? ctx.hooks.resolveLink(t.attrGet('href') || '') : t.attrGet('href')) || '';
        const title = t.attrGet('title');
        out.push(`<a href='${escQ(href)}'${title ? ` title='${escQ(title)}'` : ''}>`);
        break;
      }
      case 'link_close': out.push('</a>'); break;
      case 'image': {
        const raw = t.attrGet('src') || '';
        const src = ctx.hooks.resolveImage ? ctx.hooks.resolveImage(raw) : raw;
        const alt = t.attrGet('alt') || t.content || '';
        const title = t.attrGet('title');
        out.push(`<img src="${escDQ(src)}" referrerpolicy="no-referrer" alt="${escDQ(alt)}"${title ? ` title="${escDQ(title)}"` : ''}>`);
        break;
      }
      case 'softbreak':
        out.push('\n');
        break;
      case 'hardbreak':
        out.push('<br/>');
        break;
      case 'math_inline':
        out.push(ctx.hooks.inlineMath(t.content));
        break;
      case 'html_inline':
        out.push(t.content);
        break;
      case 'footnote_ref': {
        const n = t.meta.id + 1;
        out.push(`<sup class='md-footnote'><a href='#dfref-footnote-${n}' name='ref-footnote-${n}'>${n}</a></sup>`);
        break;
      }
      case 'footnote_anchor':
        break;
      default:
        throw new Error(`md2typora: unhandled inline token ${t.type}`);
    }
  }
  return out.join('');
}

function findFootnoteClose(tokens, i) {
  let depth = 0;
  for (let k = i; k < tokens.length; k++) {
    if (tokens[k].type === 'footnote_open') depth++;
    else if (tokens[k].type === 'footnote_close') {
      depth--;
      if (depth === 0) return k;
    }
  }
  return tokens.length - 1;
}
