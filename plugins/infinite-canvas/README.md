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

插件通过本仓库 GitHub Release 的 `@zdtzn/canvas-agent` 安装包启动 MCP，默认打开 `https://mingche.click/`。这个包名用于标识 Release 安装包，不表示已发布到 npm。首次使用前先安装包含 npm/npx 的 Node.js；npx 会自动下载安装包及依赖，不需要 npm 账号。

安装后新建一个 Codex 任务，然后输入：

```text
帮我打开并连接到 Infinite Canvas
```
