import io, sys, pathlib

p = pathlib.Path(r"E:\work\reverse\markdown2pdf\src\build.js")
s = p.read_text(encoding="utf-8")
orig = s

pairs = [
    ("const headingCss = await page.evaluate(",
     "const headingCss = await session.evaluate("),
    ("if (headingCss) await page.addStyleTag({ content: headingCss });",
     "if (headingCss) await session.addStyle(headingCss);"),
    ("const pdf = await printPage(page, print);",
     "const pdf = await session.printToPDF(print);"),
    ("const computed = await page.evaluate(",
     "const computed = await session.evaluate("),
    ("const bodyHtml = await page.evaluate(",
     "const bodyHtml = await session.evaluate("),
    ("JSON.stringify(await page.evaluate(",
     "JSON.stringify(await session.evaluate("),
    ("        await page.close();",
     "        // the session keeps the page for the next pass"),
    ("const browser = await launchBrowser(chromePath ? { executablePath: chromePath } : {});",
     "const session = await openSession({ engine, electron, chromePath });"),
    ("await renderPass(tocPages, 1);", "await renderPass(tocPages, 1, session);"),
    ("await renderPass(tocPages, i);", "await renderPass(tocPages, i, session);"),
    ("    await browser.close();", "    await session.close();"),
    ("renderBand(browser, {", "renderBand(session, {"),
]

for a, b in pairs:
    if a not in s:
        print("MISS:", a[:60])
    s = s.replace(a, b)

p.write_text(s, encoding="utf-8")
import re
left = [(m.group(0), s[:m.start()].count("\n") + 1) for m in re.finditer(r"\b(browser|page)\b", s)]
print("changed:", s != orig, "| leftover tokens:", left)
