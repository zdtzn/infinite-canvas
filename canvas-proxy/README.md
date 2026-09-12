# 可选本地代理

需要 Node.js 20+，无需安装依赖。仅监听 `127.0.0.1`；默认应用关闭代理，生产账户和托管 `/api` 请求继续使用原后端。

PowerShell 启动示例（将来源替换为你实际使用的网站和服务，来源必须包含端口且不含路径）：

```powershell
$env:CANVAS_PROXY_ORIGINS = 'https://your-canvas.example.com'
$env:CANVAS_PROXY_TARGETS = 'https://your-api.example.com,https://your-webdav.example.com'
node canvas-proxy/index.mjs
```

在「配置 → 偏好设置」启用本地代理，地址为 `http://127.0.0.1:8789`。浏览器可能要求允许访问本地网络；不支持此权限的浏览器或环境可能无法连接。本程序不配置开机启动。

目标采用准确 origin 白名单。远程目标仅允许 HTTPS，显式列入白名单的回环目标可用 HTTP。不会跟随跳转，不传递 Cookie，不记录请求地址、查询参数、密码或请求体。API Key/WebDAV Authorization 会转发给指定目标；仅允许你信任的站点，并在使用结束后停止程序。不要将本机端口发布到公网。

集成契约：`withLocalProxy(url): string` 来自 `web/src/services/api/local-proxy.ts`；对完整直连 URL 调用。相对 URL、同源绝对 URL和已代理 URL保持原样。传输格式为 `/proxy/https://target.example/path?query`，保留目标查询参数。OpenAI/Gemini gateway 和 WebDAV 已接入；自定义插件与其他直接下载由各调用方接入。

WebDAV 数据现在存放于 `远程目录/users/账户/业务/`。旧未分账户目录保留，因无法证明归属不会自动导入；需要迁移时先确认备份所属账户。墓碑不自动过期，同 ID 的旧备份无法恢复已删除项目；手动导入会生成新 ID。
