# 安全公网部署

## 首次部署

1. 把域名 A 记录解析到服务器公网 IP，并在安全组开放 `80`、`443`。
2. 在项目目录复制 `.env.example` 为 `.env`，填写 `DOMAIN`、`PUBLIC_BASE_URL` 和 `APP_ENCRYPTION_KEY`。加密密钥可用 `openssl rand -base64 32` 生成，部署后不要随意更换，否则旧渠道 Key 无法解密。
3. 启动应用和 HTTPS 入口：

```bash
docker compose --profile https up -d
```

4. 浏览器打开域名。首次访问会要求设置管理员昵称、至少 8 位站点访问口令和至少 6 位个人密码。朋友共用站点口令，但每个人使用自己的昵称和个人密码，因此可在其他设备进入同一账号，也不能冒充已有成员。
5. 在“配置 -> 渠道”中填写接口地址与 API Key。Key 会加密写入 Docker 数据卷，不再保存在浏览器。

公网模式下项目、生成任务、图片、缩略图、视频和音频都会按用户写入 `infinite-canvas-data` 数据卷。默认每个用户最多保存 2 GiB 服务端素材，可通过 `MAX_USER_ASSET_BYTES` 调整；单个素材最大 64 MB。

## 自动更新与回滚

正式环境推荐把 `IMAGE_TAG` 固定为版本号，例如 `v0.2.0`。升级前先备份数据卷：

```bash
docker run --rm -v infinite-canvas-reference_infinite-canvas-data:/data -v "$PWD":/backup alpine tar czf /backup/infinite-canvas-data.tgz -C /data .
```

升级时修改 `.env` 的 `IMAGE_TAG`，再执行：

```bash
docker compose pull
docker compose up -d
```

需要回滚时把 `IMAGE_TAG` 改回上一个版本并重新执行以上两条命令。`latest` 适合测试，不建议和 Watchtower 一起用于正式数据。

建议正式环境使用版本号或 `stable` 标签。使用 Watchtower 时也应让应用容器跟随 `stable`，避免 `main` 每次提交自动覆盖生产环境。

## 健康检查

```bash
curl -fsS https://你的域名/health
docker inspect --format '{{json .State.Health}}' infinite-canvas
docker logs --tail=100 infinite-canvas
```

`/health` 会返回服务状态、任务数量和运行时间。服务端日志包含请求 ID、耗时和状态码，接口错误也会在前端保留明确原因。

上线后还应验证：真实域名 HTTPS 证书、渠道最小生图请求、刷新后的任务恢复、第二台设备的项目与素材恢复、成员停用，以及数据卷备份和回滚。
