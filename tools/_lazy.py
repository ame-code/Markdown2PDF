import pathlib

p = pathlib.Path(r"E:\work\reverse\markdown2pdf\src\session.js")
s = p.read_text(encoding="utf-8")
subs = [
    ("    this.page = await loadHtmlPage(this.browser, htmlPath, {});",
     "    const { loadHtmlPage } = await printApi();\n    this.page = await loadHtmlPage(this.browser, htmlPath, {});"),
    ("    return printPage(this.page, { ...CONTENT_PRINT, ...opts });",
     "    const { printPage } = await printApi();\n    return printPage(this.page, { ...CONTENT_PRINT, ...opts });"),
    ("    const { printHtmlString } = await import('./print.js');",
     "    const { printHtmlString } = await printApi();"),
    ("  const browser = await launchBrowser(o.chromePath ? { executablePath: o.chromePath } : {});",
     "  const { launchBrowser } = await printApi();\n  const browser = await launchBrowser(o.chromePath ? { executablePath: o.chromePath } : {});"),
]
for a, b in subs:
    if a not in s:
        print("MISS:", a[:60])
    s = s.replace(a, b)
p.write_text(s, encoding="utf-8")
print("written")
