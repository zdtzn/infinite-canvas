# Infinite Canvas Agent

本地 Canvas Agent 用来连接画布网页和用户电脑上的 Codex / Claude Code。本地开发时优先连接 `http://localhost:3000`，不需要先使用线上站点。

## 启动

先安装包含 npm/npx 的 Node.js，建议使用 Node.js 22 或更新版本。在终端运行以下命令，并保持终端运行：

```bash
npx -y --package=https://github.com/zdtzn/infinite-canvas/releases/download/canvas-agent-v0.7.1/zdtzn-canvas-agent-0.7.1.tgz canvas-agent
```

首次运行时，npx 会把本仓库的 Release 安装包及依赖下载到 npm 缓存后启动，不需要 npm 账号，也不需要全局安装 Agent。

需要排查连接、线程、Codex app-server 或工具调用问题时，可开启 Debug 模式：

```bash
npx -y --package=https://github.com/zdtzn/infinite-canvas/releases/download/canvas-agent-v0.7.1/zdtzn-canvas-agent-0.7.1.tgz canvas-agent --debug
```

Debug 日志会以 `[DEBUG][HH:mm:ss]` 等传统格式输出到终端，并按启动日期保存到 `~/.infinite-canvas/logs/canvas-agent-YYYY-MM-DD.log`。终端日志带级别颜色，文件日志为纯文本；日志包含 HTTP、SSE、线程、turn、Codex app-server 和工具调用事件，token 与图片 Data URL 会自动隐藏。

本仓库开发时也可以直接运行：

```bash
cd canvas-agent
npm install
npm run build
node dist/index.js
```

启动后会输出本机地址和 token：

```txt
Local URL: http://127.0.0.1:17371
Connect token: xxxxxx
```

首次连接时，在 `https://mingche.click/` 画布右上角点击 `Agent`，填入终端输出的地址和 token 后连接。之后可使用浏览器已保存的连接信息；通过 Codex app 插件打开的连接链接也会自动带入信息。

Codex app 插件会读取启动输出里的 Local URL 和 Connect token，并直接打开画布网页地址；Canvas Agent 不负责生成画布打开 URL。

`http://127.0.0.1:17371/config` 只返回本地地址和是否已设置 Token，不返回 Token。插件连接链接使用 `/canvas?mode=new#agentUrl=<Local URL>&agentToken=<Connect token>`，需用 `URLSearchParams` 编码 `#` 后的参数；网页读取后会清除地址栏里的连接信息。

Canvas Agent 默认只监听 `127.0.0.1`。首次启动会生成连接 Token，保存在 `~/.infinite-canvas/canvas-agent.json` 中，后续启动会复用。网页第一次带正确 token 连接后，Canvas Agent 会记录该网页 Origin；切换网站时，可以在连接页测试连接并重新授权当前网站。

## 发布

