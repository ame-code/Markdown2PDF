// src/template.js
// Document shell reproduced from Typora 1.9.5 frame.js (offsets 713370-721600)
// and validated byte-for-byte against the real print export
// (E:\work\reverse\reverse-typora-export\evidence\real-export-html-MATH.html).
//
// Measured shell (forPrint, Windows, one theme, no user css):
//
//   <!doctype html>\n<html>\n<head>\n<meta charset='UTF-8'><meta name='viewport' content='width=device-width initial-scale=1'>\n
//   \n{LINKS}\n<style type='text/css'>html {overflow-x: initial !important;}{printCss}\n</style><title>T</title>\n</head>\n
//   <body class='typora-export typora-print os-windows'><div class='typora-export-content'>\n
//   <div id='write' style='top:auto' class='is-node'>BODY</div></div>\n
//   {SCRIPTS}</body>\n</html>
//
// The two trailing scripts are printed by Typora on Windows for every print
// export (frame.js:716600+); they are part of the shipped artifact and are kept
// even though nothing in the export calls setBreakPage().

export const BREAKPAGE_SCRIPT =
  "<script> window.setBreakPage = function(b){var node = document.querySelectorAll('[data-breakpage]'); " +
  "for(var i=0;i<node.length;i++){node[i].style.pageBreakBefore = b ? 'always':'auto' } " +
  'return node[0] && node[0].style.pageBreakBefore};</script>';

export const TABLE_ZOOM_SCRIPT =
  '<script>(function(){for(var e=document.querySelectorAll("figure>table"),t=0;t<e.length;t++){var n=e[t],' +
  'i=n.parentElement,r=i.scrollWidth,o=i.offsetWidth;o<r&&50<r&&(n.style.zoom=o/r,i.style.overflowX="visible")}})();</script>';

/** HTML-escape the way Typora's template does for <title>. */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function linkTag(href) {
  return `<link rel='stylesheet' href='${String(href).replace(/'/g, '%27')}' type='text/css' />`;
}

/**
 * @param {object} o
 * @param {string} o.bodyHtml   inner HTML of #write
 * @param {string[]} [o.links]  stylesheet hrefs (built-in CSS, then theme CSS)
 * @param {string[]} [o.userLinks] stylesheet hrefs emitted on their own lines
 *        (Typora's base.user.css / <theme>.user.css slots)
 * @param {string} [o.title]
 * @param {string} [o.printCss] Typora's computed print CSS block
 * @param {boolean} [o.forPrint=true]
 * @param {string} [o.os='windows']
 * @param {string} [o.appendHead] extra markup inside <head> (stage-1 payload)
 * @param {string} [o.appendScripts] extra markup before Typora's own scripts
 * @param {string} [o.appendBody] extra markup appended inside the body
 */
export function buildDocument(o) {
  const {
    bodyHtml,
    links = [],
    userLinks = [],
    title = '',
    printCss = '',
    forPrint = true,
    os = 'windows',
    appendHead = '',
    appendScripts = '',
    appendBody = '',
    includeTyporaScripts = true,
  } = o;

  const bodyClasses = ['typora-export'];
  if (forPrint) bodyClasses.push('typora-print');
  if (os === 'windows') bodyClasses.push('os-windows');

  let linksHtml = links.map(linkTag).join('');
  if (userLinks.length) linksHtml += '\n' + userLinks.map(linkTag).join('\n');

  const writeClass = forPrint ? (os === 'mac' ? 'is-mac' : 'is-node') : '';
  const titleTag = title ? `<title>${escapeHtml(title)}</title>` : '';

  return (
    '<!doctype html>\n' +
    '<html>\n' +
    '<head>\n' +
    "<meta charset='UTF-8'><meta name='viewport' content='width=device-width initial-scale=1'>\n" +
    `${appendHead}\n` +
    `${linksHtml}\n` +
    `<style type='text/css'>html {overflow-x: initial !important;}${printCss}\n</style>${titleTag}\n` +
    '</head>\n' +
    `<body class='${bodyClasses.join(' ')}'><div class='typora-export-content'>\n` +
    `<div id='write' ${forPrint ? "style='top:auto'" : ''} class='${writeClass}'>${bodyHtml}</div></div>\n` +
    appendBody +
    appendScripts +
    (includeTyporaScripts ? BREAKPAGE_SCRIPT + TABLE_ZOOM_SCRIPT : '') +
    '</body>\n' +
    '</html>'
  );
}
