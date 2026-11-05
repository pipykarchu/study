# PR #1 移动端方向浏览器回归记录

检查日期：2026-11-04（北京时间）
PR：https://github.com/pipykarchu/study/pull/1
检查版本：`f074c9f7af0e18ebefe4ada756470279a18111ce`（`feat/mobile-learning-track`）

## 当前结论

**真实浏览器验收尚未完成，不能判定 UI 通过。** 环境存在 Chromium 和 Playwright，但启动 Chromium 失败；没有实际浏览器断言通过，也没有得到页面截图。不把环境错误记为产品交互失败。

| 检查 | 实际结果 |
| --- | --- |
| `node scripts/build-cloud.mjs` | 通过，22 项嵌入资产 |
| `node scripts/validate-cloud-artifact.mjs` | 通过，包含所有者访问限制、部署配置和迁移日志校验；不是线上权限实测 |
| `node --test tests/mobile-learning.test.mjs` | 7/7 通过，Node VM / DOM 桩测试 |
| `node --check scripts/check-mobile-browser.mjs` | 通过，仅语法检查 |
| Chromium / Playwright 探测 | Chromium 155.0.8059.79；Playwright 1.62.1；Node v24.22.1 |
| Playwright 启动真实 Chromium | 环境阻断，0 项浏览器断言执行 |
| mobile 选择、六周指南和返回导航 | 未测 |
| 360px / 390px 布局和视觉 | 未测 |
| 点击、Tab / Enter / Space、保存反馈 | 未测 |
| 实际页面角色切换和记录隔离 | 未测；现有 Node 测试通过不替代此项 |
| 实际页面旧记录显示 | 未测；现有 Node 兼容测试通过不替代此项 |
| 真机触摸、软键盘、Safari、辅助技术 | 未测 |

启动错误摘要：

```text
browserType.launch: Target page, context or browser has been closed
FATAL:chrome/browser/process_singleton_posix.cc:297
Check failed: . socket() failed: Operation not permitted (1)
```

系统 Chromium 可执行文件存在，不等于它能在当前执行环境中启动。备用浏览器首次访问本地地址返回 `ERR_CONNECTION_REFUSED`；之后尝试绑定新建标签时被浏览器安全策略拒绝，未获得页面观察权限。已停止该路径，未绕过限制。

## 待批准的修改范围

只新增两个文件：

- `scripts/check-mobile-browser.mjs`：独立 Playwright 回归脚本，不依赖部署站点，使用临时端口和全新非持久浏览器上下文；两个宽度分别隔离。拦截 `/api/` 和所有外部请求，并禁用 Service Worker。
- `docs/mobile-browser-regression.md`：本记录、运行方法和人工验收步骤。

不修改六周路线、应用功能、ima 文档、权限或部署配置，不改已有 Node 测试，不新增 PR。本地改动尚未提交或推送。

脚本的**交互流程尚未运行验证**，可能需要在可启动浏览器的环境里修正等待条件或断言。通过语法检查不代表该脚本或 UI 已通过回归。脚本执行成功前，不应在 PR 中写“浏览器测试通过”。

## 在可用环境中重跑

在 PR 分支的完整 Git 克隆中运行；旧数据夹具需要父版本 `b9233fb`，浅克隆应先补齐此版本。脚本不会连接生产站点或复用日常浏览器资料。

```sh
npm install --no-save --package-lock=false playwright@1.62.1
node scripts/build-cloud.mjs
node scripts/validate-cloud-artifact.mjs
node --test tests/mobile-learning.test.mjs
CHROMIUM_PATH=/usr/bin/chromium node scripts/check-mobile-browser.mjs
```

系统 Chromium 路径应按本机调整。如果使用 Playwright 官方浏览器，先运行 `npx playwright install chromium`，再省略 `CHROMIUM_PATH` 运行。依赖安装未写入项目依赖清单。

结果默认写入已被 `.gitignore` 排除的 `qa/mobile-browser/`，可通过 `BROWSER_QA_DIR` 调整。包括结构化结果、成功访问后的全页截图、文档滚动宽度、越界元素、未捕获 JS 错误和被拦截请求。截图还需人工查看，宽度断言不等于视觉验收。环境阻断退出码为 2，断言失败为 1，全部通过才为 0；任何阻断或失败不得作为验收通过。

