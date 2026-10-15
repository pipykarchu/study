# 知芽 Study Bloom

浅粉与淡紫的个人学习花园。先明确知识框架和学习边界，再把目标变成可验证的小作品。

## 已实现

- 学习花园、知识框架、今日学习、项目练习、学习方法、资料与备份。
- AI 产品成长、Vibe Coding、通用学习三套起步框架；目标、动机、作品和三份边界清单可编辑。
- 六个知识节点的动手任务、过关标准、笔记与自主验收。
- 10 次学习安排、任务清单、专注计时器、自动保存笔记与复盘。
- 带个人目标和边界的六种 Claude 提示词，一键复制。
- JSON 完整备份/确认导入与 Markdown 框架导出。

无构建步骤、无运行依赖。`dist/` 是完整静态站。用任意静态服务器打开，例如：

```sh
python -m http.server 4173 --directory dist
```

## 学习方法和项目来源

- [用户提供的 B 站视频](https://www.bilibili.com/video/BV1eGTj69EKB)：《如何用 Claude 以 10 倍速度学习任何东西》，通往AGI之路，3 分 55 秒。字幕需登录，未取得逐字稿。
- [公开学习提示词方法](https://deepconcept0.substack.com/p/6-master-prompts-to-learn-anything)：知识阶梯、核心计划、逐题测验、速查表、精选资源、费曼复述。未确认与 B 站视频的直接来源关系；“10 倍”不代表效果保证。
- [bili-learn](https://github.com/pipykarchu/bili-learn) 与 [pikarchu](https://github.com/pipykarchu/pikarchu)：作为已有公开项目的实践入口。
- 职业规划中“目标 → 章节 → 练习 → 项目 → 复盘”的流程用于产品结构；未拷贝私人档案或求职资料。默认方向是可切换的起步建议。

## 数据与能力边界

学习记录保存在当前浏览器的 localStorage（`study-bloom-v1`），可导出后换设备导入。网站没有账号同步和 AI 服务；提示词需复制到 Claude 使用。知识掌握状态由学习者对照标准自主记录。不要在公开源码中提交个人学习备份、密钥或私人材料。

## 检查

```sh
node --check dist/app.js
```

Sites 部署配置在 `.openai/hosting.json`，静态目录为 `dist`。
