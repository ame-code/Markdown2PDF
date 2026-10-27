# Markdown → PDF 独立工具（复刻 Typora 1.9.5 + 主题 my）

不依赖 Typora 的 Markdown → PDF 转换器：把 Markdown 渲染成 **Typora 打印导出时的 DOM**，
套上与 Typora 一致的样式（`vendor/style/doc.css` + `code.css`，由实测命中规则生成）+ 主题 `my.css`，
用 **Chromium 124（与 Typora 同版本引擎）** 的 `Page.printToPDF` 出 PDF，
最后用 pdf-lib 补上页眉页脚、元数据、书签大纲。

验收结果：与 Typora 亲自导出的 `golden/typora-export-test.pdf` 对比 **逐像素 0.0000% 差异**、
链接注释/书签/元数据全部一致（`tools/acceptance.mjs` 15/15 PASS）。

```bash
node bin/md2pdf.js input.md -o out.pdf \
  --footer "No. ${pageNo} / ${totalPages}" --author "一苇"
```

## 拉取仓库后先补文件

`git clone` 只带走源码。`node_modules/`、`runtime/chromium-124/`（277 MB 的 Chromium 124）和 `dist/`
都在 `.gitignore` 里，一条命令补齐：

```bash
npm run bootstrap                 # npm ci + 下载 Chromium 124（134 MB）并裁到 en-US / zh-CN 两个语言包
npm test                          # 自检：围栏 / 公式 / DOM 一致性 + 与金标准 PDF 逐像素对比
npm run bootstrap -- --check      # 只报告缺什么，不下载（缺文件时退出码 1）
npm run bootstrap -- --force      # 两个步骤都重做
```

- Chromium 下载源是 Playwright 的 build 1112（`124.0.6367.29`）；Typora 1.9.5 内是 `124.0.6367.233`，
  同属 124 分支，出图逐像素一致。装好后默认路径自动指向 `runtime/chromium-124/chrome.exe`。
- 离线机器：`MDPDF_CHROMIUM_ZIP=<chromium-win64.zip> npm run bootstrap`；
  打包同理 `MDPDF_ELECTRON_ZIP_DIR=<含 electron-v30.0.9-win32-x64.zip 的目录> npm run pack`。
- 想用别的 Chromium：`--chrome <path>` 或环境变量 `MDPDF_CHROME`（必须是 124，见文末前提）。
- 只想拿现成程序、不想装 Node：到 GitHub Releases 下载 `md2pdf-win32-x64.zip`，解压即用。

## 命令选项

| 选项 | 说明 |
| --- | --- |
| `-o, --out <pdf>` | 输出 PDF（默认同目录同名） |
| `--theme <file\|name>` | 主题：路径，或 `my` / `github` / `newsprint` / `night` / `pixyll` / `whitey`（默认 `my`） |
| `--paper A4\|A3\|Letter` | 纸张，默认 A4（595.92 × 842.88 pt） |
| `--header <tpl>` / `--footer <tpl>` | 页眉/页脚模板，变量见下 |
| `--title` / `--author` / `--subject` / `--keywords a,b` | PDF 元数据 |
| `--html <file>` | 同时导出中间 HTML（调试用） |
| `--chrome <path>` | 指定 Chromium 可执行文件 |
| `--no-postprocess` | 只出 Chromium 原始 PDF（不写页眉页脚/书签/元数据） |
| `--toc-pages` / `--no-toc-pages` | `[TOC]` 是否在右侧印页码（默认印） |
| `--toc-max-level <n>` | `[TOC]` 收录到第几级标题（默认 6） |

模板变量：`${pageNo}` `${totalPages}` `${pageCount}` `${title}` `${author}` `${date}` `${time}` `${file}`。
未指定 `--title` 时 PDF 元数据 Title 为空（与 Typora 导出对话框默认一致），`<title>` 仍取文件名。

## 目录页码（`[TOC]`）

在 Markdown 里独占一行写 `[TOC]`，会渲染成 Typora 风格的目录，**并在右侧印上所在页码**：

```
目录页码测试 ····················································· 1
  第一章 概述 ··················································· 1
    1.1 小节 A ················································· 1
```

- 类名沿用 Typora 自带的 `.md-toc` / `.md-toc-item` / `.md-toc-hN` / `.md-toc-inner`，
  字号（`.9rem`）、每级缩进（2em）、配色（`#4183c4`）由主题 CSS 决定，主题一换自动跟随。
- 页码来源：Chromium 为 `href="#header-nX"` 生成的链接注释（`kind=4`，`page` 已解析），
  与书签同一份数据，不做文字测量。
- 实现是**两遍渲染**：第 1 遍量出每个标题的真实页码 → 第 2 遍写进目录；若写数字改变了分页，
  自动再迭代（最多 4 遍）。目录本身占版面，所以不能靠估高度。
- 目录条目可点击（跳到对应标题）；`--no-toc-pages` 只去掉数字，链接仍然有效。
- 打印时目录文字用正文色（屏幕上是 Typora 的链接蓝）。
- `[TOC]` 必须是整段内容；`` `[TOC]` ``（行内代码）、`见 [TOC] 一节` 都按普通文字处理。

