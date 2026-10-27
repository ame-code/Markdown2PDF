// src/inline-extra.js — Typora's optional inline syntaxes.
//
// Typora gates these behind options (DEFAULT_OPTIONS in frame.js:568287):
//   enableHighlight:false  -> ==mark==
//   enableSubscript:false  -> ~sub~
//   enableSuperscript:false -> ^sup^
//   (underline ++u++ exists in the editor's inline parser regardless)
// With the defaults in this tool we register none of them, so plain `~`, `^`,
// `==` stay literal text, exactly like a stock Typora export.
const PAIRS = [
  { open: '==', close: '==', type: 'mark' },
  { open: '++', close: '++', type: 'u' },
  { open: '~', close: '~', type: 'sub', single: true },
  { open: '^', close: '^', type: 'sup', single: true },
];

function makeRule(spec) {
  return function rule(state, silent) {
    const start = state.pos;
    const src = state.src;
    if (!src.startsWith(spec.open, start)) return false;
    if (spec.single && spec.open === '~' && src.startsWith('~~', start)) return false; // ~~del~~
    const from = start + spec.open.length;
    const end = src.indexOf(spec.close, from);
    if (end < 0) return false;
    const inner = src.slice(from, end);
    if (!inner || !inner.trim()) return false;
    if (spec.single && /[\s]/.test(inner.charAt(0))) return false;
    if (!silent) {
      const open = state.push(`${spec.type}_open`, spec.type === 'mark' ? 'mark' : spec.type, 1);
      open.markup = spec.open;
      const text = state.push('text', '', 0);
      text.content = inner;
      const close = state.push(`${spec.type}_close`, spec.type === 'mark' ? 'mark' : spec.type, -1);
      close.markup = spec.close;
    }
    state.pos = end + spec.close.length;
    return true;
  };
}

export function typoraExtraInlinePlugin(md, { highlight = false, subscript = false, superscript = false, underline = true } = {}) {
  const enabled = [];
  for (const spec of PAIRS) {
    if (spec.type === 'mark' && !highlight) continue;
    if (spec.type === 'sub' && !subscript) continue;
    if (spec.type === 'sup' && !superscript) continue;
    if (spec.type === 'u' && !underline) continue;
    enabled.push(spec);
  }
  for (const spec of enabled) {
    md.inline.ruler.before('emphasis', `typora_${spec.type}`, makeRule(spec));
  }
  return md;
}
