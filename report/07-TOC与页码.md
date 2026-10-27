# 07 · `[TOC]` 与目录页码

需求来源：Typora 自己的 `[TOC]` 只输出标题文字与链接，**不印页码**。用户要的是
「打印/装订出来的纸稿上，读者能按目录翻页」，所以这是对 Typora 的一个**增量扩展**，
同时必须保持其余部分与原主题逐像素一致。

## 观察

### 7.1 拿不到 Typora 的 TOC 内部结构

`frame.js` 里 `A.toc` 的分支只吐出占位符（编辑器内部由 `TOC` 组件在 DOM 里维护），
实机导出的 golden HTML 里没有 TOC 样本，`evidence/dom-cases/cases.json` 的 28 条 fixture
也不含 TOC。因此「Typora 的 toc DOM 长什么样」无法确证。

**但主题 CSS 里留着它**：`vendor/style/base.css` 本身就是 Typora 的样式表，其中：

```css
.md-toc { min-height: 3.58rem; position: relative; font-size: .9rem; border-radius: 10px; }
.md-toc-item { display: block; color: #4183c4; }
.md-toc-h1 .md-toc-inner { margin-left: 0; font-weight: 700; }
.md-toc-h2 .md-toc-inner { margin-left: 2em; }
/* h3/h4/h5/h6 → 4em / 6em / 8em / 10em */
a.md-toc-inner { font-size: inherit; font-style: inherit; font-weight: inherit; line-height: inherit; }
```

这比猜测可靠：只要用同一套类名，字号（`.9rem`，打印态 `html{font-size:13px}` ⇒ 11.7px）、
每级缩进（2em）、颜色（`#4183c4`）、条目间距就**自动继承 Typora 的真实值**，
不需要在主题之外另建一套排版。

### 7.2 页码从哪来

第一版的想法是「打印完再量标题文字坐标」，这是错的：标题多、跨页、重复标题都会干扰，
而且量出来的纵坐标还得反推页码。真正可靠的来源是书签阶段已经在用的那份数据 ——
Chromium 打印时会给每个 `<a href="#header-nX">` / `<a name=…>` 生成链接注释：

- 标题上的 `af://nX` → `kind=3`（LINK_LAUNCH），没有解析页码，用于**书签**；
- TOC 条目里的 `href="#header-nX"` → `kind=4`（LINK_NAMED），`page` 已解析成目标页下标，
  用于**目录页码**。

也就是说：**TOC 行 → 目标页** 有直接证据，**标题 → 页** 走已有 `extractAnchors()`。
两者交叉校验即可，不需要文字抽取。

### 7.3 两遍渲染

页码要写进目录，而目录本身占版面、会改变分页 —— 必须渲染两次：

1. **第 1 遍**：TOC 占位符先渲染成「行数与层级都已确定、但页码为空」的真实条目
   （不是空 div，否则高度不对，第 2 遍页码会全部偏）；打印得到 `pageMap1`。
2. **第 2 遍**：用 `pageMap1` 填页码再打印，得到 `pageMap2`。
3. 若 `pageMap2` 与 `pageMap1` 对同一批标题给出不同页码，说明填数字改变了分页，
   继续迭代；最多 `MAX_TOC_PASSES = 4` 遍，仍未稳定就用最后一遍（并打印告警）。

实测：`test/toc.md`（7 个标题、2 页）第 1 遍与第 2 遍页码一致，**只多花约 0.6 s**。

关键细节：**TOC 占位符不消耗 cid**。`cid` 由 `CidGen` 按文档顺序发号，两遍渲染必须
给出同一份 `header-n<cid>`，否则第 2 遍的链接注释对不上第 1 遍量出的页码。

## 实现

| 文件 | 作用 |
| --- | --- |
| `src/toc.js` | 标记识别、条目收集、HTML 生成、`TOC_CSS`（只写主题没覆盖的部分） |
| `src/md2typora.js` | `isTocMarker()` 识别独占一行的 `[TOC]`；`hooks.toc()` 输出占位符 |
| `src/build.js` | `renderPass()` 闭包 + 迭代收敛 + `headingPageMap()` / `pageMapsDiffer()` |
| `bin/md2pdf.js` | `--toc-pages` / `--no-toc-pages` / `--toc-max-level` |
| `tools/toc_check.py` | 三重一致性校验器 |

生成的条目结构：

```html
<div class="md-toc" mdtype="toc" data-mdpdf-toc="1"><div class="md-toc-content">
  <div class="md-toc-item md-toc-h2"><a class="md-toc-inner" href="#header-n2">
    <span class="md-toc-text">第一章 概述</span>
    <span class="md-toc-leader"></span>
    <span class="md-toc-page">1</span>
  </a></div>
  …
</div></div>
```

`TOC_CSS` 只补三件事（其余全部继承 `base.css`）：

1. `a.md-toc-inner { display:flex; align-items:baseline }` —— 让文字、点线、页码同基线；
2. `.md-toc-leader` —— `flex:1` + `border-bottom:1px dotted rgba(0,0,0,.30)` + `translateY(-0.30em)`
   把点线压在基线下沿，形成传统目录的引导线；
