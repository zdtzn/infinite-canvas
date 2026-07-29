# 官方插件注册表（集中构建 + 远程发布）

本目录只保存构建脚本，不把构建产物提交到 `main`。官方插件由 CI 构建后发布到当前仓库的孤儿分支 `plugins-dist`，画布再通过 jsDelivr 拉取清单与 bundle。

```text
registry/
  package.json    # esbuild 与本地 SDK 依赖
  build.mjs       # 构建全部官方插件并生成清单
  dist/           # 构建产物，已被 gitignore
```

## 当前清单地址

```text
https://cdn.jsdelivr.net/gh/zdtzn/infinite-canvas@plugins-dist/official-plugins.json
```

前端可通过 `VITE_PLUGIN_REGISTRY_URL` 覆盖为其他可信清单。正式公网模式不会向普通用户开放任意远程插件脚本执行。

## 发布流程

`.github/workflows/publish-plugins.yml` 在版本标签 `v*` 或手动触发时执行：

1. 在本目录安装构建依赖。
2. 运行 `npm run build` 生成 `<id>.js` 和 `official-plugins.json`。
3. 将 `dist/` 强制发布到当前 GitHub 仓库的 `plugins-dist` 孤儿分支。

清单中的相对 `entry` 会由前端解析为清单同目录下的绝对 URL。jsDelivr 可能缓存数小时，紧急更新时需要对对应路径执行 purge。

## 新增或更新插件

- 修改插件源码后，确认 `build.mjs` 的 `OFFICIAL` 数组仍包含该插件。
- 在本地运行构建并检查清单与 bundle。
- 提交 `main` 后通过版本标签或 workflow dispatch 发布。

## 本地验证

```bash
cd plugins/canvas/registry
npm install
npm run build
```

使用任意静态服务器提供 `dist/`，再把 `VITE_PLUGIN_REGISTRY_URL` 指向本地 `official-plugins.json`。不要把 `dist/`、`node_modules/` 或第三方插件产物提交到 `main`。
