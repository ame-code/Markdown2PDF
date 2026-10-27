// src/renderers/fallback.js
// Degraded renderers used only when src/fence/index.js or src/math/index.js are
// absent. They keep the pipeline runnable; they are NOT byte-parity sources.
export const FENCE_SCRIPTS = [];
export const FENCE_CSS = '';
export const MATH_SCRIPTS = [];
export const MATH_CSS = '';

export const FENCE_INPAGE = String.raw`
window.md2pdfRenderFences = function (items) {
  for (const it of items) {
    const el = document.querySelector('[data-mdpdf-fence="' + it.index + '"]');
    if (!el) continue;
    const lang = (it.lang || '').split(/\s+/)[0];
    if (lang) el.setAttribute('lang', lang);
    const lines = it.code.replace(/\n$/, '').split('\n').map(function (line) {
      const t = line === '' ? ' ' : line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return '<pre class=" CodeMirror-line " role="presentation"><span role="presentation" style="padding-right: 0.1px;">' + t + '</span></pre>';
    }).join('');
    el.classList.add('modeLoaded');
    el.innerHTML =
      '<div class="CodeMirror cm-s-inner cm-s-null-scroll CodeMirror-wrap"' + (lang ? ' lang="' + lang + '"' : '') + '>' +
      '<div class="CodeMirror-scroll" tabindex="-1"><div class="CodeMirror-sizer">' +
      '<div style="position: relative; top: 0px;"><div class="CodeMirror-lines" role="presentation">' +
      '<div role="presentation" style="position: relative; outline: none;">' +
      '<div class="CodeMirror-code" role="presentation">' + lines + '</div>' +
      '</div></div></div></div></div></div>';
    el.removeAttribute('data-mdpdf-fence');
  }
};
`;

export const MATH_INPAGE = String.raw`
window.md2pdfRenderMath = function (items) {
  // No MathJax available: show the TeX source so the degradation is visible.
  for (const it of items) {
    if (it.kind === 'inline') {
      const el = document.querySelector('[data-mdpdf-math-inline="' + it.index + '"]');
      if (!el) continue;
      el.innerHTML = '<span class="md-math-degraded">$' + it.tex.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '$</span>';
      el.removeAttribute('data-mdpdf-math-inline');
    } else {
      const host = document.querySelector('[data-mdpdf-math-block="' + it.index + '"] .md-math-container');
      if (!host) continue;
      host.innerHTML = '<span class="md-math-degraded">$$' + it.tex.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '$$</span>';
      const box = host.parentElement;
      if (box) box.removeAttribute('data-mdpdf-math-block');
    }
  }
};
`;
