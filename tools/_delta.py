import json

import numpy as np
import pymupdf

DPI = 150
Z = DPI / 72.0


def arr(page, clip=None, dpi=DPI):
    z = dpi / 72.0
    pm = page.get_pixmap(matrix=pymupdf.Matrix(z, z), clip=clip, alpha=False)
    return np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.height, pm.width, pm.n)


G = pymupdf.open(r"golden\typora-export-test.pdf")[0]
A = pymupdf.open(r"out\chroma\chrome124.pdf")[0]
B = pymupdf.open(r"out\chroma\chrome153.pdf")[0]

g, a, b = arr(G), arr(A), arr(B)
mask = np.any(g != b, axis=2)
deltas = np.abs(g.astype(np.int16) - b.astype(np.int16)).max(axis=2)
dd = deltas[mask]
print("page diff %.4f%%  differing px %d" % (mask.sum() / mask.size * 100, mask.sum()))
print("delta on differing px: mean %.1f  median %d  p90 %d  p99 %d  max %d"
      % (dd.mean(), np.median(dd), np.percentile(dd, 90), np.percentile(dd, 99), dd.max()))
for thr in (8, 16, 32, 64, 128):
    print("  %%%d px with delta > %d: %.2f%%" % (thr, thr, (dd > thr).mean() * 100))

# ---- CJK paragraph: high zoom side-by-side -------------------------------
rect = G.search_for("普通段落")[0]
line = pymupdf.Rect(rect.x0 - 2, rect.y0 - 6, rect.x1 + 150, rect.y1 + 8)
print("cjk clip", line)

cw, ch = line.width, line.height
gap, label_h = 6, 12
doc = pymupdf.open()
pg = doc.new_page(width=cw * 2 + gap, height=ch + label_h)
pg.draw_rect(pymupdf.Rect(0, 0, cw * 2 + gap, ch + label_h), color=None, fill=(1, 1, 1))
L = pymupdf.Rect(0, label_h, cw, label_h + ch)
R = pymupdf.Rect(cw + gap, label_h, cw * 2 + gap, label_h + ch)
pg.show_pdf_page(L, pymupdf.open(r"golden\typora-export-test.pdf"), 0, clip=line)
pg.show_pdf_page(R, pymupdf.open(r"out\chroma\chrome153.pdf"), 0, clip=line)
pg.draw_rect(L, color=(0.8, 0.8, 0.8), width=0.3)
pg.draw_rect(R, color=(0.8, 0.8, 0.8), width=0.3)
pg.insert_text((2, 9), "golden (Chromium 124, CJK = embedded MicrosoftYaHei)", fontsize=6)
pg.insert_text((cw + gap + 2, 9), "Chromium 153 (CJK = Type3 glyph procedures)", fontsize=6, color=(0.8, 0.1, 0.1))
z = 900 / 72.0
pm = pg.get_pixmap(matrix=pymupdf.Matrix(z, z), alpha=False)
pm.save(r"out\chroma\r153\crop-cjk-900dpi.png")
print("saved crop-cjk-900dpi.png", pm.width, "x", pm.height)

# same crop for latin-only heading
hrect = G.search_for("Heading 1")[0]
hclip = pymupdf.Rect(hrect.x0 - 2, hrect.y0 - 4, hrect.x1 + 20, hrect.y1 + 4)
doc2 = pymupdf.open()
pg2 = doc2.new_page(width=hclip.width * 2 + gap, height=hclip.height + label_h)
pg2.draw_rect(pymupdf.Rect(0, 0, hclip.width * 2 + gap, hclip.height + label_h), color=None, fill=(1, 1, 1))
L2 = pymupdf.Rect(0, label_h, hclip.width, label_h + hclip.height)
R2 = pymupdf.Rect(hclip.width + gap, label_h, hclip.width * 2 + gap, label_h + hclip.height)
pg2.show_pdf_page(L2, pymupdf.open(r"golden\typora-export-test.pdf"), 0, clip=hclip)
pg2.show_pdf_page(R2, pymupdf.open(r"out\chroma\chrome153.pdf"), 0, clip=hclip)
pg2.draw_rect(L2, color=(0.8, 0.8, 0.8), width=0.3)
pg2.draw_rect(R2, color=(0.8, 0.8, 0.8), width=0.3)
pg2.insert_text((2, 9), "golden / Chromium 124", fontsize=6)
pg2.insert_text((hclip.width + gap + 2, 9), "Chromium 153 (whole page shifted -0.25pt)", fontsize=6, color=(0.8, 0.1, 0.1))
pm2 = pg2.get_pixmap(matrix=pymupdf.Matrix(900 / 72.0, 900 / 72.0), alpha=False)
pm2.save(r"out\chroma\r153\crop-heading-900dpi.png")
print("saved crop-heading-900dpi.png", pm2.width, "x", pm2.height)

json.dump({"page_diff_pct": round(mask.sum() / mask.size * 100, 4),
           "delta_mean": round(float(dd.mean()), 2),
           "delta_p99": int(np.percentile(dd, 99))},
          open(r"out\chroma\r153\delta.json", "w"), indent=2)
