# Infinite Canvas Codex Plugin

让 Codex 可以打开并操作 Infinite Canvas。

## 安装

macOS / Linux：

```bash
git clone https://github.com/zdtzn/infinite-canvas.git
cd infinite-canvas
codex plugin marketplace add "$(pwd)"
codex plugin add infinite-canvas@infinite-canvas-local
```

Windows PowerShell：

```powershell
git clone https://github.com/zdtzn/infinite-canvas.git
cd infinite-canvas
codex plugin marketplace add "$PWD"
codex plugin add infinite-canvas@infinite-canvas-local
```

Windows CMD 将 `$PWD` 替换为 `%cd%`。

插件当前仍通过上游发布的 `@basketikun/canvas-agent` npm 包启动 MCP。该包名是运行依赖，不代表当前仓库地址，不应改写为不存在的 `@zdtzn/canvas-agent`。

安装后新建一个 Codex 任务，然后输入：

```text
帮我打开并连接到 Infinite Canvas
```
