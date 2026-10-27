/*
 * Stand-in for the host globals Typora's patched CodeMirror 5.26.0 reads.
 * Hand-written for the standalone renderer (NOT extracted from Typora).
 * Values chosen to follow the WYSIWYG (non source-mode) paths used during a
 * Typora export with the stock configuration probed for this project:
 *   - passiveEvents false  : plain addEventListener (no DOM effect)
 *   - isNode true, isMac false, useCRLF false : Windows, LF documents
 *   - sourceView left undefined : Typora only sets it in source-code mode
 *
 * NOTE: browsers have a native global File (the File constructor). It has no
 * .option, so presence alone is not a signal -- the stub replaces it (keeping
 * the native one on __mdpdfNativeFile) unless it already looks like ours.
 */
(function (global) {
  'use strict';
  var ours = global.File && global.File.option && typeof global.File.option.passiveEvents === 'boolean';
  if (ours) return;
  if (global.File) global.__mdpdfNativeFile = global.File;
  global.File = {
    option: { passiveEvents: false },
    isNode: true,
    isMac: false,
    isMacLegacy: false,
    isWK: false,
    useCRLF: false,
    changeCounter: { withdrawAutoSaved: function () { return false; } },
    editor: {
      fences: { isMousePressed: false },
      selection: { scrollAdjust: function () {} },
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
