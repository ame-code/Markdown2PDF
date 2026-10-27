import sys, pymupdf, re
f = sys.argv[1]
doc = pymupdf.open(f)
page = doc[0]
xref = page.get_contents()[0]
raw = doc.xref_stream(xref).decode("latin1")
# show the tail, where the drawn form XObjects usually are
ops = [m for m in re.finditer(r"([-\d\.\s]+)cm\s*/(\w+)\s+Do", raw)]
print(f"{f}: {len(ops)} Do-with-cm")
for m in ops:
    nums = [float(x) for x in m.group(1).split()]
    print("  cm", [round(n, 2) for n in nums], "->", m.group(2))
# also list XObject names available
print("  page height", page.rect.height)
if len(sys.argv) > 2:
    print(raw[-1500:])
