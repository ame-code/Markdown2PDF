#!/usr/bin/env python
"""tools/toc_check.py — verify that `[TOC]` page numbers match real navigation.

Checks, on a PDF built from a document containing `[TOC]`:

  1. every TOC row is a working internal link (link annotation -> page), in the
     same top-to-bottom order as the PDF outline (bookmarks);
  2. the number printed in each row equals the page that row links to;
  3. the row count equals the number of headings in the outline.

Usage: python tools/toc_check.py <file.pdf> [--json] [--no-numbers]
       --no-numbers verifies the `--no-toc-pages` mode (rows must have no number).
"""
from __future__ import annotations

import json
import sys

import pymupdf

LINK_PAGE_KINDS = {pymupdf.LINK_GOTO, pymupdf.LINK_NAMED, pymupdf.LINK_GOTOR}


def toc_rows(doc):
    """Rows of the TOC block: (page_number, rect) for internal links on page 1."""
    page = doc[0]
    rows = []
    for link in page.get_links():
        if link.get("kind") not in LINK_PAGE_KINDS:
            continue
        target = link.get("page")
        if target is None:
            continue
        rows.append((target + 1, pymupdf.Rect(link["from"])))
    rows.sort(key=lambda r: (round(r[1].y0, 1), r[1].x0))
    return rows


def printed_numbers(doc, rows):
    """The number rendered at the right edge of each TOC row."""
    page = doc[0]
    words = page.get_text("words")  # x0, y0, x1, y1, word, block, line, word_no
    out = []
    for target, rect in rows:
        mid = (rect.y0 + rect.y1) / 2
        hits = [
            w[4]
            for w in words
            if w[0] > rect.x1 - 12 and w[1] <= mid <= w[3] + 6 and w[4].strip().isdigit()
        ]
        out.append(int(hits[0]) if hits else None)
    return out


def main(argv):
    if len(argv) < 2:
        sys.stderr.write(__doc__)
        return 2
    path = argv[1]
    as_json = "--json" in argv
    expect_numbers = "--no-numbers" not in argv
    doc = pymupdf.open(path)
    outline = doc.get_toc(simple=True)  # [[level, title, page], ...]
    rows = toc_rows(doc)
    numbers = printed_numbers(doc, rows)

    problems = []
    if len(rows) != len(outline):
        problems.append(f"row count {len(rows)} != outline entries {len(outline)}")
    for i, (target, _rect) in enumerate(rows):
        if i < len(outline) and target != outline[i][2]:
            problems.append(f"row {i + 1}: links to page {target}, outline says {outline[i][2]}")
        if not expect_numbers:
            if numbers[i] is not None:
                problems.append(f"row {i + 1}: unexpected page number {numbers[i]}")
            continue
        if numbers[i] is None:
            problems.append(f"row {i + 1}: no page number printed")
        elif numbers[i] != target:
            problems.append(f"row {i + 1}: printed {numbers[i]}, links to page {target}")

    report = {
        "file": path,
        "rows": len(rows),
        "outline_entries": len(outline),
        "expect_numbers": expect_numbers,
        "printed": numbers,
        "targets": [t for t, _ in rows],
        "problems": problems,
        "ok": not problems,
    }
    if as_json:
        sys.stdout.write(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    else:
        sys.stdout.write(f"{path}\n")
        sys.stdout.write(f"  TOC rows     : {report['rows']}\n")
        sys.stdout.write(f"  outline      : {report['outline_entries']}\n")
        sys.stdout.write(f"  printed      : {numbers}\n")
        sys.stdout.write(f"  link targets : {report['targets']}\n")
        if problems:
            for p in problems:
                sys.stdout.write(f"  FAIL  {p}\n")
        else:
            sys.stdout.write("  OK  every row links to its printed page\n")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
