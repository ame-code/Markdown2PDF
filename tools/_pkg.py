import json, pathlib

p = pathlib.Path(r"E:\work\reverse\markdown2pdf\package.json")
j = json.loads(p.read_text(encoding="utf-8"))
j["main"] = "electron/main.js"
s = j.setdefault("scripts", {})
s["electron:build"] = (
    'node bin/md2pdf.js golden/typora-export-test.md -o out/electron-acceptance.pdf '
    '--footer "No. ${pageNo} / ${totalPages}" --author 一苇'
)
s["electron:start"] = "electron ."
p.write_text(json.dumps(j, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("main =", j["main"])
print("scripts =", list(s))
