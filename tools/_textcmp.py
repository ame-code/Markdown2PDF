import pymupdf

def page_text(p):
    d = pymupdf.open(p)
    return [pg.get_text("text") for pg in d]

g = page_text(r"golden\typora-export-test.pdf")
a = page_text(r"out\chroma\chrome124.pdf")
b = page_text(r"out\chroma\chrome153.pdf")

for tag, txt in (("golden", g), ("c124", a), ("c153", b)):
    print("==", tag, "chars", len(txt[0]))
    print(repr(txt[0][:150]))
    print()

print("golden == c124 :", g[0] == a[0])
print("golden == c153 :", g[0] == b[0])
# find first difference position
for i, (x, y) in enumerate(zip(g[0], b[0])):
    if x != y:
        print("first char diff at", i, repr(g[0][max(0, i - 10):i + 20]), "vs", repr(b[0][max(0, i - 10):i + 20]))
        break
else:
    print("no char diff (same prefix)")