拟覆盖：两个宽度下通过页面按钮选择方向、检查六节点与初始空记录；实际打开六周指南并返回；Tab 到方向按钮并用 Space/Enter 激活；键盘保存笔记、反馈和刷新恢复；资料校验与保存；通过 UI 轮换小貅、小羊、小熊后恢复原角色笔记、资料、测验状态；主导航；主页面、指南、资料和首页布局。

旧记录夹具使用父版本 learning.js 生成合成测验成绩与证据，三方向夹具额外去掉 fde；新版页面从 localStorage 加载并检查旧笔记、自测及成绩，切到 mobile 后为空。夹具生成与部分测验状态安排使用 API/VM，**不计为浏览器操作结果**。真正的浏览器断言必须在页面启动后执行。本次未得到这些结果。

## 人工验收步骤（全部待执行）

只在临时本地副本和新建临时浏览器用户目录中操作，勿使用生产网址或日常浏览器资料，勿导入个人真实备份。运行 `python -m http.server 4173 --bind 127.0.0.1 --directory dist`，打开 `http://127.0.0.1:4173/index.html?role=apple#framework`。确认页面处于本地模式。开发者工具网络面板确认没有生产写请求。

每项记录：环境/宽度、步骤、预期、实际、通过/失败/未测、截图或错误日志。360px 与 390px 各执行一轮；设备模拟不是手机真机。

| 项目（当前均未测） | 操作 | 预期 |
| --- | --- | --- |
| 方向选择 | 点击移动端开发，再切回 AI 产品成长，再用 Tab 到移动端按钮并按 Enter / Space | 选中态正确；显示六个移动端节点；首次没有成绩或完成记录 |
| 六周指南 | 从节点 Wiki 点指南，在新页检查六周表、首周步骤和记录模板，再点击返回 | 内容可读，链接可达；返回后核对原角色和方向；指南不计为学习完成 |
| 窄屏视觉 | 设 viewport 360×844、390×844；查看首页、框架、资料、指南；从顶部滚到末尾 | 页面无横向溢出；内容不遮挡；长文换行；按钮、表单、导航可见可达；表格内部滚动可单独记录 |
| 笔记保存 | 输入 `SYNTHETIC apple`，Tab 到保存并 Enter；刷新 | 明确保存反馈；文本保留；空笔记按实际规则提示，不误报成功 |
| 资料交互 | 沉淀笔记到资料；清空标题保存；填写测试标题后保存，搜索并展开 | 必填校验阻止空标题；保存后可找到正确文本，反馈明确 |
| 测验交互 | 点击主动回忆，开始完整测验；不选答案提交，再用 Tab/方向键选答案提交并继续 | 空选项有提示；提交后显示解析/进度；一次提交不重复计数；未完成不显示完整通过 |
| 角色隔离 | 小貅保存测试笔记/资料及部分作答；用角色按钮切小羊、小熊，各写不同测试文本，再切回 | 目标、笔记、资料、成绩和作答互不串用；原角色恢复原记录；不得清空其他角色 |
| 方向隔离 | 在同一角色的 product 与 mobile 分别写不同测试笔记，来回切换 | 各自记录保留，mobile 不覆盖旧方向 |
| 旧记录 | 在隔离上下文用父版本引擎生成三/四方向合成记录，再载入新页面；比较旧目标、笔记、自测、成绩、证据和活动答题，刷新后再比较 | 旧内容可见且数值不变，mobile 补为空；不同 schema 分别记录，不能用真实备份代替合成夹具 |
| 导航 | 通过点击及 Tab/Enter 往返知识图谱、资料沉淀、学习方法和指南 | 页面、焦点和当前方向正确；无控制台未捕获错误 |
| 真机补验 | 临时本地测试环境可安全访问时，用手机重复上述核心流程，测试触摸、软键盘、旋转与长文本 | 单独填写设备、系统、浏览器与结果；桌面窄屏通过不能代替此项 |

人工验收不得仅根据截图判断按钮工作，必须实际操作。上线身份核验、D1 同步、ima、会员工具调用不在本次离线回归通过范围内，需要另设受控验收。