## 独立可执行版（Electron）

`node bin/md2pdf.js` 还需要一台装有 Node 与 Chromium 124 的机器；如果只想要一个能直接拷走运行的程序，用 Electron 版：

```bash
npm run pack                       # 产物：dist/md2pdf-win32-x64/（210 MB，18 个文件）
                                   #       可直接压缩分发：dist/md2pdf-win32-x64.zip（90 MB）
dist/md2pdf-win32-x64/md2pdf.exe input.md -o out.pdf \
  --footer "No. ${pageNo} / ${totalPages}" --author "一苇"
```

**想放进 PATH 就加 `bin`，别加整个目录**：`dist/md2pdf-win32-x64/` 里是 Chromium 运行时（exe、dll、
pak、locales），直接加进 PATH 会把这些文件一并暴露出去。为此打包时生成一个 `bin/md2pdf.cmd`：

```bat
@echo off
"%~dp0..\md2pdf.exe" %*
```

把 `dist/md2pdf-win32-x64/bin` 加入 PATH 后，任意目录下 `md2pdf input.md -o out.pdf` 即可，参数、
当前工作目录、退出码都原样透传（`bin/` 里只有 `md2pdf.cmd` 与 `md2pdf.lnk` 两个文件）。

> 不要用符号链接或硬链接把 `md2pdf.exe` 链进 `bin/`：Electron 按 `process.execPath` 所在目录去找
> `resources/app.asar`、`locales/`、`icudtl.dat` 和 dll，链接后的路径会变成 `bin\md2pdf.exe`，
> 程序会直接启动失败。`.cmd` 转发之所以可行，正是因为真正被启动的仍是上一级的 exe。

`bin/` 里还有一个 `md2pdf.lnk`（快捷方式），它走的是**鼠标路径**而不是 PATH：把 `.md` 文件拖到这个
图标上，就会在其源文件旁边生成同名 PDF。注意 `.lnk` 不是可执行扩展名，`cmd`/PowerShell 永远不会把
`md2pdf` 解析成它，所以命令行调用仍靠上面的 `md2pdf.cmd`。两者的目标都是同一个 exe，图标也取自 exe。

命令行选项与 CLI 完全一致（同一套 `src/` 与 `vendor/`）。三个要点：

- **引擎就是 Typora 的引擎**。Electron 30.0.9 内置 Chromium **124.0.6367.233**，与 Typora 1.9.5 同一个
  patch 版本，所以不需要外部 Chromium，打印路径与原程序逐位一致；打包产物实测仍是
  **0.0000% 像素差异、`tools/acceptance.mjs` 15/15**。
- **体积构成**：`md2pdf.exe` 168.8 MB（Electron 本体，内含 Chromium + Node）＋ `app.asar` 10.2 MB
  （`src/`、`vendor/`、markdown-it、pdf-lib）＋ `icudtl.dat` 10.2 ＋ `LICENSES.chromium.html` 9.8 ＋
  `resources.pak` 5.1 ＋ 2 个语言包。已裁掉的东西：53 个语言包（−38 MB）、pdf-lib 的 UMD/ES/TS 副本
  （−15 MB）、GPU 三方库（−17 MB，程序调用 `app.disableHardwareAcceleration()`，打印走 CPU 光栅）、
  puppeteer 及其依赖树（Electron 版不需要，`src/print.js` 懒加载）。
- **打包需要 Electron 官方 zip**（首次会联网下载）。网络不通时可先把 `node_modules/electron/dist`
  压成 `electron-v30.0.9-win32-x64.zip`，再 `MDPDF_ELECTRON_ZIP_DIR=<目录> npm run pack`。
- **运行环境**：`dist/` 目录整体拷走即可，不需要安装；只支持 Windows x64（`@electron/packager` 换
  `--platform` 可出 mac/Linux 版）。如果环境里残留 `ELECTRON_RUN_AS_NODE=1`，进程会以纯 Node 启动，
  入口会直接报错退出（码 78）而不是给出难懂的异常。

## 目录

```
bin/md2pdf.js        CLI
electron/main.cjs    独立可执行版入口（Electron 主进程，CJS）
src/print.js         启动 Chromium + Page.printToPDF（参数见报告 02）
src/session.js       引擎抽象：PuppeteerSession / ElectronSession
src/md2typora.js     Markdown → Typora 打印 DOM（核心）
src/template.js      导出 HTML 外壳（逐字节复刻 frame.js 模板）
src/build.js         编排：DOM → 临时 HTML → 打印 → 后处理（含 TOC 两遍收敛）
src/toc.js           `[TOC]` 条目生成 + 页码样式
src/fence/           代码块：CodeMirror 5 DOM + 高亮
src/math/            数学公式：MathJax 3 tex-svg
src/bands.js         页眉/页脚带渲染
src/postprocess.js   书签大纲 + 元数据 + 页面叠加
vendor/style/        doc.css / code.css（自写等价样式，见报告 09）
vendor/themes/       my.css + Open Sans woff2（用户主题与其字体）
runtime/chromium-124 CLI 用的 Chromium 124（可执行文件，0% 差异的前提）
golden/              Typora 亲手导出的 PDF、源 md、参考打印 HTML
evidence/            DOM 规范、代码块规范、公式规范、28 条对照 fixtures、
                     css-originals/（Typora 原始样式表，只作审计输入，不分发）
tools/               acceptance.mjs（验收）、parity.mjs（DOM 对照）、pack.mjs（打包）、
                     css-audit.mjs + build-css.mjs（样式表审计与生成）、pdfdiff.py 等
report/              分阶段逆向报告
```

