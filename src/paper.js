// src/paper.js — paper sizes in inches, shared by both page engines.
//
// Electron's "A4" is 595.92 x 842.88 pt (8.2766667 x 11.7066667 in), which is
// NOT the same as Chromium's named A4 — the CLI must pass the size explicitly.
// Kept in its own module so the Electron bundle never has to import print.js
// (and through it puppeteer-core).
export const PAPER = {
  A4: { width: 595.92 / 72, height: 842.88 / 72 },
  A3: { width: 842.88 / 72, height: 1190.88 / 72 },
  Letter: { width: 612 / 72, height: 792 / 72 },
};
