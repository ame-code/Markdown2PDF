#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Compare two same-content PDFs at text/paint level and produce visual diff artifacts.

Usage:
  python tools/chroma-compare.py A.pdf B.pdf --out out/chroma [--dpi 150] [--crop-dpi 300] [--top 4]
    A = candidate (e.g. Chromium 153), B = baseline (e.g. golden Typora PDF / Chromium 124)

Outputs, in --out:
  spans.txt          span-by-span alignment (text / font / size / x,y) with deltas
  regions.json       differing regions (page-pt bbox + overlapping text + pixel counts)
  overlay-<tag>.png  baseline page with red boxes around differing regions
  crop-<n>-<tag>.png baseline | candidate side-by-side crops, labelled
"""
import argparse
import json
import os

import numpy as np
import pymupdf


def pixmap_array(page, dpi, clip=None):
    z = dpi / 72.0
    pm = page.get_pixmap(matrix=pymupdf.Matrix(z, z), clip=clip, alpha=False)
    arr = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.width, pm.n)
    return arr


def diff_mask(a, b):
    if a.shape != b.shape:
        h = min(a.shape[0], b.shape[0])
        w = min(a.shape[1], b.shape[1])
        a, b = a[:h, :w], b[:h, :w]
    return np.any(a != b, axis=2)


def regions_from_mask(mask, block=6, min_blocks=3):
    """Cluster differing pixels into rectangular regions via a coarse block grid."""
    h, w = mask.shape
    gh, gw = h // block, w // block
    grid = np.zeros((gh, gw), dtype=bool)
    for gy in range(gh):
        rows = mask[gy * block:(gy + 1) * block, :]
        cols = rows.reshape(block, gw, block).sum(axis=(0, 2))
        grid[gy] = cols > 0

    seen = np.zeros_like(grid)
    out = []
    for gy in range(gh):
        for gx in range(gw):
            if not grid[gy, gx] or seen[gy, gx]:
                continue
            stack = [(gy, gx)]
            seen[gy, gx] = True
            y0 = y1 = gy
            x0 = x1 = gx
            n = 0
            while stack:
                cy, cx = stack.pop()
                n += 1
                y0, y1 = min(y0, cy), max(y1, cy)
                x0, x1 = min(x0, cx), max(x1, cx)
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        ny, nx = cy + dy, cx + dx
                        if 0 <= ny < gh and 0 <= nx < gw and grid[ny, nx] and not seen[ny, nx]:
                            seen[ny, nx] = True
                            stack.append((ny, nx))
            if n >= min_blocks:
                out.append({"block": [x0, y0, x1 + 1, y1 + 1], "blocks": n,
                            "px": int(mask[y0 * block:(y1 + 1) * block, x0 * block:(x1 + 1) * block].sum())})
    out.sort(key=lambda r: r["px"], reverse=True)
    return out


def block_to_pt(block, block_px, dpi, page_h_px):
    x0, y0, x1, y1 = block
    z = dpi / 72.0
    return (x0 * block_px / z, page_h_px - y1 * block_px + 0, x1 * block_px / z, page_h_px - y0 * block_px)


def text_in(page, rect, pad=3):
    r = pymupdf.Rect(rect[0] - pad, rect[1] - pad, rect[2] + pad, rect[3] + pad)
    return page.get_text("text", clip=r, sort=True).strip()


def label_crops(doc_a, doc_b, page_no, regions_pt, out_dir, tag_a, tag_b, crop_dpi, top):
    """Build one PNG per region: [candidate | baseline] side by side, labelled."""
    made = []
    for i, reg in enumerate(regions_pt[:top], start=1):
        clip = pymupdf.Rect(reg["rect"])
        pad = 6
        clip = pymupdf.Rect(clip.x0 - pad, clip.y0 - pad, clip.x1 + pad, clip.y1 + pad)
        pa = doc_a[page_no]
        pb = doc_b[page_no]
        # show_pdf_page needs Documents, not Pages
        src_a, src_b = doc_a, doc_b
        # size the composite page in points, preserving each crop's aspect
        cw, ch = clip.width, clip.height
        gap = 8
        label_h = 14
        width = cw * 2 + gap
        height = ch + label_h
        out_doc = pymupdf.open()
        page = out_doc.new_page(width=width, height=height)
        page.draw_rect(pymupdf.Rect(0, 0, width, height), color=None, fill=(1, 1, 1))
        left = pymupdf.Rect(0, label_h, cw, label_h + ch)
        right = pymupdf.Rect(cw + gap, label_h, cw * 2 + gap, label_h + ch)
        page.show_pdf_page(left, src_b, page_no, clip=clip)
        page.show_pdf_page(right, src_a, page_no, clip=clip)
        page.draw_rect(left, color=(0.75, 0.75, 0.75), width=0.4)
        page.draw_rect(right, color=(0.75, 0.75, 0.75), width=0.4)
        page.insert_text((2, 10), f"{tag_b} (baseline)", fontsize=7, color=(0.2, 0.2, 0.2))
        page.insert_text((cw + gap + 2, 10), f"{tag_a} (candidate)", fontsize=7, color=(0.8, 0.1, 0.1))
        z = crop_dpi / 72.0
        pm = page.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=False)
        name = os.path.join(out_dir, f"crop-{i}-{tag_a.replace(' ', '_')}.png")
        pm.save(name)
        made.append(name)
        out_doc.close()
    return made


def overlay(doc_b, page_no, regions_pt, out_path, dpi, tag_b):
    src = doc_b[page_no]
    out_doc = pymupdf.open()
    page = out_doc.new_page(width=src.rect.width, height=src.rect.height + 16)
    page.show_pdf_page(pymupdf.Rect(0, 16, src.rect.width, 16 + src.rect.height), doc_b, page_no)
    page.insert_text((4, 11), f"{tag_b}: red = differing pixels ({len(regions_pt)} regions)", fontsize=8, color=(0.6, 0, 0))
    for reg in regions_pt:
        r = pymupdf.Rect(reg["rect"])
        page.draw_rect(pymupdf.Rect(r.x0, r.y0 + 16, r.x1, r.y1 + 16), color=(1, 0, 0), width=0.8)
    z = dpi / 72.0
    pm = page.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=False)
    pm.save(out_path)
    out_doc.close()


def span_rows(doc):
    rows = []
    for pno, page in enumerate(doc):
        for blk in page.get_text("dict")["blocks"]:
            for line in blk.get("lines", []):
                for sp in line.get("spans", []):
                    if not sp["text"].strip():
                        continue
                    rows.append({
                        "page": pno + 1,
                        "text": sp["text"],
                        "font": sp["font"],
                        "size": round(sp["size"], 2),
                        "x": round(sp["bbox"][0], 2),
                        "y": round(sp["bbox"][1], 2),
                        "w": round(sp["bbox"][2] - sp["bbox"][0], 2),
                        "h": round(sp["bbox"][3] - sp["bbox"][1], 2),
                    })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--out", default="out/chroma")
    ap.add_argument("--dpi", type=int, default=150)
    ap.add_argument("--crop-dpi", type=int, default=300)
    ap.add_argument("--top", type=int, default=4)
    ap.add_argument("--tag-a", default="candidate")
    ap.add_argument("--tag-b", default="baseline")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    A, B = pymupdf.open(args.a), pymupdf.open(args.b)
    summary = {"a": args.a, "b": args.b, "pages": []}

    # ---- text level -------------------------------------------------------
    sa, sb = span_rows(A), span_rows(B)
    lines = []
    fontdiff = {}
    for r in sa:
        key = (r["page"], r["text"])
        fontdiff.setdefault(r["font"], 0)
    fonts_a = sorted({r["font"] for r in sa})
    fonts_b = sorted({r["font"] for r in sb})
    lines.append(f"fonts A ({len(fonts_a)}): {fonts_a}")
    lines.append(f"fonts B ({len(fonts_b)}): {fonts_b}")
    n = min(len(sa), len(sb))
    moved = []
    for i in range(n):
        ra, rb = sa[i], sb[i]
        dy = round(ra["y"] - rb["y"], 2)
        dx = round(ra["x"] - rb["x"], 2)
        if dy or dx or ra["text"] != rb["text"] or ra["font"] != rb["font"]:
            moved.append({"i": i, "text_a": ra["text"], "text_b": rb["text"],
                          "dx": dx, "dy": dy, "font_a": ra["font"], "font_b": rb["font"],
                          "size_a": ra["size"], "size_b": rb["size"]})
    lines.append(f"spans: A={len(sa)} B={len(sb)} mismatched={len(moved)}")
    for m in moved[:40]:
        lines.append(f"  [{m['i']}] {m['text_a']!r} vs {m['text_b']!r}  dx={m['dx']} dy={m['dy']} "
                     f"size {m['size_a']}/{m['size_b']}  font {m['font_a']} / {m['font_b']}")
    with open(os.path.join(args.out, "spans.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    summary["text"] = {"spans_a": len(sa), "spans_b": len(sb), "mismatched": len(moved),
                       "fonts_a": fonts_a, "fonts_b": fonts_b, "first_moved": moved[:10]}

    # ---- pixel level ------------------------------------------------------
    n_pages = min(A.page_count, B.page_count)
    crops = []
    for pno in range(n_pages):
        arr_a = pixmap_array(A[pno], args.dpi)
        arr_b = pixmap_array(B[pno], args.dpi)
        mask = diff_mask(arr_a, arr_b)
        total = float(mask.sum()) / mask.size * 100.0
        h_px = arr_b.shape[0]
        regions = regions_from_mask(mask)
        # convert to page points (pymupdf y is top-down here because we use the pixel grid)
        regs_pt = []
        for r in regions:
            x0, y0, x1, y1 = r["block"]
            scale = 72.0 / args.dpi * 6  # 6 px blocks
            rect = [x0 * scale, y0 * scale, x1 * scale, y1 * scale]
            regs_pt.append({"rect": [round(v, 2) for v in rect], "px": r["px"],
                            "text": text_in(B[pno], rect)})
        crops += label_crops(A, B, pno, regs_pt, args.out, args.tag_a, args.tag_b, args.crop_dpi, args.top)
        ov = os.path.join(args.out, f"overlay-p{pno + 1}.png")
        overlay(B, pno, regs_pt, ov, args.dpi, args.tag_b)
        summary["pages"].append({"page": pno + 1, "diff_pct": round(total, 4),
                                 "regions": len(regs_pt),
                                 "top_regions": regs_pt[:args.top]})
        if pno == 0:
            summary["overlay"] = ov

    summary["crops"] = crops
    with open(os.path.join(args.out, "regions.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)

    for p in summary["pages"]:
        print(f"page {p['page']}: diff {p['diff_pct']:.4f}%  regions {p['regions']}")
        for r in p["top_regions"]:
            print(f"   rect {r['rect']}  px {r['px']}  text={r['text'][:60]!r}")
    print(f"spans mismatched: {summary['text']['mismatched']} (A {summary['text']['spans_a']} / B {summary['text']['spans_b']})")
    print(f"fonts A: {fonts_a}")
    print(f"fonts B: {fonts_b}")


if __name__ == "__main__":
    main()
