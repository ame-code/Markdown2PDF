import pymupdf

for tag, p in [("golden", r"golden\typora-export-test.pdf"),
               ("c124", r"out\chroma\chrome124.pdf"),
               ("c153", r"out\chroma\chrome153.pdf")]:
    d = pymupdf.open(p)
    pg = d[0]
    print("==", tag, "size", pg.rect)
    for b in pg.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                t = s["text"].strip()
                if t in ("Heading 1", "Heading 2") or "#include" in t or t.startswith("int main"):
                    print("   %-32r font=%-26s size=%5.2f x0=%7.2f x1=%7.2f w=%6.2f y0=%7.2f"
                          % (t[:30], s["font"], s["size"], s["bbox"][0], s["bbox"][2],
                             s["bbox"][2] - s["bbox"][0], s["bbox"][1]))
    names = sorted({f[3] for f in pg.get_fonts(full=True)})
    print("   fonts:", names)
    print("   text chars extracted:", len(pg.get_text("text")))