3. `.md-toc-page { font-variant-numeric: tabular-nums; padding-left:.2em }` —— 页码等宽、右对齐。

`@media print { .md-toc-item > a.md-toc-inner { color: inherit } }` 把目录链接色改回正文色，
避免打印稿上一排蓝字（`#4183c4` 在屏幕上好看，纸上偏淡）。

### 识别规则

只认「整段就是一个 `[TOC]`」，且大小写不敏感：

```js
isTocMarker(innerTokens) // 只接受 inline 内的 text / softbreak / hardbreak
                         // 拼接后 /^\[toc\]$/i
```

反例（都会被当作普通文字）：``` `[TOC]` ```（行内代码）、`[TOC]: 目录`（会被解析成链接定义）、
`见 [TOC] 一节`（段落里有别的字）。这样不会误伤正常文档。

## 证据位置

- `src/toc.js`（`TOC_PLACEHOLDER`、`collectTocEntries`、`renderToc`、`injectToc`、`TOC_CSS`）
- `src/build.js`（`MAX_TOC_PASSES`、`headingPageMap`、`pageMapsDiffer`、`renderPass`）
- `src/md2typora.js`（`isTocMarker`、`paragraph_open` 分支）
- `vendor/style/base.css`（Typora 自带 `.md-toc*` 规则，`grep -o '\.md-toc[^{]*{[^}]*}'`）
- `tools/toc_check.py`、`test/toc.md`、`out/toc.pdf`
- 链接注释结构：`tools/dump-annots.mjs` 与 pymupdf 的 `get_links()`（`kind=3` vs `kind=4`）

## 验证

```
$ node bin/md2pdf.js test/toc.md -o out/toc.pdf --footer "No. ${pageNo} / ${totalPages}"
$ python tools/toc_check.py out/toc.pdf
  TOC rows     : 7
  outline      : 7
  printed      : [1, 1, 1, 1, 1, 2, 2]
  link targets : [1, 1, 1, 1, 1, 2, 2]
  OK  every row links to its printed page
```

校验器验三件事，缺一不可：

1. TOC 行数 == outline 条目数（漏标题 / 多标题）；
2. 每行链接的目标页 == 该标题的 outline 页码（页码写错、锚点串号）；
3. 打印出来的数字 == 该行的目标页（数字与链接不同步）。

反过来，`--no-toc-pages` 的产物用 `tools/toc_check.py --no-numbers` 校验：数字列必须为空，
但链接仍然有效 —— 页码是**可选**的，不是靠删链接实现的。

回归：`npm test` 仍然全绿，其中 `tools/acceptance.mjs` **15/15 PASS**、
像素 `diff_body 0.0000%` —— 说明加 TOC 没有影响金标准文档（它没有 `[TOC]`）。

## 决策

1. **类名用 Typora 的（`md-toc` / `md-toc-content` / `md-toc-item` / `md-toc-hN` / `md-toc-inner`），
   不另造一套。** 理由：`base.css` 里已有完整样式，复用才能保证字号、缩进、配色与主题一致，
   自己写必然要重新对齐 `.9rem`、2em 阶梯、`#4183c4` 这些常数，且主题一换就错。
2. **页码走链接注释，不做文本测量。** 与书签同源，页码与纵坐标天然自洽。
3. **两遍渲染 + 收敛检查**，而不是「估一个 TOC 高度」。估高度在任何文档上都会错位。
4. **页码可关**（`--no-toc-pages`）。有些场景（屏幕阅读、或目录已由 PDF 书签承担）
   不希望纸面出现数字，此时保留可点击的结构。
5. **占位符不分配 cid**，保证两遍渲染的锚点编号一致。
6. **目录链接色在打印态改回正文色**：屏幕态保留 Typora 的蓝色，纸面用墨色。

## 未解决风险

- **Typora 原生 TOC 的 DOM 仍然未知**。本实现是「同类名 + 自带 CSS」的合理重建，
  与 Typora 编辑器内看到的目录**不保证**逐像素相同（Typora 版的条目可能还有折叠箭头等
  编辑器专用元素，导出态不可见）。如果将来拿到实机 TOC 样本，需要复核 `md-toc-item` 内部结构。
- **页码迭代不收敛的极端文档**：目录本身很长（例如 300 个标题占 3 页）、且填入数字后
  引起跨页重排，可能 4 遍仍未稳定。此时输出最后一遍并告警，页码可能有个别不准。
- **`maxLevel` 与书签不同步**：`--toc-max-level 2` 只影响目录显示，书签仍是全级。
  设计如此（书签是导航层，目录是版面层），但用户可能期望两者一致。
- **页码对「标题在目录之后但同页」的情况依赖 Chromium 的链接解析**。已验证 Chromium 124
  行为正确；换引擎需重跑 `tools/toc_check.py`。
- TOC 的 `data-mdpdf-toc` 属性是本工具自己的标记，不写进 PDF，无兼容性影响。