## 验证

```bash
npm test                           # 下面五项全跑
npm run pack                       # 打独立可执行版 → dist/md2pdf-win32-x64/
npm run css:audit                  # 生成五份审计样本并统计每条规则的命中数
npm run css:build                  # 由命中清单重新生成 vendor/style/doc.css、code.css
node bin/md2pdf.js golden/typora-export-test.md -o out/acceptance.pdf \
  --footer "No. ${pageNo} / ${totalPages}" --author "一苇"
node tools/acceptance.mjs          # 结构 / 书签 / 元数据 / 像素 四层对比
node tools/acceptance.mjs --out out/dist-p1.pdf   # 对打包好的 exe 产物做同样四层对比
node tools/parity.mjs              # 28 条 DOM fixtures 对照（26 通过 / 1 已知差异 / 1 已知缺口）
node src/fence/verify.js           # 代码块 DOM 逐字节对照（14/14）
node src/math/verify.js            # 公式 SVG 逐字节对照（17/17）
python tools/toc_check.py out/toc.pdf   # 目录：行数/链接目标页/打印数字 三重一致
```

覆盖性样例：`test/features.md`（h1–h6、任务列表、嵌套列表、对齐表格、行内/块公式含 `aligned`、
python 代码块、脚注、分隔线）→ `out/features.pdf`；`test/large.md`（多页 + 三级标题 + 页眉页脚）；
`test/fence.md`（cpp/python 高亮）；`test/toc.md`（`[TOC]` + 7 个标题 + 跨页页码）→ `out/toc.pdf`。

`pdfdiff.py` / `toc_check.py` 需要 PyMuPDF。默认按此顺序找解释器：
`MDPDF_PYTHON` 环境变量 → `reverse-typora-export\venv124` → 系统 `python`。

## 需要知道的前提

1. **必须用 Chromium 124**（Typora 1.9.5 / Electron 30.0.9 / Chromium 124.0.6367.233）。
   用 Chromium 153 时同一份 HTML 会出现 0.775% 的正文像素差异（数学符号字体回退不一致）。
   默认路径 `C:\Users\14578\AppData\Local\ms-playwright\chromium-1112\chrome-win\chrome.exe`。
2. **不要用 `page.pdf({format:'A4'})`**。Chromium 的 A4 命名纸张与 Typora 传的
   `paperSize:"A4"`（Electron 内部 595.92×842.88 pt）不是同一个尺寸，会整体偏移 28pt。
   本工具直接传 `paperWidth/paperHeight`（英寸）。
3. 数学公式需要 `src/math/vendor/` 保持目录结构（含 `input/tex/extensions/xypic.js`），
   且页面必须是 `file://`。
4. 独立可执行版只带 `en-US` 与 `zh-CN` 两个语言包（Chromium 其余语言回退到 en-US）。这对打印像素
   没有影响（主题里没有 `:lang()` / `hyphens`，页眉页脚日期在 Node 侧格式化），但页面里的
   `Intl` / `toLocaleDateString()` 与文档语言相关内容会按 en-US 求值。
5. 中文字形来自系统 `Microsoft YaHei`。在没有装中日韩字体的英文 Windows 上，中文会落到别的字库，
   像素对比不再保证 0.0000%（要跨机器一致需自带一份 CJK webfont，代价约 10 MB）。

## 样式表的来源与许可

`vendor/style/doc.css` 与 `code.css` 不是从 Typora 复制来的文件，而是**按需生成**的结果：
`tools/css-audit.mjs` 在真实打印态 DOM 上统计 Typora 原始 `base.css`（202 条规则）与
`codemirror.css`（77 条）里每条选择器的命中数，只保留真正参与打印的 78 + 31 条，
`tools/build-css.mjs` 再按**原源码顺序**重新书写（层叠顺序不能变），并加上本项目的分节与注释。
原始文件留在 `evidence/css-originals/` 仅作审计输入，**不进入分发包**（`app.asar` 里只有
`doc.css`、`code.css` 与用户主题 `my.css`）。替换过程、命中统计、以及三个会让像素漂移的坑
见 `report/09`。

换主题或新增 Markdown 构造时，先重跑 `npm run css:audit && npm run css:build`，再跑
`node tools/acceptance.mjs` 确认仍是 0.0000%。
