# 08 · Electron 打包：从「需要一台装好 Chromium 的机器」到「一个能拷走的 exe」

## 观察

三条实测数据决定了这次选型：

| 方案 | 运行时份数 | 体积 | 与 Typora 的引擎差异 |
| --- | --- | --- | --- |
| 自带 Playwright Chromium（原方案） | 2（Chromium 文件树 + 独立 Node） | 316 MB + 87 MB（`node.exe`）+ 3.5 MB 资源 | 124.0.6367.29 vs 124.0.6367.233（同次版本，不同 patch） |
| 复用系统 Chrome/Edge | 1 | 0（用户自备） | Edge 155 / Chromium 153 ⇒ 正文 3.1453% 像素差 |
| **Electron 30.0.9** | **1**（Electron 二进制内含 Chromium 与 Node） | 168.8 MB 单一 exe + 运行时文件 | **124.0.6367.233，与 Typora 完全同版本** |

- Typora 自己就是 Electron：`D:\Typora` 297.4 MB / 416 文件，其中 `Typora.exe` 169.6 MB、`locales\` 37.4 MB。
  它只需一份运行时，因为 Node 就在 Electron 里；而「Node + 外部 Chromium」的方案要付两份。
- `chromium-1112\chrome-win` 316.0 MB / 84 文件，`node.exe` 87.4 MB ⇒ 410 MB 的估计来自这里。
- 更关键的是引擎版本：Chromium 153 与 124 的差异不是「细微」，而是三类真实差异（见 `out/chroma/README.md`）：
  1. **中文全部变成 Type3 字形过程**（`AAAAAAAA+MicrosoftYaHei` → 31 个无 BaseFont、未嵌入的 Type3），
     文件反而大 55%，字形边缘靠矢量过程重绘；
  2. **默认 1 cm 打印边距的取整变了**（28.00 pt → 27.75 pt），内容整体上移 0.25 pt；
  3. 图片块的重采样相位不同（逐像素只差 1–3/255）。
  结论：像素级一致必须锁 124；而 Electron 30.0.9 直接把这个引擎包进 exe，不需要第 5 个下载项。

## 实现

1. **引擎抽象** `src/session.js`：把「活页面」收敛成 7 个方法（`load` / `waitForFunction` / `evaluate` /
   `addStyle` / `printToPDF` / `printHtmlString` / `close`），下面两个实现：`PuppeteerSession`（CLI 与验收用）
   与 `ElectronSession`（`win.loadFile` + 轮询 `window.__md2pdf_done`）。`src/print.js` 改成**懒加载**
   puppeteer-core，`npm i -g` 后的 exe 因此完全不含 puppeteer。
2. **打印参数同构** `toElectronPrintOptions()`：`{paperWidth,paperHeight}` → `pageSize:{width,height}`（英寸）；
   有 `margins` → `marginsType:1` + 四边值（页眉/页脚带用），无 → `marginsType:0`（内容页拿到 Chromium
   默认 1 cm，正是 Typora 的行为）。这两条是 `report/02` 里从实机 IPC 抄下来的参数，逐个对齐。
3. **入口** `electron/main.cjs` 用 CommonJS：Electron 30 的 ESM 主进程加载器给不出可用的 `electron`
   绑定（`import { app }` 报 "does not provide an export named 'BrowserWindow'"，default 为 undefined）。
   入口先 `app.disableHardwareAcceleration()`（打印是 CPU 光栅，GPU 只增加体积与不确定性），
   再 `await import()` 引入 ESM 的 `src/build.js`。
4. **打包** `tools/pack.mjs`：`ignore` 用「白名单外全部排除」的正则（只留 `electron/ src/ vendor/ package.json
   node_modules/`），再用 `afterPrune` 钩子做三件事 —— 剪 `node_modules` 到运行闭包 15 个包、
   删 pdf-lib 的 `dist/ src/ ts3.4/`（Node 只加载 `cjs/index.js`）、产物里只留 `en-US.pak` 与 `zh-CN.pak`。
5. **临时文件位置**：`src/build.js` 原来把 stage HTML 写到 `<ROOT>/out/tmp`；打包后 `ROOT` 指向
   `resources/app.asar`，它是一个**文件**，`mkdir` 直接 `ENOTDIR`。改成 `os.tmpdir()/md2pdf-<pid>`
   （可用 `MDPDF_TMPDIR` 覆盖）。
6. **PATH 友好启动器 + 桌面快捷方式**：产物根目录是 Chromium 运行时（`md2pdf.exe` + dll + pak +
   `locales/` + `resources/`），把它加进 PATH 会连带暴露十几个无关文件。打包末尾生成 `bin/md2pdf.cmd`：
   `"%~dp0..\md2pdf.exe" %*`；再生成 `bin/md2pdf.lnk`（`WScript.Shell` COM，Target 指向上级 exe，
   同一图标），并把 `README.md` 复制到产物根目录。用户只把 `...\bin` 加进 PATH。
   实测：`bin\md2pdf.cmd input.md -o out.pdf` 在任意工作目录下产出与直接调用 exe **逐字节同尺寸**
   （72,823 B），参数含空格/`${pageNo}` 模板、含空格路径均正确透传，失败时退出码为 1、`--help` 为 0。
   `.lnk` 走 ShellExecute 的鼠标路径：把 `.md` 拖到图标上，产物落在**源文件旁边**
   （`拖放测试.md` → `拖放测试.pdf`，1 页、`diff_body 0.0000%`；无 `--footer` 时只有页脚带空着，
   `diff_total 0.0171%`）。`.lnk` 不是可执行扩展名，Windows 从不把它当作 PATH 命令，所以两条入口
   互不替代。

## 证据位置

| 事实 | 位置 |
| --- | --- |
| Electron 版本与内置 Chromium | `node_modules/electron/dist/version`、`npx electron -v` |
| 裁剪前后产物体积 | `dist/md2pdf-win32-x64`（209.7 MB / 18 文件 = 15 个运行时文件 + `bin/md2pdf.cmd` + `bin/md2pdf.lnk` + `README.md`），对照首次 305.9 MB / 73 文件；最终 zip 89.9 MB |
| PATH 启动器 | `dist/md2pdf-win32-x64/bin/md2pdf.cmd`（181 B）；`bin\md2pdf.cmd golden\typora-export-test.md -o out\shim-p2.pdf` ⇒ 72,823 B，`node tools/acceptance.mjs --out` 15/15、`0.0000%` |
| 拖放快捷方式 | `bin/md2pdf.lnk`（1,216 B，Target 指向上级 `md2pdf.exe`，图标取自 exe）；把 `拖放测试.md` 拖到图标上 ⇒ 源文件旁生成 `拖放测试.pdf`，1 页、`diff_body 0.0000%` |
| asar 内容 | `node_modules/.bin` 外的 `@electron/asar listPackage`；剪枝日志 `pruned 87 node_modules directories` |
| 打包版验收 | `node tools/acceptance.mjs --out out/dist-p1.pdf` ⇒ 15/15 PASS、`0.0000%` |
| 打包版 TOC | `python tools/toc_check.py out/dist-p2.pdf` ⇒ 7 行、`printed [1,1,1,1,1,2,2]`、链接目标同 |
| 打包版多页/特性 | `out/dist-p3.pdf`（2 页）、`out/dist-p4.pdf`（h1–h6/任务列表/公式/脚注） |
| 两条引擎一致性 | `out/el-v2.pdf`（Electron）与 `out/pw-v2.pdf`（puppeteer）均 15/15、0.0000% |
| 体积明细 | `md2pdf.exe` 168.8 MB、`app.asar` 10.2 MB、`icudtl.dat` 10.2、`LICENSES.chromium.html` 9.8、`resources.pak` 5.1 |

## 决策

1. **Electron 作为唯一分发运行时**，Playwright Chromium 只留给开发/验收（`runtime/chromium-124` 是
   给 CLI 用的，不进包）。理由是「一份运行时 + 引擎版本天然对齐」，同时体积从 410 MB 级降到 210 MB。
2. **不提供「复用系统浏览器」模式**。Chromium 153 会把中文降级为 Type3 且整体偏移 0.25 pt，
   与本项目「逐像素复刻」的目标冲突；把它做成选项只会制造「为什么我的输出和别人的不一样」。
3. **裁剪只做「确定安全」的部分**：先删 53 个语言包、pdf-lib 冗余副本、puppeteer 依赖树、GPU 三方库；
   不动 `icudtl.dat`（ICU 数据裁剪需要重编 Electron）、不动 `LICENSES.chromium.html`（合规）。
   `--icu-data-file` 之类的激进优化收益 2–3 MB、风险高，放弃。
4. **`ELECTRON_RUN_AS_NODE` 显式防护**：本机环境里就存在这个变量，会让 exe 以纯 Node 启动、
   `require('electron')` 退化成返回 exe 路径字符串。入口检查 `process.type !== 'browser'` 时直接
   输出可读错误并 `exit(78)`。
5. **语言包只留 en-US + zh-CN**（用户已确认）：打印像素不受影响，代价是页面内 `Intl`/`toLocaleDateString()`
   按 en-US 求值；已写入 README 前提第 4 条。
6. **PATH 入口用 `.cmd` 转发，不用符号链接**：Electron 按 `process.execPath` 所在目录解析
   `resources/app.asar`、`locales/`、`icudtl.dat` 与 dll；链接落地在 `bin\md2pdf.exe` 时这些路径全错，
   程序起不来。`.cmd` 转发启动的仍是上一级的真实 exe，`process.execPath` 不变，参数/工作目录/退出码
   全部透传（`%*` 保留调用者给的引号）。

## 未解决风险

1. **未签名**：拷到别人机器上首次运行会触发 SmartScreen「未知发布者」；内嵌 Chromium 的自解压式
   可执行文件也更容易被 AV 误判。要发出去需要代码签名证书（或让用户手动「仍要运行」）。
2. **仅 win32-x64**：`@electron/packager` 支持交叉打 mac/Linux，但未验证字体回退与路径大小写；
   CJK 字体依赖系统 `Microsoft YaHei`，英文版 Windows 上像素不再保证 0.0000%。
3. **Typora 专有 CSS 仍在包内**：`vendor/style/base.css` 与 `codemirror.css` 提取自 Typora 安装目录，
   随包分发有许可风险（CodeMirror/MathJax/Open Sans 本身是 MIT/Apache-2.0，没问题）。
   下一步是重写语义等价的 CSS 子集并重跑 `0.0000%` 验收 —— 这是 `report/06` 遗留项，与打包独立。
4. **GPU 关闭是一把双刃剑**：`disableHardwareAcceleration()` 让打印结果稳定（实测像素不变），
   但若将来要加「打印前预览窗口」，滚动与动画会走软件路径。
5. **首次启动 ~0.3 s 开销**（Electron 初始化）已计入实测的 700–900 ms 总耗时；再压需要常驻进程，
   与「一个能拷走的 exe」目标冲突，不做。
