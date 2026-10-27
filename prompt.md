# 背景

我想通过pandoc实现typora里的一个内置主题——“my”的风格，我觉得很简洁优雅，但是让deepseek harness尝试了很久都没法实现效果。

# 以往探索成果

之前让他自己尝试探索typora是怎么实现的，我没法看懂全部，但是大体意思是typora虽然整个软件的导出功能依赖pandoc，但是markdown转pdf这个导出完全不使用pandoc，而是自己的markdown处理器+markdown转html+chromium内核的浏览器导出pdf功能。

以上部分在工作区内的`reverse-typora-export`文件夹下已经完成了，并且初步实现了一个依赖typora本体的组件实现的markdown转pdf工具

# 我的目标

你需要通过逆向得到typora怎么实现的markdown转pdf，以及如何实现内置主题“my”的效果，最终实现一个不依赖typora的工具，用以实现markdown转pdf

本会话内所有需要读写、存放的文件，**全部放在`markdown2pdf`目录下**，不要写到工作区的其他目录中

之前探索过的typora实现markdown转pdf的所有内容都放在了`reverse-typora-export`下，开始干活前可以看一眼里面的内容，大概率能减少很多工作量

以下作为一个任务规划参考

```
=== 阶段 0：锚定目标 ===

1. 定位 Typora 安装目录下的 resources 文件夹，找到 app.asar 或 lib.asar，记录绝对路径。
2. 定位 Typora 用户主题文件夹，确认 “my” 对应的 CSS 文件是内置还是用户自定义；记录 CSS 绝对路径。如果无法从用户文件夹找到，从 ASAR 中搜索主题 CSS。
3. 记录 Typora 版本号。

=== 阶段 1：静态逆向导出调用链 ===
使用 REA 的 analyze-javascript-application 对阶段 0 的 ASAR 或已解包目录做纯静态分析，不要启动 Typora。
搜索并追踪：printToPDF / printToPdf / Export As / landscape / printBackground / pageSize / margins / pdf。
目标：
a) 找到 printToPDF 的调用点，记录传入的完整 options 对象（或其默认值来源）。
b) 确认导出前使用的 HTML 是“编辑器当前 DOM”还是“重新生成的打印 DOM”。
c) 找到 Markdown → HTML 转换发生的模块或函数，记录生成的关键类名和属性（尤其是根容器、标题、代码块、表格）。

=== 阶段 2：提取主题 CSS 与打印规则 ===
1. 读取 “my” 主题 CSS 及其引用的字体/图片资源。
2. 在 CSS 中单独列出：@media print、@page、break-*、page-break-*、widows、orphans 规则。
3. 判断 CSS 是否依赖 Typora 特有选择器（#write、.md-content、[mdtype]）。输出一份“独立工具可复用程度”评估。

=== 阶段 3：DOM 快照验证 ===
在 Typora 中打开一份包含代表性内容的 Markdown（标题、段落、代码块、表格、列表、引用、图片），用 DevTools 抓取导出区域 outerHTML。将实际类名与阶段 1c 的静态分析结果对照，修正差异。输出一份“目标 HTML 结构规范”。

=== 阶段 4：实现独立工具（先做最小可行版本） ===
技术栈：Node.js + Puppeteer（或 Playwright）+ 一个 Markdown 解析器。
要求：
- Markdown → HTML 的 DOM 结构必须按阶段 3 的规范输出，确保 “my” 主题 CSS 可以直接使用。
- HTML 中注入阶段 2 的 theme.css，并调用 page.emulateMediaType('print')。
- printToPDF 的 options 按阶段 1a 的逆向结果设置。
- 先用一份简单文档做端到端对比：将独立工具输出的 PDF 与 Typora 导出的 PDF 在视觉上逐页比对，记录差异（字体、间距、分页位置、代码块背景等）。

=== 增量阶段（仅在最小版本通过后执行） ===
- 如果 Typora 的 PDF 含书签，在 PDF 后处理阶段补写 outline。
- 如果主题使用自定义字体，确保字体在 headless 环境中可加载。
- 处理数学公式、代码高亮、TOC 等 Typora 特有渲染。

每阶段请输出：做了哪些观察、证据位置、做出的决策、未解决的风险。

```