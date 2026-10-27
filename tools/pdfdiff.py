#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Pixel + structural diff between two PDFs (golden Typora export vs our render).

Usage:
  python tools/pdfdiff.py A.pdf B.pdf [--dpi 150] [--json out.json] [--png-dir DIR] [--band 0.16]

Reports per page: page size (pt), changed-pixel ratio over the whole page and over
the "body" band (page minus footer/header bands, default 16%% at the bottom).
Also reports text-level stats (chars, fonts, words moved) to localise differences.
"""
import argparse
import json
import os
import sys

import fitz  # pymupdf


def rasterise(doc, dpi, png_dir=None, tag="x"):
    out = []
    zoom = dpi / 72.0
    mat = fitz.Matrix(zoom, zoom)
    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=mat, alpha=False)
        if png_dir:
            os.makedirs(png_dir, exist_ok=True)
            p = os.path.join(png_dir, f"{tag}-p{i + 1}.png")
            pix.save(p)
            out.append((pix, p))
        else:
            out.append((pix, None))
    return out


def band_diff(pa, pb, band):
    """Return (total_ratio, body_ratio, bbox_of_diff) between two pixmaps."""
    if (pa.width, pa.height) != (pb.width, pb.height):
        return None
    y_cut = int(pa.height * (1.0 - band))
    a, b = pa.samples, pb.samples
    n = pa.width * pa.height
    diff_total = 0
    diff_body = 0
    x0 = y0 = 10 ** 9
    x1 = y1 = -1
    stride = pa.width * pa.n
    for y in range(pa.height):
        row_a = a[y * stride:(y + 1) * stride]
        row_b = b[y * stride:(y + 1) * stride]
        if row_a == row_b:
            continue
        for x in range(pa.width):
            o = x * pa.n
            if row_a[o:o + pa.n] != row_b[o:o + pb.n]:
                diff_total += 1
                if y < y_cut:
                    diff_body += 1
                if x < x0:
                    x0 = x
                if x > x1:
                    x1 = x
                if y < y0:
                    y0 = y
                if y > y1:
                    y1 = y
    bbox = None if x1 < 0 else {"x0": x0, "y0": y0, "x1": x1, "y1": y1}
    return diff_total / n, diff_body / max(1, y_cut * pa.width), bbox


def page_stats(doc):
    rows = []
    for page in doc:
        d = page.get_text("dict")
        fonts = {}
        chars = 0
        for blk in d["blocks"]:
            for line in blk.get("lines", []):
                for span in line.get("spans", []):
                    key = f"{span['font']}@{round(span['size'], 2)}"
                    fonts[key] = fonts.get(key, 0) + len(span["text"])
                    chars += len(span["text"])
        rows.append({"rect": [round(v, 3) for v in page.rect], "chars": chars, "fonts": fonts,
                     "drawings": len(page.get_drawings()), "images": len(page.get_images())})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--dpi", type=int, default=150)
    ap.add_argument("--json")
    ap.add_argument("--png-dir")
    ap.add_argument("--band", type=float, default=0.16)
    ap.add_argument("--toc", action="store_true")
    args = ap.parse_args()

    A, B = fitz.open(args.a), fitz.open(args.b)
    result = {
        "a": {"path": args.a, "pages": A.page_count, "meta": A.metadata, "stats": page_stats(A)},
        "b": {"path": args.b, "pages": B.page_count, "meta": B.metadata, "stats": page_stats(B)},
        "pages": [],
    }
    if args.toc:
        result["a"]["toc"] = A.get_toc()
        result["b"]["toc"] = B.get_toc()

    ra = rasterise(A, args.dpi, args.png_dir, "A")
    rb = rasterise(B, args.dpi, args.png_dir, "B")
    n = max(len(ra), len(rb))
    for i in range(n):
        if i >= len(ra) or i >= len(rb):
            result["pages"].append({"page": i + 1, "error": "page missing in one document"})
            continue
        d = band_diff(ra[i][0], rb[i][0], args.band)
        if d is None:
            result["pages"].append({"page": i + 1, "error": "size mismatch",
                                    "a": [ra[i][0].width, ra[i][0].height],
                                    "b": [rb[i][0].width, rb[i][0].height]})
        else:
            total, body, bbox = d
            result["pages"].append({"page": i + 1, "diff_total": round(total * 100, 4),
                                    "diff_body": round(body * 100, 4), "bbox": bbox})

    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
