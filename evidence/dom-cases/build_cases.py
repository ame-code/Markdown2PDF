# -*- coding: utf-8 -*-
"""Build E:\\work\\reverse\\markdown2pdf\\evidence\\dom-cases\\cases.json
Artifact-sourced cases are extracted verbatim from the real Typora print export so the
fixtures cannot drift from the ground truth. Derived cases are literal templates taken
from frame.js (see evidence/dom-spec.md for offsets).
"""
import io, json, os

ART = r"E:\work\reverse\reverse-typora-export\evidence\real-export-html-MATH.html"
OUT = r"E:\work\reverse\markdown2pdf\evidence\dom-cases\cases.json"

html = io.open(ART, encoding="utf-8").read()


def sl(start, end):
    i = html.index(start)
    j = html.index(end, i)
    return html[i:j + len(end)]


h1 = sl("<h1>", "</h1>")
h2 = sl("<h2>", "</h2>")
p1 = sl("<p><span>", "</p>")
bq = sl("<blockquote>", "</blockquote>")
ul = sl("<ul>", "</ul>")
ol = sl("<ol start='' >", "</ol>")
tbl = sl("<figure", "</figure>")
imgp = sl("<p><img", "</p>")

cases = []


def c(cid, markdown, expected, source, notes):
    cases.append(dict(id=cid, markdown=markdown, expectedHtml=expected,
                      source=source, notes=notes))


# ---------------------------------------------------------------- artifact
c("heading.h1-anchor", "# Heading 1", h1, "artifact",
  "Print mode heading: anchor element first, no id attribute. cid n0 in this document (numbering UNKNOWN, dom-spec.md 1.4).")
c("heading.h2-anchor", "## Heading 2", h2, "artifact",
  "cid n2 in the source document; node numbering is UNKNOWN (dom-spec.md 1.4).")
c("paragraph.inline-mix",
  "普通段落，包含 **粗体**、*斜体*、`inline code`、[链接](https://example.com)。",
  p1, "artifact",
  "Plain text runs are span-wrapped; code span has no inner span; link href uses single quotes.")
c("blockquote.two-lines", "> blockquote 引用\n> 第二行", bq, "artifact",
  "The newline inside <p> is the softbreak token, emitted literally as \"\\n\".")
c("list.ul-tight", "- list\n- list\n- list", ul, "artifact",
  "Print mode keeps <p> inside tight list items.")
c("list.ol-start-empty", "1. ordered\n2. ordered", ol, "artifact",
  "An empty model start emits \" start='' \" (space before the closing >).")
c("table.basic", "| A | B |\n|---|---|\n| 1 | 2 |", tbl, "artifact",
  "First row becomes thead/th, remaining rows tbody/td; no colgroup.")
c("hr", "---", "<hr />", "artifact", "Space before /> is real.")
c("image.block", "![image](typora-export-test-image.png)", imgp, "artifact",
  "src is machine-specific: file:// + path with forward slashes + ?lastModify=<ms>. "
  "DOM-serialized, so double quotes and lowercase referrerpolicy, no self-closing slash.")

# ------------------------------------------------------------ code-derived
c("paragraph.empty", "", "<p>&nbsp;</p>", "code-derived",
  "Empty inline content becomes &nbsp; (frame.js:701930).")
c("inline.code-span", "`a-b;c`", "<p><code>a-b;c</code></p>", "code-derived",
  "Code span text is trimmed, escaped and split on /([-;]+)/ then re-joined; no span inside.")
c("inline.strong-em", "**b** *i*",
  "<p><strong><span>b</span></strong><span> </span><em><span>i</span></em></p>",
  "code-derived", "The whitespace run between tokens gets its own span.")
c("inline.mark-sub-sup-u-del", "==m== ~s~ ^p^ ++u++ ~~d~~",
  "<p><mark><span>m</span></mark><span> </span><sub><span>s</span></sub><span> </span>"
  "<sup><span>p</span></sup><span> </span><u><span>u</span></u><span> </span>"
  "<del><span>d</span></del></p>",
  "code-derived", "highlight/sub/sup/underline/del wrappers; inner content keeps its span.")
c("inline.escaping", "a & b < c > d \" e ' f",
  "<p><span>a &amp; b &lt; c &gt; d &quot; e &#39; f</span></p>", "code-derived",
  "escape() maps & < > \" ' to entities inside text content (frame.js:1517380).")
c("inline.hardbreak", "line1  \nline2",
  "<p><span>line1</span><br/><span>line2</span></p>", "code-derived",
  "Hard break renders <br/> (no space), unlike <hr />.")
c("inline.emoji", ":smile:", "<p>\U0001F604</p>", "code-derived",
  "Emoji token returns the raw character (no span) unless monocolorEmoji is on.")
