import sys, pymupdf
for f in sys.argv[1:]:
    doc = pymupdf.open(f)
    print("==", f)
    for pno, page in enumerate(doc):
        for b in page.get_text("dict")["blocks"]:
            if b["type"] != 0:
                continue
            for l in b["lines"]:
                for s in l["spans"]:
                    t = s["text"]
                    if not t.strip():
                        continue
                    x0, y0, x1, y1 = s["bbox"]
                    print(f" p{pno+1} [{x0:7.2f},{y0:7.2f},{x1:7.2f},{y1:7.2f}] {s['size']:5.2f} {s['font'][:34]:34s} {t!r}"[:160])