`canvas-agent` 使用自己的 `package.json` 版本号，不跟仓库根目录 `VERSION` 绑定。当前通过本仓库的 [GitHub Releases](https://github.com/zdtzn/infinite-canvas/releases) 分发 npm tarball；`@zdtzn/canvas-agent` 是安装包身份，不表示已发布到 npm。

发布流程在 CI 中构建并通过 `npm pack` 打包，使用独立的 `canvas-agent-v<版本号>` tag 上传 Release 资产，不需要 npm 发布凭据。安装链接固定到具体版本；升级时先停止旧进程，再运行新版 Release 提供的启动命令。网页或 Docker 更新不会自动更新用户电脑上的 Agent。

## Codex MCP

如果希望 Codex 终端能直接操作画布，需要先把 Canvas Agent 注册成 Codex MCP。

上述启动命令只启动本地 Agent 服务，不会安装 MCP，也不会增加 Codex 工具上下文。只有安装 Codex app 插件，或手动执行 `codex mcp add` 后，`infinite-canvas` 工具才会进入 Codex 上下文；由于工具较多，不使用时建议移除。

通过插件安装时移除插件：

```bash
codex plugin remove infinite-canvas
```

手动添加 MCP 时移除 MCP：

```bash
codex mcp remove infinite-canvas
```

### Codex app 插件

仓库内提供了 Codex app 插件：`plugins/infinite-canvas`。在 Codex app 中添加本仓库的 marketplace 后，可以安装 `Infinite Canvas` 插件；插件会注册同一个 `infinite-canvas` MCP，并带上画布操作说明。

添加本地 marketplace 时建议使用仓库绝对路径，避免 Codex 从其他工作目录解析失败：

```bash
cd /path/to/infinite-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add infinite-canvas@infinite-canvas-local
```

插件默认通过 npm 启动 MCP；这个命令只提供 MCP 工具，不会把 MCP 写入全局配置，也不会在退出时自动卸载：

```bash
npx -y --package=https://github.com/zdtzn/infinite-canvas/releases/download/canvas-agent-v0.7.1/zdtzn-canvas-agent-0.7.1.tgz canvas-agent mcp
```

使用时可以直接在 Codex 里说“打开 Infinite Canvas”，插件会启动本地 Agent，读取 Local URL 和 Connect token，然后在右侧打开 `https://mingche.click/` 并自动新建、连接画布；只有明确要求使用本地项目时才会启动本地前端。

Canvas Agent 启动后，给 Codex 添加 MCP：

```bash
codex mcp add infinite-canvas -- npx -y --package=https://github.com/zdtzn/infinite-canvas/releases/download/canvas-agent-v0.7.1/zdtzn-canvas-agent-0.7.1.tgz canvas-agent mcp
```

本仓库开发时可以改成，实际使用建议替换为本机绝对路径：

```bash
codex mcp add infinite-canvas -- node /path/to/infinite-canvas/canvas-agent/dist/index.js mcp
```

Canvas Agent 源码使用 TypeScript 编写，MCP 协议层使用官方 `@modelcontextprotocol/sdk`，工具入参使用 `zod` 描述。

如果希望终端里的 Codex 不被 MCP 审批卡住，可以在 `~/.codex/config.toml` 里给这个 MCP 设置自动放行：

```toml
[mcp_servers.infinite-canvas]
command = "npx"
args = ["-y", "--package=https://github.com/zdtzn/infinite-canvas/releases/download/canvas-agent-v0.7.1/zdtzn-canvas-agent-0.7.1.tgz", "canvas-agent", "mcp"]
default_tools_approval_mode = "approve"
```

可用工具：

- `canvas_get_state`
- `canvas_get_selection`
- `canvas_export_snapshot`
- `canvas_apply_ops`
- `canvas_create_text_node`
- `canvas_create_image_prompt_flow`

`canvas_apply_ops` 示例：

```json
{
  "ops": [
    {
      "type": "add_node",
      "nodeType": "text",
      "title": "标题",
      "position": { "x": 0, "y": 0 },
      "metadata": { "content": "文本内容" }
    }
  ]
}
```

## 侧边栏 Codex

本地面板会把提示词发送给 Canvas Agent。Canvas Agent 使用官方 `@openai/codex` CLI 的 `codex app-server --stdio` 启动并复用同一个 Codex thread，启动时会注入 `infinite-canvas` MCP 配置并自动放行 MCP 审批，真正执行画布修改前仍由网页侧边栏二次确认。

侧边栏会展示 Codex 返回的 `thread.started`、`turn.started`、`item.*`、`turn.completed` 等结构化事件；Canvas Agent 会合并短时间内的回复、思考摘要和命令输出增量，网页使用同一条消息持续更新，并把任务进度、计划、搜索、文件修改与工具操作整理为中文过程时间线。

侧边栏上传或粘贴的图片会先发到本机 Canvas Agent，再由 Canvas Agent 临时写入本机文件并作为 app-server `localImage` 输入传给 Codex；前端会提示附件体积，单次请求体限制为 30MB。

## Claude Code

Claude Code Adapter 代码暂时保留，但当前网页侧边栏只开放 Codex。后续开放 Claude 入口时，Canvas Agent 会调用本机 `claude -p --output-format stream-json` 并把流式 JSON 事件转发到侧边栏。

如果希望 Claude Code 也能操作画布，需要给 Claude Code 添加同一个 MCP。建议用 user scope，避免 Canvas Agent 从不同目录启动时找不到配置：

```bash
claude mcp add --scope user --transport stdio infinite-canvas -- npx -y --package=https://github.com/zdtzn/infinite-canvas/releases/download/canvas-agent-v0.7.1/zdtzn-canvas-agent-0.7.1.tgz canvas-agent mcp
```

本仓库开发时可以改成：

```bash
claude mcp add --scope user --transport stdio infinite-canvas -- node /path/to/infinite-canvas/canvas-agent/dist/index.js mcp
```

Canvas Agent 调用 Claude Code 时会默认带上 `--allowedTools mcp__infinite-canvas__*`，画布写操作仍由网页侧边栏确认。
