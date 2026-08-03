<p align="center">
  <img src="web/public/logo.svg" width="96" alt="无限画布 logo">
</p>

<h1 align="center">无限画布（Infinite Canvas）</h1>

<p align="center">
  面向 AI 图片创作的无限画布工作台，将生图、参考图编辑、节点编排、提示词与个人素材放进同一条创作流程。
</p>

<p align="center">
  <a href="https://github.com/zdtzn/infinite-canvas"><img src="https://img.shields.io/github/stars/zdtzn/infinite-canvas?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="https://github.com/zdtzn/infinite-canvas/tags"><img src="https://img.shields.io/github/v/tag/zdtzn/infinite-canvas?style=flat-square&label=version" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-f97316?style=flat-square" alt="License"></a>
  <a href="https://bun.sh/"><img src="https://img.shields.io/badge/runtime-Bun-111111?style=flat-square&logo=bun" alt="Bun"></a>
  <a href="docs/content/docs/overview/docker.mdx"><img src="https://img.shields.io/badge/deploy-Docker-2496ed?style=flat-square&logo=docker&logoColor=white" alt="Docker"></a>
</p>

<p align="center">
  <a href="docs/content/docs/overview/quick-start.mdx">快速开始</a> ·
  <a href="docs/content/docs/overview/features.mdx">功能介绍</a> ·
  <a href="docs/content/docs/overview/docker.mdx">Docker 部署</a> ·
  <a href="docs/SECURE_PUBLIC_DEPLOYMENT.md">安全公网部署</a> ·
  <a href="docs/content/docs/canvas/canvas-node-manual.mdx">画布手册</a> ·
  <a href="SECURITY.md">安全策略</a>
</p>

> [!IMPORTANT]
> 本仓库是基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 持续维护的二次开发版本。当前仓库、镜像、版本检查和部署文档均以 `zdtzn/infinite-canvas` 为准；上游项目署名、AGPL-3.0 许可及第三方依赖信息继续保留。

## 当前定位

本项目不是单纯的浏览器前端，也不是游戏化产品。当前版本采用 **React + Bun + SQLite 的轻量单体架构**，面向小团队或受邀用户共同使用：

- 用户登录后拥有独立的画布项目、藏卷阁素材、生成历史和个人资料。
- 管理员统一配置模型渠道与 API Key，普通用户直接选择已开放的渠道和模型。
- 生图任务由服务端持久化执行，支持排队、取消、重试、失败返还额度和服务重启后的状态恢复。
- 修炼系统仅作为轻量成长反馈与额度管理层，不改变 AI 创作工作台的核心定位。

## 主要能力

- **无限画布**：多项目、节点拖拽缩放、连线、框选、多选、撤销重做、小地图、导入导出和自动保存。
- **AI 创作**：文生图、图生图、参考图编辑、局部遮罩、裁剪、切分、放大、图片问答及视频生成。
- **丹青台**：提示词、模型、比例、清晰度、格式和高级参数统一配置，并保留可恢复的生成记录。
- **藏卷阁**：按账号保存图片、视频、音频、头像和生成作品，不同用户互不影响。
- **提示词库**：可信提示词来源、服务端图片代理、缓存回退、原图查看与下载。
- **账号与后台**：成员登录、停用、管理员渠道配置、用量统计、任务状态、日志及 SQLite 备份状态。
- **修炼成长**：境界、星级、修为、每日额度、并发限制、能力键和后台动态配置。
- **本地 Agent**：通过 Canvas Agent 与 Codex / Claude Code 连接，由 Agent 读取和操作当前画布。

## 架构

| 层级   | 实现                                                                            |
| ------ | ------------------------------------------------------------------------------- |
| 前端   | React 19、Vite、React Router、Zustand、React Query、Ant Design                  |
| 服务端 | Bun 单体 HTTP 服务，统一提供静态页面、认证、数据 API、AI 代理和任务队列         |
| 数据库 | SQLite + WAL，启动时自动迁移，并兼容旧 `state.json` 数据导入                    |
| 文件   | `/data/assets`、`/data/job-files`、`/data/job-references`、`/data/prompt-cache` |
| 部署   | Docker / Docker Compose，生产环境推荐 Caddy HTTPS 反向代理                      |

## 快速开始

### Docker

```bash
git clone https://github.com/zdtzn/infinite-canvas.git
cd infinite-canvas
cp .env.example .env
```

先生成并写入固定的渠道加密密钥：

```bash
openssl rand -base64 32
```

将结果填入 `.env` 的 `APP_ENCRYPTION_KEY`，然后启动：

```bash
docker compose up -d app
docker compose ps
curl http://127.0.0.1:3000/health
```

管理员首次初始化只能通过服务器回环地址完成。公网部署、成员开放、HTTPS、备份与回滚步骤见 [安全公网部署](docs/SECURE_PUBLIC_DEPLOYMENT.md)。

### 本地前端开发

```bash
git clone https://github.com/zdtzn/infinite-canvas.git
cd infinite-canvas/web
bun install
bun run dev
```

Vite 开发模式用于前端调试，默认使用浏览器本地配置与本地数据。需要验证登录、SQLite、用户隔离、后台渠道和持久任务时，请使用完整 Docker 模式：

```bash
docker compose -f docker-compose.local.yml up -d --build
```

## 数据与升级

正式部署必须将 Docker 数据卷挂载到 `/data`。重建容器不会删除数据卷，但不要执行 `docker compose down -v`，除非明确要删除全部数据。

升级前建议创建完整数据卷备份：

```bash
BACKUP_ROOT=/root/infinite-canvas-backups \
DATA_VOLUME_NAME=infinite-canvas-data \
sh ops/backup-volume.sh
```

生产环境应固定经过验证的镜像标签或摘要，不建议让 Watchtower 自动更新应用容器。详细说明见 [Docker 部署](docs/content/docs/overview/docker.mdx)。

## 本地 Canvas Agent

当前 npm 包仍由上游项目以 `@basketikun/canvas-agent` 发布，因此命令和包名不能改成 `@zdtzn/*`：

```bash
npx -y @basketikun/canvas-agent
```

使用说明见 [canvas-agent/README.md](canvas-agent/README.md) 和 [Codex App 插件](docs/content/docs/overview/codex-app-plugin.mdx)。

## 上游与授权

- 上游项目：[basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)
- 当前维护仓库：[zdtzn/infinite-canvas](https://github.com/zdtzn/infinite-canvas)
- 开源许可：[GNU Affero General Public License v3.0](LICENSE)
- 第三方许可与署名：[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

本仓库保留上游版权、许可和提交历史。提交代码或文档前请阅读 [CLA.md](CLA.md)；安全问题请按 [SECURITY.md](SECURITY.md) 中的私密报告流程处理。
