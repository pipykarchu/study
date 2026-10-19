# 腾讯 ima 资料连接

网页内的资料库、搜索和导出可独立使用。腾讯 ima 是可选的外部资料来源和笔记导出目标，不使用额外的 AI 推理 API。

## 配置

1. 在腾讯官方入口 <https://ima.qq.com/agent-interface> 获取或更新 Client ID 和 API Key。
2. 将它们配置为本网站的 **Sites 运行时加密密钥**：`IMA_OPENAPI_CLIENTID`、`IMA_OPENAPI_APIKEY`。由网站管理工具设置，不写进 Git、网页源码、浏览器存储或聊天消息。
3. 在资料库中点击连接并载入知识库。只有知识库列表读取成功才表示当前授权可用；`configured: true` 仅表示已存在配置。
4. 为当前角色与学习方向选择目标知识库。需要分开沉淀时，为貔貅和小羊分别选择不同的 ima 知识库。

本机工具也支持从当前用户的 `~/.config/ima/client_id` 和 `~/.config/ima/api_key` 读取已有凭证。网站运行时需要单独通过上述加密密钥配置；网页不能读取本机文件。

## 使用范围

- 所有网站接口先验证本站所有者账号；外部读写请求还检查同源来源、明确的角色和学习方向。
- 每次读取或保存均明确指定 `kbId`，网站不自动合并两个角色的资料。
- 搜索返回最多 20 条标题和匹配摘要，可翻页；空搜索浏览当前知识库根目录。
- 点击“新建笔记到 ima”后，将当前文本新建为 Markdown 笔记，再加入选定知识库。不会追加或覆盖已有笔记。
- 文字限 60,000 字符、标题限 180 字符，导出前校验 UTF-8。本地图片不支持，由本次导出内容中移除并显示提示；网页原资料保留。
- 本接口不上传二进制附件、不直接导入视频。附件可先用 ima 客户端处理，网页保存学习摘要与来源链接。

## 失败提示

HTTP 401 表示当前 ima 授权未通过；请在官方入口更新凭证后重新配置网站密钥。HTTP 403 表示当前操作或知识库权限不足。

新建笔记与加入知识库是两次官方操作。若新建已成功、挂库失败，会返回已知的 `noteId`；若网络中断导致结果不确定，会标注“可能已保存”。网页应提示先到 ima 查看笔记，不自动重试，避免重复创建。请求期间禁用保存按钮。

## 接口约定

`GET /api/ima/status` 返回配置状态、供应方和官方设置入口，不验证凭证有效性。

以下为同源 POST，JSON 必须带 `roleId`（`apple` 或 `sheep`）及 `profileId`（`product`、`coding`、`fde` 或 `custom`）：

| 接口 | 其他请求字段 | 主要返回字段 |
| --- | --- | --- |
| `/api/ima/libraries` | 可选 `cursor` | `libraries: [{id,name}]`、`nextCursor`、`isEnd` |
| `/api/ima/search` | `kbId`、`query`，可选 `cursor` | `results: [{id,title,content}]`、`nextCursor`、`isEnd` |
| `/api/ima/save-note` | `kbId`、`title`、`content` | `saved`、`noteId`、`kbId`、`warnings` |

若 URL 带 `?role=`，必须与请求体角色一致。外部响应均作为不可信纯文本转义展示。凭证仅通过认证头发送到固定的 `https://ima.qq.com/openapi/` 地址，不跟随重定向，不发送至内容来源网页。

## 检查

`node qa/ima-worker.cjs` 使用模拟外部响应验证范围绑定、同源要求、编码、大小上限、密钥脱敏、错误提示及不重试行为，不会新建真实 ima 笔记。
