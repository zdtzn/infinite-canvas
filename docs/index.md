# 无限画布文档索引

## 项目介绍

- [快速开始](/docs/overview/quick-start)
- [功能介绍](/docs/overview/features)
- [Docker 部署](/docs/overview/docker)
- [Render 部署说明](/docs/overview/render)
- [第三方提示词仓库](/docs/overview/third-party-prompt-repositories)
- [Codex App 插件](/docs/overview/codex-app-plugin)

## 操作手册

- [画布节点操作手册](/docs/canvas/canvas-node-manual)
- [画布快捷键](/docs/canvas/canvas-shortcuts)

## 开发与数据

- [本地开发](/docs/development/local-development)
- [画布数据结构](/docs/development/canvas-data-structure)
- [本地 Codex 连接画布原理](/docs/development/local-codex-canvas)

## 部署与安全

- [安全公网部署](./SECURE_PUBLIC_DEPLOYMENT.md)
- [漏洞提交](/docs/support/security)
- [更新日志](/docs/progress/changelog)
- [待测试](/docs/progress/pending-test)

## 授权与贡献

- [开源协议](/docs/business/license)
- [贡献者协议](/docs/business/cla)
- [商务合作](/docs/business/business)

## 当前运行模式

正式构建默认运行在 Bun 服务端模式：

- 用户、项目、藏卷阁素材、生成历史、任务、渠道和修炼数据由 SQLite 与 `/data` 文件目录持久化。
- 管理员统一配置平台模型渠道，API Key 经服务端加密保存；普通用户不会取得明文 Key。
- 所有个人项目、素材和历史记录按登录账号隔离，并可在其他设备登录后恢复。
- WebDAV 仍可作为可选的浏览器侧备份/同步工具，但不再是正式部署的主要持久化方案，也不会同步平台 API Key。

直接运行 `web/` 的 Vite 开发服务器时属于本地前端模式，数据和个人接口配置仍使用浏览器本地存储。需要验证正式登录、后台、SQLite 和用户隔离时，应运行完整 Docker 服务。

## 仓库说明

当前维护仓库为 [zdtzn/infinite-canvas](https://github.com/zdtzn/infinite-canvas)。本项目基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 二次开发并保留上游署名与 AGPL-3.0 授权信息。
