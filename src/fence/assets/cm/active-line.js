/*
 * CodeMirror 5 addon "active-line" -- body extracted verbatim from SystemJS
 * module "38" of Typora 1.9.5's frame.js (offsets 212101..213236).
 * Typora sets styleActiveLine:true for every fence, so this addon is what
 * produces the <div class="CodeMirror-activeline"> wrapper and the
 * CodeMirror-activeline-background / CodeMirror-activeline-gutter children.
 *
 * CodeMirror is (c) Marijn Haverbeke and contributors, MIT licence.
 */
(function (global) {
  'use strict';
  var exportsObj = {};
  (function (require, exports, module) {
    var e = function (id) {
      if (id === '20') return global.CodeMirror;
      throw new Error('active-line: unexpected dependency ' + id);
    };
var i=e("20"),a="CodeMirror-activeline",s="CodeMirror-activeline-background",l="CodeMirror-activeline-gutter";function c(e){for(var t=0;t<e.state.activeLines.length;t++)e.removeLineClass(e.state.activeLines[t],"wrap",a),e.removeLineClass(e.state.activeLines[t],"background",s),e.removeLineClass(e.state.activeLines[t],"gutter",l)}function r(t,e){for(var n=[],i=0;i<e.length;i++){var r=e[i],o=t.getOption("styleActiveLine");("object"==typeof o&&o.nonEmpty?r.anchor.line==r.head.line:r.empty())&&(o=t.getLineHandleVisualStart(r.head.line),n[n.length-1]!=o)&&n.push(o)}!function(e,t){if(e.length==t.length){for(var n=0;n<e.length;n++)if(e[n]!=t[n])return;return 1}}(t.state.activeLines,n)&&t.operation(function(){c(t);for(var e=0;e<n.length;e++)t.addLineClass(n[e],"wrap",a),t.addLineClass(n[e],"background",s),t.addLineClass(n[e],"gutter",l);t.state.activeLines=n})}function o(e,t){r(e,t.ranges)}i.defineOption("styleActiveLine",!1,function(e,t,n){n=n!=i.Init&&n;t!=n&&(n&&(e.off("beforeSelectionChange",o),c(e),delete e.state.activeLines),t)&&(e.state.activeLines=[],r(e,e.listSelections()),e.on("beforeSelectionChange",o))})
  })(null, exportsObj, { exports: exportsObj });
})(typeof globalThis !== 'undefined' ? globalThis : this);