c("link.external", "[x](https://example.com/?a=1&b=2)",
  "<p><a href='https://example.com/?a=1&amp;b=2'><span>x</span></a></p>", "code-derived",
  "href passes through escapeForPreWrap, so & becomes &amp;.")
c("link.internal", "# Target\n\n[jump](#target)",
  "<p><a href='#header-n0'><span>jump</span></a></p>", "code-derived",
  "Print mode rewrites #anchor to #header-<cid>; cid placeholder n0.")
c("list.task", "- [ ] a\n- [x] b",
  "<ul><li class='md-task-list-item task-list-item task-list-not-done' >"
  "<input type='checkbox' /><p><span>a</span></p></li>"
  "<li class='md-task-list-item task-list-item task-list-done' >"
  "<input type='checkbox' checked/><p><span>b</span></p></li></ul>",
  "code-derived",
  "Trailing space after the class value; no space before /> when checked (frame.js:703500).")
c("list.nested-ul", "- a\n  - b",
  "<ul><li><p><span>a</span></p><ul><li><p><span>b</span></p></li></ul></li></ul>",
  "code-derived", "The child list sits inside the parent <li>, after its paragraph.")
c("list.loose", "- a\n\n- b",
  "<ul><li><p><span>a</span></p></li><li><p><span>b</span></p></li></ul>",
  "code-derived",
  "In print mode loose and tight lists render identically (the unwrap only happens with noStyle).")
c("list.ol-start-3", "3. a\n4. b",
  "<ol start='3' ><li><p><span>a</span></p></li><li><p><span>b</span></p></li></ol>",
  "code-derived", "A numeric start other than 1 keeps the attribute, with the trailing space.")
c("table.align", "| A | B |\n|:--|--:|\n| 1 | 2 |",
  "<figure class='table-figure'><table><thead><tr>"
  "<th style='text-align:left;' ><span>A</span></th>"
  "<th style='text-align:right;' ><span>B</span></th></tr></thead><tbody><tr>"
  "<td style='text-align:left;' ><span>1</span></td>"
  "<td style='text-align:right;' ><span>2</span></td></tr></tbody></table></figure>",
  "code-derived",
  "Attribute text is \"] style='text-align:\"+align+\";' [\"] i.e. value = \"text-align:left;\" and one space after the closing quote, before >. Applied to th and td.")
c("table.empty-cell", "| A | B |\n|---|---|\n| | 2 |",
  "<figure class='table-figure'><table><thead><tr><th><span>A</span></th>"
  "<th><span>B</span></th></tr></thead><tbody><tr><td>&nbsp;</td>"
  "<td><span>2</span></td></tr></tbody></table></figure>",
  "code-derived", "Empty cell content becomes &nbsp;.")
c("heading.h1-breakpage", "# One\n\npara\n\n# Two",
  "<h1 data-breakpage><a name=\"header-n4\" class=\"md-header-anchor md-print-anchor\" "
  "href=\"af://n4\"> </a><span>Two</span></h1>",
  "code-derived",
  "Every non-first top-level h1 gets data-breakpage in print mode (frame.js:702820).")
c("footnote.ref", "text[^1]\n\n[^1]: note",
  "<p><span>text</span><sup class='md-footnote'><a href='#dfref-footnote-1' "
  "name='ref-footnote-1'>1</a></sup></p>",
  "code-derived",
  "The footnotes area is appended after every block: "
  "<div class='footnotes-area' data-breakpage ><hr/>"
  "<div class='footnote-line'><span class='md-fn-count'>1</span> ..."
  " <a name='dfref-footnote-1' href='#ref-footnote-1' title='back to document' "
  "class='reversefootnote' >\u21a9</a></div></div>")
c("yaml.meta-dropped", "---\ntitle: t\n---\n\npara", "<p><span>para</span></p>",
  "code-derived", "meta_block exports as the empty string: YAML front matter disappears.")
c("html.block-passthrough", '<div class="note">hi</div>', '<div class="note">hi</div>',
  "code-derived",
  "Raw HTML blocks are sanitized (class/id kept) and emitted with no wrapper element.")

os.makedirs(os.path.dirname(OUT), exist_ok=True)
data = json.dumps(cases, ensure_ascii=False, indent=1)
io.open(OUT, "w", encoding="utf-8", newline="\n").write(data + "\n")

# ---- self check
back = json.load(io.open(OUT, encoding="utf-8"))
assert len(back) == len(cases)
bad = []
for x in back:
    if x["source"] == "artifact" and x["expectedHtml"] not in html:
        bad.append(x["id"])
print("cases:", len(back))
print("artifact mismatches:", bad)
print("bytes:", os.path.getsize(OUT))
